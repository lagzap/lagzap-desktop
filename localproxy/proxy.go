package localproxy

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httputil"
	"net/netip"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/lagzap/lagzap-desktop/constant"
	"github.com/lagzap/lagzap/adapter"
	"github.com/lagzap/lagzap/common/device"
	"github.com/lagzap/lagzap/common/dialer"
	C "github.com/lagzap/lagzap/constant"
	"github.com/lagzap/lagzap/option"
	E "github.com/lagzap/zap/common/exceptions"
	M "github.com/lagzap/zap/common/metadata"
	N "github.com/lagzap/zap/common/network"
)

const (
	DefaultListen       = "127.0.0.100:9639"
	DefaultOrigin       = "http://wails.localhost"
	shutdownTimeout     = 2 * time.Second
	restartDrainDuration = 150 * time.Millisecond
	readHeaderTimeout   = 10 * time.Second
)

type clientCorsInfo struct {
	origin  string
	referer string
}

type corsContextKey struct{}

var corsInfoKey corsContextKey

type Config struct {
	Listen    string
	Target    string
	Context   context.Context
	DNS       adapter.DNSRouter
	BindIface string
}

type Proxy struct {
	mu     sync.Mutex
	server *http.Server
}

func New() *Proxy {
	return &Proxy{}
}

func (p *Proxy) Start(cfg Config) error {
	p.mu.Lock()
	defer p.mu.Unlock()
	if err := p.stopLocked(); err != nil {
		return err
	}
	target, err := url.Parse(cfg.Target)
	if err != nil {
		return E.Cause(err, "parse target")
	}
	listen := cfg.Listen
	if listen == "" {
		listen = DefaultListen
	}
	handler := newHandler(handlerConfig{
		target:    target,
		ctx:       cfg.Context,
		dns:       cfg.DNS,
		bindIface: cfg.BindIface,
	})
	ln, err := net.Listen("tcp", listen)
	if err != nil {
		return E.Cause(err, "listen ", listen)
	}
	srv := &http.Server{
		Addr:              listen,
		Handler:           handler,
		ReadHeaderTimeout: readHeaderTimeout,
	}
	p.server = srv
	go func() {
		if err := srv.Serve(ln); err != nil && err != http.ErrServerClosed {
			fmt.Printf("localproxy: serve error: %v\n", err)
		}
	}()
	fmt.Printf("localproxy: listening on %s -> %s\n", listen, target.String())
	return nil
}

func (p *Proxy) Stop() error {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.stopLocked()
}

func (p *Proxy) Running() bool {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.server != nil
}

func (p *Proxy) stopLocked() error {
	if p.server == nil {
		return nil
	}
	ctx, cancel := context.WithTimeout(context.Background(), shutdownTimeout)
	defer cancel()
	err := p.server.Shutdown(ctx)
	p.server = nil
	time.Sleep(restartDrainDuration)
	return err
}

type handlerConfig struct {
	target    *url.URL
	ctx       context.Context
	dns       adapter.DNSRouter
	bindIface string
}

func newHandler(cfg handlerConfig) http.Handler {
	target := cfg.target
	rp := &httputil.ReverseProxy{
		Transport: newTransport(transportConfig{
			ctx:       cfg.ctx,
			dns:       cfg.dns,
			bindIface: cfg.bindIface,
		}),
		Rewrite: func(pr *httputil.ProxyRequest) {
			pr.SetURL(target)
			pr.SetXForwarded()
			requestHeaders{target: target}.apply(pr.Out, pr.In)
			copyOutboundBody(pr.Out, pr.In)
			if info, ok := pr.In.Context().Value(corsInfoKey).(clientCorsInfo); ok {
				pr.Out = pr.Out.WithContext(context.WithValue(pr.Out.Context(), corsInfoKey, info))
			}
		},
		ErrorHandler: func(w http.ResponseWriter, r *http.Request, err error) {
			fmt.Printf("localproxy: upstream error: %s %s -> %v\n", r.Method, r.URL.String(), err)
			cors.writeHeaders(w, r)
			http.Error(w, "Upstream error", http.StatusBadGateway)
		},
		ModifyResponse: func(res *http.Response) error {
			if res.StatusCode >= 400 {
				fmt.Printf("localproxy: upstream %d for %s %s\n", res.StatusCode, res.Request.Method, res.Request.URL.String())
			}
			cors.applyResponse(res)
			return nil
		},
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if cors.handlePreflight(w, r) {
			return
		}
		r = r.WithContext(context.WithValue(r.Context(), corsInfoKey, clientCorsInfo{
			origin:  r.Header.Get("Origin"),
			referer: r.Header.Get("Referer"),
		}))
		if err := bufferRequestBody(r); err != nil {
			fmt.Printf("localproxy: read request body: %s %s -> %v\n", r.Method, r.URL.Path, err)
			cors.writeHeaders(w, r)
			http.Error(w, "Bad request body", http.StatusBadRequest)
			return
		}
		rp.ServeHTTP(w, r)
	})
}

