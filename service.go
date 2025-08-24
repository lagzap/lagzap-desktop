package main

import (
	"context"
	"fmt"
	"net"
	"net/http"
	"net/http/httputil"
	"net/url"
	"strings"
	"time"

	"github.com/lagzap/lagzap"
	"github.com/lagzap/lagzap-desktop/constant"
	"github.com/lagzap/lagzap/adapter"
	"github.com/lagzap/lagzap/common/device"
	C "github.com/lagzap/lagzap/constant"
	"github.com/lagzap/lagzap/include"
	"github.com/lagzap/lagzap/log"
	"github.com/lagzap/zap/common/control"
	E "github.com/lagzap/zap/common/exceptions"
	"github.com/lagzap/zap/service"
	"github.com/wailsapp/wails/v3/pkg/application"
)

type Service struct {
	adapter.LifecycleService
	ctx         context.Context
	cancel      context.CancelFunc
	app         *application.App
	window      *application.WebviewWindow
	systray     *application.SystemTray
	lagzap      *lagzap.LagZap
	coordinator adapter.Coordinator
	logFactory  log.ObservableFactory
	proxyServer *http.Server
}

const LAGZAP_DEFAULT_SESSION_ID = "00000000-0000-0000-0000-000000000000"
const LAGZAP_DEFAULT_SUBSCRIBER_ID = "00000000-0000-0000-0000-000000000000"

func (s *Service) New(ctx context.Context, app *application.App) {
	s.ctx = lagzap.Context(ctx, include.InboundRegistry(), include.OutboundRegistry(), include.EndpointRegistry(), include.DNSTransportRegistry(), include.ServiceRegistry())
	s.app = app
}

func (s *Service) ReloadService() error {
	if s.lagzap != nil {
		_ = s.StopProxy()
		_ = s.StopService()
	}
	ctx, cancel := context.WithCancel(s.ctx)
	s.cancel = cancel

	options := s.generateConfig()
	instance, err := lagzap.New(lagzap.Options{
		Context: ctx,
		Options: options,
	})
	if err != nil {
		cancel()
		return E.Cause(err, "create service")
	}
	err = instance.Start()
	if err != nil {
		s.StopService()
		return E.Cause(err, "start service")
	}
	s.coordinator = service.FromContext[adapter.Coordinator](s.ctx)
	s.coordinator.Listen(func(event string, data any) {
		s.app.Event.Emit(event, data)
	})
	s.lagzap = instance
	s.app.Event.Emit("service-started")
	go s.startProxy("https://dev.lagzap-network.ir")
	go s.startMonitoring()

	s.logFactory = instance.Logger()
	go s.startLogging()
	return nil
}

func (s *Service) StopService() error {
	if s.lagzap == nil {
		return nil
	}
	if s.proxyServer != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		_ = s.proxyServer.Shutdown(ctx)
		cancel()
		s.proxyServer = nil
	}
	if s.cancel != nil {
		s.cancel()
	}
	err := s.lagzap.Close()
	s.lagzap = nil
	s.coordinator = nil
	s.app.Event.Emit("service-stopped")
	return err
}

func (s *Service) GetInterfaces() (*adapter.NetworkInterface, []control.Interface) {
	if s.lagzap == nil {
		return nil, []control.Interface{}
	}
	networkManager := service.FromContext[adapter.NetworkManager](s.ctx)

	defaultInterface := networkManager.DefaultNetworkInterface()
	interfaces := networkManager.InterfaceFinder().Interfaces()
	return defaultInterface, interfaces
}

func (s *Service) NeedWIFIState() bool {
	return s.lagzap.Router().NeedWIFIState()
}

func (s *Service) IsRunning() bool {
	return s.lagzap != nil
}

func (s *Service) IsReady() bool {
	return s.coordinator != nil
}

func (s *Service) IsConnected() bool {
	return s.coordinator != nil && s.coordinator.Status() == adapter.StatusConnected
}

func (s *Service) SetWindow(window *application.WebviewWindow) {
	s.window = window
}

func (s *Service) SetSystray(systray *application.SystemTray) {
	s.systray = systray
}

