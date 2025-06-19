package main

import (
	"context"

	"github.com/lagzap/lagzap"
	"github.com/lagzap/lagzap-desktop/command"
	"github.com/lagzap/lagzap-desktop/coordinator"
	"github.com/lagzap/lagzap-desktop/coordinator/handler"
	"github.com/lagzap/lagzap-desktop/monitoring"
	"github.com/lagzap/lagzap/adapter"
	"github.com/lagzap/lagzap/adapter/echo"
	"github.com/lagzap/lagzap/include"
	"github.com/lagzap/zap/common/control"
	E "github.com/lagzap/zap/common/exceptions"
	"github.com/lagzap/zap/service"
	"github.com/wailsapp/wails/v3/pkg/application"
)

type Service struct {
	adapter.LifecycleService
	ctx        context.Context
	cancel     context.CancelFunc
	app        *application.App
	window     *application.WebviewWindow
	systray    *application.SystemTray
	lagzap     *lagzap.LagZap
	monitoring *monitoring.Monitoring
	command    *command.Command

	coordinator    *coordinator.Coordinator
	coordinatorURL string
	proxyURL       string
	accessToken    string
	deviceHash     string
	credentials    *handler.SessionCredentialsPayload

	servicePauseFields
}

func (s *Service) New(ctx context.Context, app *application.App) {
	s.ctx = lagzap.Context(ctx, include.InboundRegistry(), include.OutboundRegistry(), include.EndpointRegistry(), include.DNSTransportRegistry())
	s.app = app
}

func (s *Service) StartService() error {
	if s.lagzap != nil {
		_ = s.StopNDIS()
		_ = s.StopService()
	}
	ctx, cancel := context.WithCancel(s.ctx)
	historyStorage := echo.NewHistoryStorage()
	ctx = service.ContextWithPtr(ctx, historyStorage)
	s.cancel = cancel
	s.coordinator = coordinator.New(ctx, cancel, s.app, s.coordinatorURL, s.proxyURL, s.accessToken, s.deviceHash)
	if err := s.coordinator.Connect(); err != nil {
		cancel()
		return err
	}
	credentials, err := s.coordinator.CheckSession()
	if err != nil {
		cancel()
		return err
	}
	s.credentials = credentials
	s.app.EmitEvent("new-session")
	err = s.GetRegions()
	if err != nil {
		return E.Cause(err, "failed to get regions")
	}
	err = s.GetTitles()
	if err != nil {
		return E.Cause(err, "failed to get titles")
	}
	err = s.GetNodes()
	if err != nil {
		return E.Cause(err, "failed to get nodes")
	}

	options := s.coordinator.GetOptions()
	instance, err := lagzap.New(lagzap.Options{
		Context: ctx,
		Options: options,
	})
	if err != nil {
		cancel()
		return E.Cause(err, "create service")
	}
	s.monitoring = monitoring.NewManager(ctx)
	instance.Router().SetTracker(s.monitoring)
	err = instance.Start()
	s.command = command.New(ctx, s.app)
	if err != nil {
		cancel()
		return E.Cause(err, "start service")
	}
	s.lagzap = instance
	s.app.EmitEvent("service-started")
	go s.startMonitoring()
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
	s.monitoring = nil
	s.command = nil
	s.app.EmitEvent("service-stopped")
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

func (s *Service) SetWindow(window *application.WebviewWindow) {
	s.window = window
}

func (s *Service) SetSystray(systray *application.SystemTray) {
	s.systray = systray
}

func (s *Service) SetAccessToken(token string) {
	s.accessToken = token
}

func (s *Service) SetCoordinatorURL(url string) {
	s.coordinatorURL = url
}

func (s *Service) SetProxyURL(url string) {
	s.proxyURL = url
}
