//go:build windows

package main

import (
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
		s.lagzap.Logger().NewLogger(F.ToString("[ndis] winpkfilter [in]")),
		"ndis",
		"ndis",
		&option.NDISInboundOptions{},
	)
}

func (s *Service) StopProxy() error {
	if s.lagzap == nil {
		return E.New("ndis not found")
	}
	return s.lagzap.Inbound().Remove("ndis")
}

func (s *Service) IsProxyRunning() (running bool) {
	if s.lagzap == nil {
		running = false
	} else {
		_, running = s.lagzap.Inbound().Get("ndis")
	}
	return
}
