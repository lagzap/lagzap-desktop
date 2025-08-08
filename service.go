package main

import (
	"context"

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
}

const LAGZAP_DEFAULT_SESSION_ID = "00000000-0000-0000-0000-000000000000"
const LAGZAP_DEFAULT_SUBSCRIBER_ID = "00000000-0000-0000-0000-000000000000"

func (s *Service) New(ctx context.Context, app *application.App) {
	s.ctx = lagzap.Context(ctx, include.InboundRegistry(), include.OutboundRegistry(), include.EndpointRegistry(), include.DNSTransportRegistry(), include.ServiceRegistry())
	s.app = app
}

func (s *Service) StartService(hostname, accessToken string) error {
	if s.lagzap != nil {
		_ = s.StopNDIS()
		_ = s.StopService()
	}
	ctx, cancel := context.WithCancel(s.ctx)
	s.cancel = cancel

	options := s.generateConfig(hostname, accessToken)
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
	go s.startMonitoring()

	s.logFactory = instance.Logger()
	go s.startLogging()
	return nil
}

func (s *Service) StopService() error {
	if s.lagzap == nil {
		return nil
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