// startProxy launches an HTTP reverse proxy on 127.0.0.100:9639 to for the frontend API
func (s *Service) startProxy(target string) {
	// Restart if already running
	if s.proxyServer != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		_ = s.proxyServer.Shutdown(ctx)
		cancel()
		s.proxyServer = nil
		time.Sleep(150 * time.Millisecond)
	}
	u, err := url.Parse(target)
	if err != nil {
		fmt.Printf("proxy: invalid target URL %q: %v\n", target, err)
		return
	}
	rp := httputil.NewSingleHostReverseProxy(u)
	// Rewrite request to look like coming from target origin
	orig := rp.Director
	rp.Director = func(r *http.Request) {
		if orig != nil {
			orig(r)
		}
		r.Host = u.Host
		r.Header.Set("Host", u.Host)
		if o := r.Header.Get("Origin"); o != "" {
			r.Header.Set("Origin", u.Scheme+"://"+u.Host)
		}
		// Always normalize Referer to target origin to avoid upstream CSRF/CORS checks on localhost refs
		if ref := r.Header.Get("Referer"); ref != "" {
			r.Header.Set("Referer", u.Scheme+"://"+u.Host)
		}
		r.Header.Set("User-Agent", constant.UserAgent)
		r.Header.Del("Accept-Encoding")
		// Preserve the original requested host instead of a hardcoded value
		r.Header.Set("X-Forwarded-Host", r.Host)
		r.Header.Set("X-Forwarded-Proto", u.Scheme)
		r.Header.Set("X-Version-Core", C.Version)
		r.Header.Set("X-Version-Client", constant.Version)
		r.Header.Set("X-Client-ID", device.DeviceHash())
	}
	rp.ErrorHandler = func(w http.ResponseWriter, r *http.Request, err error) {
		fmt.Printf("proxy: upstream error: %s %s -> %v\n", r.Method, r.URL.String(), err)
		http.Error(w, "Upstream error", http.StatusBadGateway)
	}
	rp.ModifyResponse = func(res *http.Response) error {
		if res.StatusCode >= 400 {
			fmt.Printf("proxy: upstream response %d for %s %s\n", res.StatusCode, res.Request.Method, res.Request.URL.String())
		}
		// Sanitize/override CORS on proxied responses to ensure a single origin value
		origin := res.Request.Header.Get("Origin")
		allowed := "wails://localhost:9245"
		if strings.HasPrefix(origin, "wails://") || strings.HasPrefix(origin, "http://127.0.0.1") || strings.HasPrefix(origin, "http://127.0.0.100") || strings.HasPrefix(origin, "http://localhost") {
			allowed = origin
		}
		h := res.Header
		h.Del("Access-Control-Allow-Origin")
		h.Del("Access-Control-Allow-Credentials")
		h.Set("Access-Control-Allow-Origin", allowed)
		h.Set("Access-Control-Allow-Credentials", "true")
		h.Add("Vary", "Origin")
		return nil
	}
	handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Preflight: respond here and do NOT hit upstream
		origin := r.Header.Get("Origin")
		allowed := "wails://localhost:9245"
		if strings.HasPrefix(origin, "wails://") || strings.HasPrefix(origin, "http://127.0.0.1") || strings.HasPrefix(origin, "http://127.0.0.100") || strings.HasPrefix(origin, "http://localhost") {
			allowed = origin
		}
		if r.Method == "OPTIONS" {
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
			return
		}
		rp.ServeHTTP(w, r)
	})
	addr := "127.0.0.100:9639" // change if needed; see notes below
	ln, err := net.Listen("tcp", addr)
	if err != nil {
		fmt.Printf("proxy: failed to bind %s: %v\n", addr, err)
		return
	}
	fmt.Printf("proxy: listening on %s, proxying to %s\n", addr, u.String())
	srv := &http.Server{
		Addr:              addr,
		Handler:           handler,
		ReadHeaderTimeout: 10 * time.Second,
	}
	s.proxyServer = srv
	go func() {
		if err := srv.Serve(ln); err != nil && err != http.ErrServerClosed {
			fmt.Printf("proxy: serve error: %v\n", err)
		} else {
			fmt.Printf("proxy: server closed: %v\n", err)
		}
	}()
}
