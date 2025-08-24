//go:build !windows

package main

import (
	"net/netip"

	"github.com/lagzap/lagzap/option"
	E "github.com/lagzap/zap/common/exceptions"
	F "github.com/lagzap/zap/common/format"
)

func (s *Service) StartProxy() error {
	if s.lagzap == nil {
		return E.New("service is not running")
	}

	return s.lagzap.Inbound().Create(
		s.ctx,
		s.lagzap.Router(),
		s.lagzap.Logger().NewLogger(F.ToString("[tun]")),
		"tun",
		"tun",
		&option.TunInboundOptions{
			InterfaceName: "lagzap",
			AutoRedirect:  true,
			AutoRoute:     true,
			Stack:         "gvisor",
			Address: []netip.Prefix{
				netip.MustParsePrefix("172.18.0.1/30"),
				netip.MustParsePrefix("fdfe:dcba:9876::1/126"),
			},
		},
	)
}

func (s *Service) StopProxy() error {
	if s.lagzap == nil {
		return E.New("tun not found")
	}
	return s.lagzap.Inbound().Remove("tun")
}

func (s *Service) IsProxyRunning() (running bool) {
	if s.lagzap == nil {
		running = false
	} else {
		_, running = s.lagzap.Inbound().Get("tun")
	}
	return
}
