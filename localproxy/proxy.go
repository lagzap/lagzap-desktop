package localproxy

import (
	"bytes"
	"errors"
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
	"sync/atomic"
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

// A read request whose upstream sends no answer in upstreamWait goes to the
// next upstream; on the last one it waits lastUpstreamWait, then answers 504
// ("slow to respond"). Both fit in the app's own 15s limit.
var (
	upstreamWait     = 6 * time.Second
	lastUpstreamWait = 8 * time.Second
)

type clientCorsInfo struct {
	origin  string
	referer string
}

type corsContextKey struct{}

var corsInfoKey corsContextKey

type Config struct {
	Listen string
	// Targets are the API's addresses, the one to use first first; a request
	// that fails on one goes to the next, which later requests then use.
	Targets   []string
	Context   context.Context
	DNS       adapter.DNSRouter
	// BindIface names the adapter for each new upstream connection ("" = OS
	// route). It is asked per dial, so the API follows the coordinator off an
	// adapter that lost internet instead of keeping the one from startup.
	BindIface func() string
}

type Proxy struct {
	mu      sync.Mutex
	server  *http.Server
	running runningConfig
}

// runningConfig is what the live server was started with. BindIface is left
// out: funcs can't be compared, and it is read per dial anyway.
type runningConfig struct {
	listen string
	target string
	ctx    context.Context
	dns    adapter.DNSRouter
}

func New() *Proxy {
	return &Proxy{}
}

// Start serves cfg, keeping the live server when nothing it depends on
// changed: rediscovery often lands on the same upstream, and a restart drops
// the UI's in-flight API requests.
func (p *Proxy) Start(cfg Config) error {
	p.mu.Lock()
	defer p.mu.Unlock()
	listen := cfg.Listen
	if listen == "" {
		listen = DefaultListen
	}
	want := runningConfig{listen: listen, target: strings.Join(cfg.Targets, ","), ctx: cfg.Context, dns: cfg.DNS}
	if p.server != nil && p.running == want {
		return nil
	}
	if err := p.stopLocked(); err != nil {
		return err
	}
	if len(cfg.Targets) == 0 {
		return E.New("no upstream")
	}
	targets := make([]*url.URL, 0, len(cfg.Targets))
	for _, raw := range cfg.Targets {
		target, err := url.Parse(raw)
		if err != nil {
			return E.Cause(err, "parse target ", raw)
		}
		targets = append(targets, target)
	}
	handler := newHandler(handlerConfig{
		targets:   targets,
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
	p.running = want
	go func() {
		if err := srv.Serve(ln); err != nil && err != http.ErrServerClosed {
			fmt.Printf("localproxy: serve error: %v\n", err)
		}
	}()
	fmt.Printf("localproxy: listening on %s -> %s\n", listen, strings.Join(cfg.Targets, ", "))
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
	p.running = runningConfig{}
	time.Sleep(restartDrainDuration)
	return err
}

type handlerConfig struct {
	targets   []*url.URL
	ctx       context.Context
	dns       adapter.DNSRouter
	bindIface func() string
}

// attempt is one try of a request on one upstream.
type attempt struct {
	// Another upstream may take the request: its error is kept, not sent.
	retry    bool
	err      error
	timedOut atomic.Bool
	timer    *time.Timer
}

type attemptKey struct{}

func attemptOf(r *http.Request) *attempt {
	a, _ := r.Context().Value(attemptKey{}).(*attempt)
	return a
}

// mayRetry: a read request may go to another upstream after any failure; a
// write only when it never reached this one (the dial failed), so it is
// never done twice.
func mayRetry(r *http.Request, err error) bool {
	switch r.Method {
	case http.MethodGet, http.MethodHead, http.MethodOptions:
		return true
	}
	var op *net.OpError
	return errors.As(err, &op) && op.Op == "dial"
}

// upstreams serves each request through the upstream in use, and moves to
// the next one when it fails (no answer in upstreamWait for a read).
type upstreams struct {
	targets []*url.URL
	proxies []*httputil.ReverseProxy
	current atomic.Int32
}

// raceWidth: how many upstreams a read goes to at once.
const raceWidth = 3

func (u *upstreams) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	n := len(u.proxies)
	if n > 1 && mayRetry(r, nil) {
		u.race(w, r)
		return
	}
	start := int(u.current.Load())
	for i := 0; i < n; i++ {
		idx := (start + i) % n
		a := &attempt{retry: i < n-1}
		ctx, cancel := context.WithCancel(r.Context())
		if mayRetry(r, nil) {
			wait := upstreamWait
			if !a.retry {
				wait = lastUpstreamWait
			}
			a.timer = time.AfterFunc(wait, func() {
				a.timedOut.Store(true)
				cancel()
			})
		}
		u.proxies[idx].ServeHTTP(w, r.WithContext(context.WithValue(ctx, attemptKey{}, a)))
		if a.timer != nil {
			a.timer.Stop()
		}
		cancel()
		if a.err == nil || r.Context().Err() != nil {
			return
		}
		next := (idx + 1) % n
		u.current.CompareAndSwap(int32(idx), int32(next))
		fmt.Printf("localproxy: %s %s failed on %s (%v); moving to %s\n",
			r.Method, r.URL.Path, u.targets[idx].Host, a.err, u.targets[next].Host)
	}
}

// race sends a read to up to raceWidth upstreams at once (the one in use
// first) and answers with the first that does not fail; the others are
// cancelled, and the winner is used next (writes too). A slow upstream then
// costs nothing as long as another answers.
func (u *upstreams) race(w http.ResponseWriter, r *http.Request) {
	n := len(u.proxies)
	width := min(raceWidth, n)
	start := int(u.current.Load())
	type result struct {
		idx      int
		rec      *bufferedResponse
		failed   bool
		timedOut bool
		err      error
	}
	results := make(chan result, width)
	cancels := make(map[int]context.CancelFunc, width)
	for k := 0; k < width; k++ {
		idx := (start + k) % n
		ctx, cancel := context.WithCancel(r.Context())
		cancels[idx] = cancel
		// retry: its error is kept, not written (the race answers).
		a := &attempt{retry: true}
		a.timer = time.AfterFunc(lastUpstreamWait, func() {
			a.timedOut.Store(true)
			cancel()
		})
		go func() {
			rec := newBufferedResponse()
			u.proxies[idx].ServeHTTP(rec, r.WithContext(context.WithValue(ctx, attemptKey{}, a)))
			a.timer.Stop()
			results <- result{idx: idx, rec: rec, failed: a.err != nil || rec.status >= 500, timedOut: a.timedOut.Load(), err: a.err}
		}()
	}
	var lost []result
	for k := 0; k < width; k++ {
		res := <-results
		if res.failed {
			lost = append(lost, res)
			continue
		}
		for idx, cancel := range cancels {
			if idx != res.idx {
				cancel()
			}
		}
		defer cancels[res.idx]()
		if before := int(u.current.Swap(int32(res.idx))); before != res.idx {
			fmt.Printf("localproxy: %s %s answered first by %s\n", r.Method, r.URL.Path, u.targets[res.idx].Host)
		}
		res.rec.writeTo(w)
		return
	}
	for _, cancel := range cancels {
		cancel()
	}
	timedOut := false
	for _, res := range lost {
		fmt.Printf("localproxy: upstream error: %s %s on %s -> %v (status %d)\n", r.Method, r.URL.Path, u.targets[res.idx].Host, res.err, res.rec.status)
		timedOut = timedOut || res.timedOut
	}
	if len(lost) > 0 && lost[len(lost)-1].rec.status >= 500 {
		lost[len(lost)-1].rec.writeTo(w)
		return
	}
	cors.writeHeaders(w, r)
	if timedOut {
		http.Error(w, "LagZap servers are slow to respond", http.StatusGatewayTimeout)
		return
	}
	http.Error(w, "Upstream error", http.StatusBadGateway)
}

// bufferedResponse holds one raced answer until it is known to win.
type bufferedResponse struct {
	header http.Header
	status int
	body   bytes.Buffer
}

func newBufferedResponse() *bufferedResponse {
	return &bufferedResponse{header: make(http.Header)}
}

func (b *bufferedResponse) Header() http.Header { return b.header }

func (b *bufferedResponse) WriteHeader(status int) {
	if b.status == 0 {
		b.status = status
	}
}

func (b *bufferedResponse) Write(p []byte) (int, error) {
	if b.status == 0 {
		b.status = http.StatusOK
	}
	return b.body.Write(p)
}

func (b *bufferedResponse) writeTo(w http.ResponseWriter) {
	for k, v := range b.header {
		w.Header()[k] = v
	}
	status := b.status
	if status == 0 {
		status = http.StatusOK
	}
	w.WriteHeader(status)
	_, _ = w.Write(b.body.Bytes())
}

func newHandler(cfg handlerConfig) http.Handler {
	transport := newTransport(transportConfig{
		ctx:       cfg.ctx,
		dns:       cfg.dns,
		bindIface: cfg.bindIface,
	})
	u := &upstreams{targets: cfg.targets}
	for _, target := range cfg.targets {
		u.proxies = append(u.proxies, newReverseProxy(target, transport))
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
		u.ServeHTTP(w, r)
	})
}

func newReverseProxy(target *url.URL, transport http.RoundTripper) *httputil.ReverseProxy {
	return &httputil.ReverseProxy{
		Transport: transport,
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
			a := attemptOf(r)
			if a != nil && a.timedOut.Load() {
				err = E.New("no answer in time")
			}
			// Another upstream takes it (the caller still waits).
			if a != nil && a.retry && mayRetry(r, err) {
				a.err = err
				return
			}
			fmt.Printf("localproxy: upstream error: %s %s -> %v\n", r.Method, r.URL.String(), err)
			cors.writeHeaders(w, r)
			if a != nil && a.timedOut.Load() {
				http.Error(w, "LagZap servers are slow to respond", http.StatusGatewayTimeout)
				return
			}
			http.Error(w, "Upstream error", http.StatusBadGateway)
		},
		ModifyResponse: func(res *http.Response) error {
			// An answer came: no moving on now.
			if a := attemptOf(res.Request); a != nil && a.timer != nil {
				a.timer.Stop()
			}
			if res.StatusCode >= 400 {
				fmt.Printf("localproxy: upstream %d for %s %s\n", res.StatusCode, res.Request.Method, res.Request.URL.String())
			}
			cors.applyResponse(res)
			return nil
		},
	}
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
	if device.IsVirtualMachine() {
		out.Header.Set("X-Device-Virtual", "1")
	}
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
	bindIface func() string
}

