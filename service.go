package main

import (
	"context"
	"net/http"
	"net/http/httputil"
	"net/url"
	"strings"
	"time"

	"github.com/lagzap/lagzap"
	"github.com/lagzap/lagzap/adapter"
	"github.com/lagzap/lagzap/coordinator"
	"github.com/lagzap/lagzap/coordinator/monitoring"
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
	monitoring  *monitoring.Manager
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
	if coordinator, ok := s.coordinator.(*coordinator.Coordinator); ok {
		s.monitoring = coordinator.TrafficManager()
	}
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

// startProxy launches an HTTP reverse proxy on localhost:963 to for the frontend API
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
			if strings.HasPrefix(ref, "http://localhost:963") || strings.HasPrefix(ref, "http://127.0.0.1:963") {
				r.Header.Set("Referer", u.Scheme+"://"+u.Host)
			}
		}
		if r.Header.Get("User-Agent") == "" {
			r.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36")
		}
		r.Header.Del("Accept-Encoding")
		r.Header.Set("X-Forwarded-Host", "localhost:963")
		r.Header.Set("X-Forwarded-Proto", "http")
	}
	rp.ErrorHandler = func(w http.ResponseWriter, r *http.Request, err error) {
		http.Error(w, "Upstream error", http.StatusBadGateway)
	}
	handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		rp.ServeHTTP(w, r)
	})
	srv := &http.Server{
		Addr:              "127.0.0.1:963",
		Handler:           handler,
		ReadHeaderTimeout: 10 * time.Second,
	}
	s.proxyServer = srv
	go func() {
		for {
			err := srv.ListenAndServe()
			if err == http.ErrServerClosed {
				break
			}
			time.Sleep(500 * time.Millisecond)
			if s.proxyServer == nil {
				break
			}
		}
	}()
}
