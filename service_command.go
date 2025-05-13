package main

import (
	"github.com/lagzap/lagzap/adapter"
)

func (s *Service) Nodes() map[string]*adapter.EchoResult {
	return s.command.Nodes()
}

func (s *Service) GetLatency(force bool) error {
	return s.command.GetLatency(force)
}

func (s *Service) PingOutbound(outbound string) (map[string]*adapter.EchoResult, error) {
	return s.command.PingOutbound(outbound)
}