func bufferRequestBody(r *http.Request) error {
	if r.Body == nil || r.Body == http.NoBody {
		return nil
	}

	body, err := io.ReadAll(r.Body)
	if err != nil {
		return err
	}
	if err := r.Body.Close(); err != nil {
		return err
	}

	r.Body = io.NopCloser(bytes.NewReader(body))
	r.ContentLength = int64(len(body))
	if len(body) > 0 {
		r.Header.Set("Content-Length", strconv.Itoa(len(body)))
		r.Header.Del("Transfer-Encoding")
	} else {
		r.ContentLength = 0
		r.Header.Del("Content-Length")
	}
	r.GetBody = func() (io.ReadCloser, error) {
		return io.NopCloser(bytes.NewReader(body)), nil
	}

	if r.Method != http.MethodGet && r.Method != http.MethodHead && len(body) == 0 {
		fmt.Printf("localproxy: warning empty %s body for %s\n", r.Method, r.URL.Path)
	}
	return nil
}

func copyOutboundBody(out, in *http.Request) {
	if in.GetBody != nil {
		body, err := in.GetBody()
		if err != nil {
			return
		}
		data, err := io.ReadAll(body)
		_ = body.Close()
		if err != nil {
			return
		}
		out.Body = io.NopCloser(bytes.NewReader(data))
		out.ContentLength = int64(len(data))
		if len(data) > 0 {
			out.Header.Set("Content-Length", strconv.Itoa(len(data)))
			out.Header.Del("Transfer-Encoding")
		}
		return
	}
	if in.Body != nil && in.Body != http.NoBody {
		out.Body = in.Body
		out.ContentLength = in.ContentLength
	}
}

type requestHeaders struct {
	target *url.URL
}

func (h requestHeaders) apply(out, in *http.Request) {
	out.Host = h.target.Host
	out.Header.Set("Host", h.target.Host)
	if o := in.Header.Get("Origin"); o != "" {
		out.Header.Set("Origin", h.target.Scheme+"://"+h.target.Host)
	}
	if ref := in.Header.Get("Referer"); ref != "" {
		out.Header.Set("Referer", h.target.Scheme+"://"+h.target.Host)
	}
	if ct := in.Header.Get("Content-Type"); ct != "" {
		out.Header.Set("Content-Type", ct)
	}
	out.Header.Set("User-Agent", constant.UserAgent())
	out.Header.Del("Accept-Encoding")
	out.Header.Set("X-Forwarded-Host", in.Host)
	out.Header.Set("X-Forwarded-Proto", h.target.Scheme)
	out.Header.Set("X-Forwarded-For", clientIP(in))
	out.Header.Set("X-Version-Core", C.Version)
	out.Header.Set("X-Version-Client", constant.Version)
	out.Header.Set("X-Client-ID", device.DeviceHash())
}

