package main

import (
	"context"
	"fmt"

	"github.com/lagzap/lagzap"
	"github.com/lagzap/lagzap-desktop/constant"
	"github.com/lagzap/lagzap-desktop/localproxy"
	"github.com/lagzap/lagzap/adapter"
	"github.com/lagzap/lagzap/common/device"
	lagzapConstant "github.com/lagzap/lagzap/constant"
	"github.com/lagzap/lagzap/include"
	"github.com/lagzap/lagzap/log"
	"github.com/lagzap/zap/common/control"
	E "github.com/lagzap/zap/common/exceptions"
	"github.com/lagzap/zap/service"
	"github.com/wailsapp/wails/v3/pkg/application"
)

type Service struct {
	adapter.LifecycleService
	ctx              context.Context
	runtimeCtx       context.Context
	cancel           context.CancelFunc
	app              *application.App
	window           *application.WebviewWindow
	systray          *application.SystemTray
	lagzap           *lagzap.LagZap
	coordinator      adapter.Coordinator
	dnsRouter        adapter.DNSRouter
	logFactory       log.ObservableFactory
	localProxy       *localproxy.Proxy
	proxyDNSRequests bool
	// virtualAdapter: on Windows, capture through LagZap's TUN instead of
	// the NDIS driver (service_proxy_windows.go).
	virtualAdapter bool
}

const (
	LAGZAP_DEFAULT_SESSION_ID    = "00000000-0000-0000-0000-000000000000"
	LAGZAP_DEFAULT_SUBSCRIBER_ID = "00000000-0000-0000-0000-000000000000"
)

func (s *Service) New(ctx context.Context, app *application.App) {
	lagzapConstant.SetShellVersion(constant.SemVer())
	s.ctx = lagzap.Context(ctx, include.InboundRegistry(), include.OutboundRegistry(), include.EndpointRegistry(), include.DNSTransportRegistry(), include.ServiceRegistry())
	s.app = app
}

