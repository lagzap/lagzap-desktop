package main

import (
	"github.com/lagzap/lagzap/adapter"
	C "github.com/lagzap/lagzap/constant"
	E "github.com/lagzap/zap/common/exceptions"
	"github.com/lagzap/zap/service"
)

func (s *Service) applyProxyDNSConfig() error {
	if s.lagzap == nil || s.runtimeCtx == nil || s.logFactory == nil {
		return nil
	}

	if winpkFilter := service.FromContext[adapter.WinpkFilter](s.runtimeCtx); winpkFilter != nil {
		winpkFilter.SetProxyDNSRequests(s.proxyDNSRequests)
	}

	transportMgr := service.FromContext[adapter.DNSTransportManager](s.runtimeCtx)
	if transportMgr == nil {
		return E.New("dns transport manager unavailable")
	}
	err := transportMgr.Create(
		s.runtimeCtx,
		s.logFactory.Logger(),
		"remote-lagzap",
		C.DNSTypeUDP,
		remoteLagZapDNSServerOptions(s.proxyDNSRequests),
	)
	if err != nil {
		return E.Cause(err, "update remote-lagzap dns transport")
	}

	defaultTag := "local"
	if s.proxyDNSRequests {
		defaultTag = "remote-lagzap"
	}
	if err := transportMgr.SetDefault(defaultTag); err != nil {
		return E.Cause(err, "update default dns server")
	}

	if s.coordinator != nil {
		_ = s.coordinator.ApplyAllProfileStates()
	}
	return nil
}
