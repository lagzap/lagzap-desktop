package main

import (
	"context"
	"fmt"

	"github.com/lagzap/lagzap"
	"github.com/lagzap/lagzap-desktop/constant"
	"github.com/lagzap/lagzap-desktop/localproxy"
	"github.com/lagzap/lagzap/adapter"
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
	runtimeCtx  context.Context
	cancel      context.CancelFunc
	app         *application.App
	window      *application.WebviewWindow
	systray     *application.SystemTray
	lagzap      *lagzap.LagZap
	coordinator adapter.Coordinator
	dnsRouter   adapter.DNSRouter
	logFactory  log.ObservableFactory
	localProxy  *localproxy.Proxy
}

const (
	LAGZAP_DEFAULT_SESSION_ID    = "00000000-0000-0000-0000-000000000000"
	LAGZAP_DEFAULT_SUBSCRIBER_ID = "00000000-0000-0000-0000-000000000000"
)

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
	s.runtimeCtx = ctx
	s.dnsRouter = service.FromContext[adapter.DNSRouter](ctx)
	s.coordinator = service.FromContext[adapter.Coordinator](ctx)
	s.coordinator.Listen(func(event string, data any) {
		s.app.Event.Emit(event, data)
	})
	s.lagzap = instance
	s.app.Event.Emit("service-started")

	if err := s.discoverAndStartLocalProxy(); err != nil {
		return E.Cause(err, "discover and start local proxy")
	}
	
	go s.startMonitoring()

	s.logFactory = instance.Logger()
	go s.startLogging()
	return nil
}

func (s *Service) StopService() error {
	if s.lagzap == nil {
		return nil
	}
	if s.localProxy != nil {
		_ = s.localProxy.Stop()
	}
	if s.cancel != nil {
		s.cancel()
	}
	err := s.lagzap.Close()
	s.lagzap = nil
	s.coordinator = nil
	s.dnsRouter = nil
	s.runtimeCtx = nil
	s.app.Event.Emit("service-stopped")
	return err
}

func (s *Service) FindAvailableInterfaces() {
	if s.coordinator == nil {
		return
	}
	s.coordinator.FindAvailableInterfaces()
}

func (s *Service) GetInterfaces() (*control.Interface, []*control.Interface) {
	if s.coordinator == nil {
		return nil, nil
	}
	return s.coordinator.GetDefaultInterface(), s.coordinator.GetAvailableInterfaces()
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

func (s *Service) discoverAndStartLocalProxy() error {
	if s.coordinator != nil {
		hostnames, hostErr := localproxy.DiscoverCoordinatorHosts(s.ctx, s.dnsRouter, constant.Version)
		if len(hostnames) > 0 {
			s.coordinator.SetEndpoints(hostnames)
			fmt.Printf("coordinator: endpoints from discovery: %v\n", hostnames)
		}
		if hostErr != nil {
			fmt.Printf("coordinator: endpoint discovery note: %v\n", hostErr)
		}
	}
	target, err := localproxy.DiscoverUpstream(s.ctx, s.dnsRouter, constant.Version)
	if err != nil {
		fmt.Printf("localproxy: upstream discovery note: %v (using %s)\n", err, target)
	} else {
		fmt.Printf("localproxy: upstream %s (%s channel)\n", target, localproxy.ChannelHost(constant.Version))
	}
	return s.StartLocalProxy(target)
}

func (s *Service) StartLocalProxy(target string) error {
	if s.localProxy == nil {
		s.localProxy = localproxy.New()
	}
	proxyCtx := s.runtimeCtx
	if proxyCtx == nil {
		proxyCtx = s.ctx
	}
	return s.localProxy.Start(localproxy.Config{
		Target:    target,
		Context:   proxyCtx,
		DNS:       s.dnsRouter,
		BindIface: localproxy.BindInterface(s.coordinator),
	})
}

func (s *Service) StopLocalProxy() error {
	if s.localProxy == nil {
		return nil
	}
	return s.localProxy.Stop()
}
