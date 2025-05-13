package main

import (
	"context"
	"crypto/md5"
	"encoding/hex"

	"github.com/jaypipes/ghw"
	"github.com/lagzap/lagzap"
	"github.com/lagzap/lagzap-desktop/command"
	"github.com/lagzap/lagzap-desktop/monitoring"
	"github.com/lagzap/lagzap/adapter"
	"github.com/lagzap/lagzap/adapter/echo"
	"github.com/lagzap/lagzap/include"
	"github.com/lagzap/lagzap/option"
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

	options option.Options

	servicePauseFields
}

func (s *Service) New(ctx context.Context, app *application.App) {
	s.ctx = lagzap.Context(ctx, include.InboundRegistry(), include.OutboundRegistry(), include.EndpointRegistry(), include.DNSTransportRegistry())
	s.app = app
}

func (s *Service) SetWindow(window *application.WebviewWindow) {
	s.window = window
}

func (s *Service) SetSystray(systray *application.SystemTray) {
	s.systray = systray
}

func (s *Service) StartService(logLevel string, regions []Region, nodes []Node, ruleSet []HeadlessRule) error {
	if s.lagzap != nil {
		_ = s.StopNDIS()
		_ = s.StopService()
	}
	options, err := createConfig(logLevel, regions, nodes, ruleSet)
	if err != nil {
		return err
	}
	s.options = options
	ctx, cancel := context.WithCancel(s.ctx)
	historyStorage := echo.NewHistoryStorage()
	ctx = service.ContextWithPtr(ctx, historyStorage)
	s.cancel = cancel
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

func (s *Service) DeviceHash() string {
	info , err := ghw.CPU()
	if err != nil{
		return ""
	}
	bios , err := ghw.BIOS()
	if err != nil{
		return ""
	} 
	base , err := ghw.Baseboard()
	if err != nil{
		return ""
	} 
	Block , err := ghw.Block()
	if err != nil{
		return ""
	}
	data := Block.String() + base.String() + bios.String() + info.String()
	return md5Hash(data)
}

func (s *Service) IsRunning() bool {
	return s.lagzap != nil
}

func md5Hash(data string) string{
	hash := md5.New()
	hash.Write([]byte(data))
	return hex.EncodeToString(hash.Sum(nil))
}