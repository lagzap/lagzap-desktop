//go:build windows

package main

import (
	"net/netip"
	"runtime"

	C "github.com/lagzap/lagzap/constant"
	"github.com/lagzap/lagzap/option"
	E "github.com/lagzap/zap/common/exceptions"
	F "github.com/lagzap/zap/common/format"
)

// Windows captures game traffic with the NDIS driver by default: only
// matched games are taken over, everything else keeps the native stack, and
// no route, DNS or adapter changes. Its sockets carry the physical adapter's
// IP, so unplugging or disabling that adapter makes Windows abort them.
// The optional virtual adapter (TUN) is the system route instead: every
// socket gets the TUN's IP, which never goes away, so adapters can be
// swapped or disabled mid-game. The cost is that all traffic passes through
// LagZap.

const virtualAdapterTag = "tun"

func (s *Service) StartProxy() error {
	if s.lagzap == nil {
		return E.New("service is not running")
	}
	defer s.coordinator.ApplyAllTitleStates()

	if s.virtualAdapter {
		return s.startVirtualAdapter()
	}
	return s.lagzap.Inbound().Create(
		s.ctx,
		s.lagzap.Router(),
		s.lagzap.Logger().NewLogger(F.ToString("[ndis] winpkfilter [in]")),
		"ndis",
		"ndis",
		&option.NDISInboundOptions{
			AutoRoute: false,
		},
	)
}

func (s *Service) startVirtualAdapter() error {
	// Before the TUN takes the route, so LagZap's own unbound sockets never
	// follow it back in.
	s.setTunCapture(true)
	err := s.lagzap.Inbound().Create(
		s.ctx,
		s.lagzap.Router(),
		s.lagzap.Logger().NewLogger(F.ToString("[tun]")),
		virtualAdapterTag,
		C.TypeTun,
		&option.TunInboundOptions{
			InterfaceName: "lagzap",
			AutoRoute:     true,
			Stack:         "gvisor",
			Address: []netip.Prefix{
				netip.MustParsePrefix("172.18.0.1/30"),
				netip.MustParsePrefix("fdfe:dcba:9876::1/126"),
			},
		},
	)
	if err != nil {
		s.setTunCapture(false)
	}
	return err
}

func (s *Service) setTunCapture(enabled bool) {
	if nm, ok := s.lagzap.Network().(interface{ SetTunCapture(bool) }); ok {
		nm.SetTunCapture(enabled)
	}
}

func (s *Service) StopProxy() error {
	defer runtime.GC()
	if s.lagzap == nil {
		return E.New("ndis not found")
	}
	if _, ok := s.lagzap.Inbound().Get(virtualAdapterTag); ok {
		err := s.lagzap.Inbound().Remove(virtualAdapterTag)
		s.setTunCapture(false)
		return err
	}
	return s.lagzap.Inbound().Remove("ndis")
}

func (s *Service) IsProxyRunning() (running bool) {
	if s.lagzap == nil {
		return false
	}
	if _, running = s.lagzap.Inbound().Get("ndis"); running {
		return true
	}
	_, running = s.lagzap.Inbound().Get(virtualAdapterTag)
	return running
}

// SetVirtualAdapter picks the capture mode (Multi Internet page). A running
// capture is restarted in the new mode; game connections open at the switch
// keep the IP they started with.
func (s *Service) SetVirtualAdapter(enabled bool) error {
	if s.virtualAdapter == enabled {
		return nil
	}
	s.virtualAdapter = enabled
	if !s.IsProxyRunning() {
		return nil
	}
	if err := s.StopProxy(); err != nil {
		return E.Cause(err, "stop capture")
	}
	err := s.StartProxy()
	if err != nil && enabled {
		// Never leave games uncaptured: back to NDIS.
		s.virtualAdapter = false
		if fallbackErr := s.StartProxy(); fallbackErr != nil {
			return E.Errors(err, fallbackErr)
		}
		return E.Cause(err, "start virtual adapter")
	}
	return err
}