func clientIP(r *http.Request) string {
	if forwarded := strings.TrimSpace(r.Header.Get("X-Forwarded-For")); forwarded != "" {
		if ip, _, found := strings.Cut(forwarded, ","); found {
			return strings.TrimSpace(ip)
		}
		return forwarded
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

type transportConfig struct {
	ctx       context.Context
	dns       adapter.DNSRouter
	bindIface string
}

func newTransport(cfg transportConfig) http.RoundTripper {
	transport := http.DefaultTransport.(*http.Transport).Clone()
	var bound N.Dialer
	if cfg.bindIface != "" {
		d, err := dialer.NewWithOptions(dialer.Options{
			Context:   cfg.ctx,
			NewDialer: true,
			Options: option.DialerOptions{
				BindInterface: cfg.bindIface,
				TCPMultiPath:  false,
				TCPFastOpen:   true,
			},
		})
		if err == nil {
			bound = d
		}
	}
	transport.DialContext = func(ctx context.Context, network, addr string) (net.Conn, error) {
		if bound == nil {
			return net.Dial("tcp", addr)
		}
		destination := M.ParseSocksaddr(addr)
		ips, err := cfg.dns.Lookup(cfg.ctx, destination.AddrString(), adapter.DNSQueryOptions{
			Strategy: C.DomainStrategyIPv4Only,
		})
		if err != nil || len(ips) == 0 {
			return nil, err
		}
		ip, ok := firstPublicIPv4(ips)
		if !ok {
			return nil, E.New("no valid IP addresses found")
		}
		return bound.DialContext(ctx, network, M.ParseSocksaddrHostPort(ip.String(), destination.Port))
	}
	return transport
}

func firstPublicIPv4(ips []netip.Addr) (netip.Addr, bool) {
	for _, ip := range ips {
		if (ip.Is6() && !ip.Is4In6()) || ip.IsPrivate() || ip.IsLoopback() || ip.IsUnspecified() || !ip.IsValid() {
			continue
		}
		return ip, true
	}
	return netip.Addr{}, false
}

var cors = originPolicy{defaultOrigin: DefaultOrigin}

type originPolicy struct {
	defaultOrigin string
}

func (p originPolicy) resolve(origin, referer string) string {
	origin = strings.TrimSpace(origin)
	if origin == "" && referer != "" {
		if u, err := url.Parse(referer); err == nil && u.Scheme != "" && u.Host != "" {
			origin = u.Scheme + "://" + u.Host
		}
	}
	if strings.HasPrefix(origin, "wails://") ||
		strings.HasPrefix(origin, "http://127.0.0.1") ||
		strings.HasPrefix(origin, "http://127.0.0.100") ||
		strings.HasPrefix(origin, "http://localhost") ||
		strings.HasPrefix(origin, "https://localhost") ||
		strings.HasPrefix(origin, "http://wails.localhost") ||
		strings.HasPrefix(origin, "https://wails.localhost") ||
		isWailsDevOrigin(origin) {
		return origin
	}
	return p.defaultOrigin
}

func isWailsDevOrigin(origin string) bool {
	u, err := url.Parse(origin)
	if err != nil {
		return false
	}
	switch u.Hostname() {
	case "wails.localhost":
		return true
	default:
		return false
	}
}

func (p originPolicy) writeHeaders(w http.ResponseWriter, r *http.Request) {
	p.applyCorsHeaders(w.Header(), r.Header.Get("Origin"), r.Header.Get("Referer"))
}

func (p originPolicy) applyResponse(res *http.Response) {
	origin := ""
	referer := ""
	if info, ok := res.Request.Context().Value(corsInfoKey).(clientCorsInfo); ok {
		origin = info.origin
		referer = info.referer
	}
	if origin == "" {
		origin = res.Request.Header.Get("Origin")
	}
	if referer == "" {
		referer = res.Request.Header.Get("Referer")
	}
	p.applyCorsHeaders(res.Header, origin, referer)
}

func (p originPolicy) applyCorsHeaders(h http.Header, origin, referer string) {
	allowed := p.resolve(origin, referer)
	h.Del("Access-Control-Allow-Origin")
	h.Del("Access-Control-Allow-Credentials")
	h.Del("Access-Control-Allow-Private-Network")
	h.Set("Access-Control-Allow-Origin", allowed)
	h.Set("Access-Control-Allow-Credentials", "true")
	// WebView2 private-network requests (wails.localhost → 127.0.0.100) require this on all responses.
	h.Set("Access-Control-Allow-Private-Network", "true")
	h.Add("Vary", "Origin")
}

func (p originPolicy) handlePreflight(w http.ResponseWriter, r *http.Request) bool {
	if r.Method != http.MethodOptions {
		return false
	}
	allowed := p.resolve(r.Header.Get("Origin"), r.Header.Get("Referer"))
	h := w.Header()
	h.Set("Access-Control-Allow-Origin", allowed)
	h.Set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
	if acrh := r.Header.Get("Access-Control-Request-Headers"); acrh != "" {
		h.Set("Access-Control-Allow-Headers", acrh)
	} else {
		h.Set("Access-Control-Allow-Headers", "Content-Type, Authorization, Accept, X-Wails-Window-ID, X-Requested-With")
	}
	// Always allow private-network access (wails.localhost → 127.0.0.100).
	h.Set("Access-Control-Allow-Private-Network", "true")
	h.Set("Access-Control-Max-Age", "86400")
	h.Set("Access-Control-Allow-Credentials", "true")
	h.Add("Vary", "Origin")
	w.WriteHeader(http.StatusOK)
	return true
}
