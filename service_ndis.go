//go:build windows

package main

import (
	"github.com/lagzap/lagzap/option"
	"github.com/lagzap/lagzap/protocol/ndis"
	E "github.com/lagzap/zap/common/exceptions"
	F "github.com/lagzap/zap/common/format"
)

type StartNdisOptions struct {
	ProcessTCP    []string `json:"process_tcp,omitempty"`
	ProcessUDP    []string `json:"process_udp,omitempty"`
	InterfaceName string   `json:"interface_name,omitempty"`
}

func (s *Service) StartNDIS(options *StartNdisOptions) error {
	if s.lagzap == nil || s.lagzap.Inbound() == nil {
		return E.New("service is not running")
	}

	return s.lagzap.Inbound().Create(
		s.ctx,
		s.lagzap.Router(),
		s.lagzap.Logger().NewLogger(F.ToString("[ndis] winpkfilter [in]")),
		"ndis",
		"ndis",
		&option.NDISInboundOptions{
			ProcessTCP:    options.ProcessTCP,
			ProcessUDP:    options.ProcessUDP,
			InterfaceName: options.InterfaceName,
		},
	)
}

func (s *Service) StopNDIS() error {
	if s.lagzap == nil || s.lagzap.Inbound() == nil {
		return E.New("ndis not found")
	}
	return s.lagzap.Inbound().Remove("ndis")
}

func (s *Service) AddProcess(process string, tcp, udp bool) error {
	inboundAdapter, ok := s.lagzap.Inbound().Get("ndis")
	if !ok {
		return E.New("ndis not found")
	}
	inbound, ok := inboundAdapter.(*ndis.Inbound)
	if !ok {
		return E.New("inbound is not ndis")
	}
	if err := inbound.AddProcessTCP(process); err != nil {
		return err
	}
	if err := inbound.AddProcessUDP(process); err != nil {
		return err
	}
	return nil
}

func (s *Service) RemoveProcess(process string, tcp, udp bool) error {
	inboundAdapter, ok := s.lagzap.Inbound().Get("ndis")
	if !ok {
		return E.New("ndis not found")
	}
	inbound, ok := inboundAdapter.(*ndis.Inbound)
	if !ok {
		return E.New("inbound is not ndis")
	}

	inbound.RemoveProcessTCP(process)
	inbound.RemoveProcessUDP(process)
	s.monitoring.CloseProcessConnections(process, tcp, udp)

	return nil
}

func (s *Service) HasProcess(process string, tcp, udp bool) (bool, bool, error) {
	inboundAdapter, ok := s.lagzap.Inbound().Get("ndis")
	if !ok {
		return false, false, E.New("ndis not found")
	}
	inbound, ok := inboundAdapter.(*ndis.Inbound)
	if !ok {
		return false, false, E.New("inbound is not ndis")
	}
	return inbound.HasProcessTCP(process), inbound.HasProcessUDP(process), nil
}

func (s *Service) IsNDISRunning() (running bool) {
	if s.lagzap == nil {
		running = false
	} else {
		_, running = s.lagzap.Inbound().Get("ndis")
	}
	return
}
