package main

import (
	"context"
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
		if ref := r.Header.Get("Referer"); ref != "" {
			if strings.HasPrefix(ref, "http://127.0.0.100:9639") {
				r.Header.Set("Referer", u.Scheme+"://"+u.Host)
			}
		}
		r.Header.Set("User-Agent", constant.UserAgent)
		r.Header.Del("Accept-Encoding")
		r.Header.Set("X-Forwarded-Host", "127.0.0.100:9639")
		r.Header.Set("X-Forwarded-Proto", "http")
		r.Header.Set("X-Version-Core", C.Version)
		r.Header.Set("X-Version-Client", constant.Version)
		r.Header.Set("X-Client-ID", device.DeviceHash())
	}
	rp.ErrorHandler = func(w http.ResponseWriter, r *http.Request, err error) {
		http.Error(w, "Upstream error", http.StatusBadGateway)
	}
	handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Add CORS headers for localhost
		w.Header().Set("Access-Control-Allow-Origin", "wails://localhost:9245")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Wails-Window-ID")
		w.Header().Set("Access-Control-Max-Age", "86400")
		w.Header().Set("Access-Control-Allow-Credentials", "true")

		// Handle preflight OPTIONS requests
		if r.Method == "OPTIONS" {
			w.WriteHeader(http.StatusOK)
			return
		}

		if r.Header.Get("X-Wails-Window-ID") == "" {
			http.Error(w, "", http.StatusForbidden)
			return
		}
		rp.ServeHTTP(w, r)
	})
	srv := &http.Server{
		Addr:              "127.0.0.100:9639",
		Handler:           handler,
		ReadHeaderTimeout: 10 * time.Second,
	}
	s.proxyServer = srv
	go func() {
		for {
			err := srv.ListenAndServe()
			if err == http.ErrServerClosed {
				panic("local proxy server closed")
			}
			time.Sleep(500 * time.Millisecond)
			if s.proxyServer == nil {
				break
			}
		}
	}()
}
