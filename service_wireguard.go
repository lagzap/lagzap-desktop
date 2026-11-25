package main

import (
	"github.com/lagzap/lagzap/adapter"
	E "github.com/lagzap/zap/common/exceptions"
)

// Dedicated IP (WireGuard) configs: the user's own, one list kept on this
// PC only that every profile picks from; the app sees where each connects and whether it works, never keys.

func (s *Service) GetProfileWireGuard(profileID string) adapter.ProfileWireGuard {
	if !s.IsReady() {
		return adapter.ProfileWireGuard{}
	}
	return s.coordinator.ProfileWireGuard(profileID)
}

// AddProfileWireGuard stores a pasted or dropped config (name: its file
// name, or empty) and selects it; the error says what is wrong in it.
func (s *Service) AddProfileWireGuard(profileID, name, config string) (adapter.ProfileWireGuard, error) {
	if !s.IsReady() {
		return adapter.ProfileWireGuard{}, E.New("coordinator_not_ready")
	}
	return s.coordinator.AddProfileWireGuard(profileID, name, config)
}

func (s *Service) SelectProfileWireGuard(profileID, configID string) error {
	if !s.IsReady() {
		return E.New("coordinator_not_ready")
	}
	return s.coordinator.SelectProfileWireGuard(profileID, configID)
}

func (s *Service) SetProfileWireGuardEnabled(profileID string, enabled bool) error {
	if !s.IsReady() {
		return E.New("coordinator_not_ready")
	}
	return s.coordinator.SetProfileWireGuardEnabled(profileID, enabled)
}

// RemoveWireGuardConfig deletes a saved config; profiles using it turn
// Dedicated IP off.
func (s *Service) RemoveWireGuardConfig(configID string) error {
	if !s.IsReady() {
		return E.New("coordinator_not_ready")
	}
	return s.coordinator.RemoveWireGuardConfig(configID)
}

func (s *Service) GetWireGuardStatus(profileID string) adapter.WireGuardStatus {
	if !s.IsReady() {
		return adapter.WireGuardStatus{State: adapter.WireGuardOff}
	}
	return s.coordinator.WireGuardStatus(profileID)
}

// CheckWireGuardConfig measures one config again now (the user clicked its
// ping): its ping in ms (0: no answer), and while its tunnel runs, the
// tunnel's check right away (its status comes on "wireguard-status").
func (s *Service) CheckWireGuardConfig(configID string) int {
	if !s.IsReady() {
		return 0
	}
	return s.coordinator.CheckWireGuard(configID)
}

// PingWireGuardConfigs is each saved config's ping in ms (0: no answer),
// one ICMP echo to its WireGuard server.
func (s *Service) PingWireGuardConfigs() map[string]int {
	if !s.IsReady() {
		return map[string]int{}
	}
	return s.coordinator.WireGuardConfigPings()
}
