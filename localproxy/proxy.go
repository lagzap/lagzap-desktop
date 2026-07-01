package localproxy

import (
	"context"
	"fmt"
	"net"
	"net/http"
	"net/http/httputil"
	"net/netip"
	"net/url"
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
	DefaultListen        = "127.0.0.100:9639"
	DefaultOrigin        = "wails://localhost:9245"
	shutdownTimeout      = 2 * time.Second
	restartDrainDuration = 150 * time.Millisecond
	readHeaderTimeout    = 10 * time.Second
)

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
	rp := httputil.NewSingleHostReverseProxy(cfg.target)
	orig := rp.Director
	headers := requestHeaders{target: cfg.target}
	// rp.Transport = newTransport(transportConfig{
	// 	ctx:       cfg.ctx,
	// 	dns:       cfg.dns,
	// 	bindIface: cfg.bindIface,
	// })
	rp.Director = func(r *http.Request) {
		if orig != nil {
			orig(r)
		}
		headers.apply(r)
	}
	rp.ErrorHandler = func(w http.ResponseWriter, r *http.Request, err error) {
		fmt.Printf("localproxy: upstream error: %s %s -> %v\n", r.Method, r.URL.String(), err)
		http.Error(w, "Upstream error", http.StatusBadGateway)
	}
	rp.ModifyResponse = func(res *http.Response) error {
		if res.StatusCode >= 400 {
			fmt.Printf("localproxy: upstream %d for %s %s\n", res.StatusCode, res.Request.Method, res.Request.URL.String())
		}
		cors.applyResponse(res)
		return nil
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if cors.handlePreflight(w, r) {
			return
		}
		rp.ServeHTTP(w, r)
	})
}

type requestHeaders struct {
	target *url.URL
}

func (h requestHeaders) apply(r *http.Request) {
	r.Host = h.target.Host
	r.Header.Set("Host", h.target.Host)
	if o := r.Header.Get("Origin"); o != "" {
		r.Header.Set("Origin", h.target.Scheme+"://"+h.target.Host)
	}
	if ref := r.Header.Get("Referer"); ref != "" {
		r.Header.Set("Referer", h.target.Scheme+"://"+h.target.Host)
	}
	r.Header.Set("User-Agent", constant.UserAgent)
	r.Header.Del("Accept-Encoding")
	r.Header.Set("X-Forwarded-Host", r.Host)
	r.Header.Set("X-Forwarded-Proto", h.target.Scheme)
	r.Header.Set("X-Version-Core", C.Version)
	r.Header.Set("X-Version-Client", constant.Version)
	r.Header.Set("X-Client-ID", device.DeviceHash())
}

type transportConfig struct {
	ctx       context.Context
	dns       adapter.DNSRouter
	bindIface string
}

func newTransport(cfg transportConfig) http.RoundTripper {
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
	return &http.Transport{
		DialContext: func(ctx context.Context, network, addr string) (net.Conn, error) {
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
		},
	}
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

func (p originPolicy) resolve(origin string) string {
	if strings.HasPrefix(origin, "wails://") ||
		strings.HasPrefix(origin, "http://127.0.0.1") ||
		strings.HasPrefix(origin, "http://127.0.0.100") ||
		strings.HasPrefix(origin, "http://localhost") {
		return origin
	}
	return p.defaultOrigin
}

func (p originPolicy) applyResponse(res *http.Response) {
	allowed := p.resolve(res.Request.Header.Get("Origin"))
	h := res.Header
	h.Del("Access-Control-Allow-Origin")
	h.Del("Access-Control-Allow-Credentials")
	h.Set("Access-Control-Allow-Origin", allowed)
	h.Set("Access-Control-Allow-Credentials", "true")
	h.Add("Vary", "Origin")
}

func (p originPolicy) handlePreflight(w http.ResponseWriter, r *http.Request) bool {
	if r.Method != http.MethodOptions {
		return false
	}
	allowed := p.resolve(r.Header.Get("Origin"))
	h := w.Header()
	h.Set("Access-Control-Allow-Origin", allowed)
	h.Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
	if acrh := r.Header.Get("Access-Control-Request-Headers"); acrh != "" {
		h.Set("Access-Control-Allow-Headers", acrh)
	} else {
		h.Set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Wails-Window-ID")
	}
	h.Set("Access-Control-Max-Age", "86400")
	h.Set("Access-Control-Allow-Credentials", "true")
	h.Add("Vary", "Origin")
	w.WriteHeader(http.StatusOK)
	return true
}