func (s *Service) ReloadService() error {
	lagzapConstant.SetShellVersion(constant.SemVer())
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
	device.WarmDeviceHash()
	s.runtimeCtx = ctx
	s.dnsRouter = service.FromContext[adapter.DNSRouter](ctx)
	s.coordinator = service.FromContext[adapter.Coordinator](ctx)
	s.coordinator.Listen(func(event string, data any) {
		// Never jsonClone here. Cloning every coordinator event under connection
		// storms (Telegram etc.) stalls the dial path — connections appear but
		// are not proxied. Snapshot cloning belongs only in startMonitoring /
		// GetConnections / GetLatestRouteProbes (once per second).
		s.app.Event.Emit(event, data)
	})
	if settings := s.coordinator.GetClientSettings(); settings != nil && settings.ProxyDnsRequests != nil {
		s.proxyDNSRequests = settings.GetProxyDnsRequests()
	}
	if err := s.applyProxyDNSConfig(); err != nil {
		fmt.Printf("proxy dns config: %v\n", err)
	}
	s.lagzap = instance

	if err := s.discoverAndStartLocalProxy(); err != nil {
		_ = s.StopService()
		return E.Cause(err, "discover and start local proxy")
	}
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
	if s.coordinator != nil {
		s.coordinator.Disconnect()
	}
	if s.runtimeCtx != nil {
		if winpkFilter := service.FromContext[adapter.WinpkFilter](s.runtimeCtx); winpkFilter != nil {
			winpkFilter.SetProxyDNSRequests(false)
		}
	}
	_ = s.StopProxy()
	if s.cancel != nil {
		s.cancel()
	}
	err := s.lagzap.Close()
	s.lagzap = nil
	s.coordinator = nil
	s.dnsRouter = nil
	s.runtimeCtx = nil
	s.app.Event.Emit("service-stopped")
	if bootstrapErr := s.StartBootstrapLocalProxy(); bootstrapErr != nil {
		fmt.Printf("localproxy bootstrap after stop: %v\n", bootstrapErr)
	}
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

// GetDefaultInterfaceFallback says whether LagZap left the main adapter
// because it has no internet, and which one it uses meanwhile.
func (s *Service) GetDefaultInterfaceFallback() adapter.DefaultInterfaceFallback {
	if s.coordinator == nil {
		return adapter.DefaultInterfaceFallback{}
	}
	return s.coordinator.DefaultInterfaceFallback()
}

// SetAdapterOrder sets the adapter order of the Multi Internet page: the
// order backups take over in, the Default first.
func (s *Service) SetAdapterOrder(names []string) {
	if s.coordinator == nil {
		return
	}
	s.coordinator.SetAdapterOrder(names)
}

// RateSession sends the user's rating of a session the
// "stats-rate-session" event asked about.
func (s *Service) RateSession(sessionID string, stars uint32, reasons []string, comment string) error {
	if s.coordinator == nil {
		return nil
	}
	return s.coordinator.RateSession(sessionID, stars, reasons, comment)
}

// GetConnectionDetails explains one Connections page row: how its profile
// carries it and the legs it uses now.
func (s *Service) GetConnectionDetails(id string) *adapter.ConnectionDetails {
	if s.coordinator == nil {
		return nil
	}
	return s.coordinator.GetConnectionDetails(id)
}

func (s *Service) NeedWIFIState() bool {
	return s.lagzap.Router().NeedWIFIState()
}

func (s *Service) IsRunning() bool {
	return s.lagzap != nil
}

func (s *Service) GetVersion() string {
	return constant.SemVer()
}

func (s *Service) GetChannel() string {
	return constant.Channel()
}

func (s *Service) CheckForUpdates() error {
	return checkForUpdates(s.app)
}

func (s *Service) IsReady() bool {
	return s.coordinator != nil
}

func (s *Service) IsConnected() bool {
	return s.coordinator != nil && s.coordinator.Status() == adapter.StatusConnected
}

func (s *Service) IsConnecting() bool {
	if s.coordinator == nil {
		return false
	}
	return s.coordinator.IsConnecting()
}

func (s *Service) CancelConnect() {
	if s.coordinator == nil {
		return
	}
	s.coordinator.CancelConnect()
}

func (s *Service) SetWindow(window *application.WebviewWindow) {
	s.window = window
}

func (s *Service) SetSystray(systray *application.SystemTray) {
	s.systray = systray
}

// StartBootstrapLocalProxy starts the auth API proxy before ReloadService so the
// embedded frontend can reach /data and /token on first load (production builds).
func (s *Service) StartBootstrapLocalProxy() error {
	if s.localProxy != nil && s.localProxy.Running() {
		return nil
	}
	target, err := localproxy.DiscoverUpstream(s.ctx, nil, constant.Version, nil)
	if err != nil {
		fmt.Printf("localproxy bootstrap upstream: %v (using %s)\n", err, target)
	}
	return s.StartLocalProxy(target)
}

func (s *Service) IsLocalProxyRunning() bool {
	return s.localProxy != nil && s.localProxy.Running()
}

func (s *Service) discoverAndStartLocalProxy() error {
	if s.coordinator != nil {
		hostnames, hostErr := localproxy.DiscoverCoordinatorHosts(s.ctx, s.dnsRouter, constant.Version)
		if len(hostnames) > 0 {
			s.coordinator.AppendDiscoveredEndpoints(hostnames)
			if hostErr != nil {
				fmt.Printf("coordinator: using channel fallbacks %v (TXT: %v)\n", hostnames, hostErr)
			} else {
				fmt.Printf("coordinator: endpoints from discovery: %v\n", hostnames)
			}
		} else if hostErr != nil {
			fmt.Printf("coordinator: endpoint discovery skipped: %v\n", hostErr)
		}
	}
	return s.rediscoverLocalProxyUpstream()
}

func (s *Service) rediscoverLocalProxyUpstream() error {
	coordEndpoints := []string(nil)
	if s.coordinator != nil {
		coordEndpoints = s.coordinator.Endpoints()
	}
	target, err := localproxy.DiscoverUpstream(s.ctx, s.dnsRouter, constant.Version, coordEndpoints)
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
	return s.localProxy.Start(localproxy.Config{
		Target:    target,
		Context:   s.ctx,
		DNS:       s.dnsRouter,
		BindIface: func() string { return localproxy.BindInterface(s.coordinator) },
	})
}

func (s *Service) StopLocalProxy() error {
	if s.localProxy == nil {
		return nil
	}
	return s.localProxy.Stop()
}