func newTransport(cfg transportConfig) http.RoundTripper {
	transport := http.DefaultTransport.(*http.Transport).Clone()
	b := &boundDialers{ctx: cfg.ctx}
	transport.DialContext = func(ctx context.Context, network, addr string) (net.Conn, error) {
		// A local coordinator (dev server) is on this machine, not out an
		// internet adapter.
		if isLocalHost(addr) {
			var d net.Dialer
			return d.DialContext(ctx, network, addr)
		}
		bound := b.forIface(currentIface(cfg.bindIface))
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
	return &rebindingTransport{Transport: transport, bindIface: cfg.bindIface}
}

func isLocalHost(hostport string) bool {
	host := hostport
	if h, _, err := net.SplitHostPort(hostport); err == nil {
		host = h
	}
	if strings.EqualFold(host, "localhost") {
		return true
	}
	ip, err := netip.ParseAddr(strings.Trim(host, "[]"))
	return err == nil && ip.IsLoopback()
}

func currentIface(bindIface func() string) string {
	if bindIface == nil {
		return ""
	}
	return bindIface()
}

// boundDialers keeps the dialer for the adapter in use, rebuilt when the
// adapter changes.
type boundDialers struct {
	ctx    context.Context
	mu     sync.Mutex
	iface  string
	dialer N.Dialer
}

func (b *boundDialers) forIface(iface string) N.Dialer {
	if iface == "" {
		return nil
	}
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.dialer != nil && b.iface == iface {
		return b.dialer
	}
	d, err := dialer.NewWithOptions(dialer.Options{
		Context:   b.ctx,
		NewDialer: true,
		Options: option.DialerOptions{
			BindInterface: iface,
			TCPMultiPath:  false,
			TCPFastOpen:   true,
		},
	})
	if err != nil {
		return nil
	}
	b.iface, b.dialer = iface, d
	return d
}

// rebindingTransport drops pooled keep-alive connections when the adapter
// changes: they stay on the old adapter, and a request reusing one waited
// out its timeout on an adapter with no internet.
type rebindingTransport struct {
	*http.Transport
	bindIface func() string
	mu        sync.Mutex
	lastIface string
}

func (t *rebindingTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	iface := currentIface(t.bindIface)
	t.mu.Lock()
	changed := iface != t.lastIface
	t.lastIface = iface
	t.mu.Unlock()
	if changed {
		t.Transport.CloseIdleConnections()
	}
	return t.Transport.RoundTrip(req)
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
