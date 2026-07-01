package main

import (
	"fmt"

	"github.com/lagzap/lagzap/adapter"
	"github.com/lagzap/lagzap/common/device"
	"github.com/lagzap/lagzap/log"
	E "github.com/lagzap/zap/common/exceptions"
	D "github.com/lagzap/zap/data"
)

func (s *Service) SetAccessToken(token string) {
	if s.coordinator == nil {
		return
	}
	s.coordinator.SetToken(token)
}

func (s *Service) SetSyncTransportMode(mode adapter.SyncTransportMode) {
	if s.coordinator == nil {
		return
	}
	s.coordinator.SetSyncTransportMode(mode)
}

func (s *Service) SetHTTPPolling(enabled bool) {
	if s.coordinator == nil {
		return
	}
	s.coordinator.SetHTTPPolling(enabled)
}

func (s *Service) SetEndpoints(hostnames []string) {
	if s.coordinator == nil {
		return
	}
	s.coordinator.SetEndpoints(hostnames)
	if len(hostnames) == 0 || !s.IsRunning() {
		return
	}
	if err := s.rediscoverLocalProxyUpstream(); err != nil {
		fmt.Printf("localproxy: rediscover after SetEndpoints: %v\n", err)
	}
}

func (s *Service) SetLogLevel(logLevel string) {
	if s.coordinator == nil {
		return
	}
	level, err := log.ParseLevel(logLevel)
	if err != nil {
		return
	}
	s.logFactory.SetLevel(level)
}

func (s *Service) Connect() error {
	if s.coordinator == nil {
		return E.New("coordinator_not_ready")
	}
	return s.coordinator.Connect()
}

func (s *Service) Disconnect() {
	if s.coordinator == nil {
		return
	}
	s.coordinator.Disconnect()
}

func (s *Service) Status() adapter.ConnectionStatus {
	if s.coordinator == nil {
		return adapter.StatusDisconnected
	}
	return s.coordinator.Status()
}

func (s *Service) DeviceHash() string {
	return device.DeviceHash()
}

func (s *Service) Credentials() D.CredentialsPayload {
	return *s.coordinator.GetCredentials()
}

func (s *Service) SyncData() error {
	if !s.IsReady() {
		return E.New("coordinator_not_ready")
	}
	return s.coordinator.SyncData(false)
}

func (s *Service) GetRegions() map[string]*D.Region {
	if !s.IsReady() {
		return nil
	}
	return s.coordinator.GetRegions()
}

func (s *Service) GetTitles() map[string]*D.Title {
	if !s.IsReady() {
		return nil
	}
	return s.coordinator.GetTitles()
}

func (s *Service) GetProfiles() map[string]*D.Profile {
	if !s.IsReady() {
		return nil
	}
	return s.coordinator.GetProfiles()
}

func (s *Service) GetTitleStates() map[string]*D.TitleState {
	if !s.IsReady() {
		return nil
	}
	return s.coordinator.GetTitleStates()
}

func (s *Service) GetProfileStates() map[string]*D.ProfileState {
	if !s.IsReady() {
		return nil
	}
	return s.coordinator.GetProfileStates()
}

func (s *Service) GetClientInfo() *D.ClientInfo {
	if !s.IsReady() {
		return nil
	}
	return s.coordinator.GetClientInfo()
}

func (s *Service) GetNodes() map[string]*D.Node {
	if !s.IsReady() {
		return nil
	}
	return s.coordinator.GetNodes()
}

func (s *Service) VisitTitle(titleId string) {
	if !s.IsReady() {
		return
	}
	s.coordinator.VisitTitle(titleId)
}

func (s *Service) SaveTitleState(titleState *D.TitleState) error {
	if !s.IsReady() {
		return E.New("coordinator_not_ready")
	}
	err := s.coordinator.SaveTitleState(titleState)
	if err != nil {
		return E.Cause(err, "could not save title state in cloud")
	}
	if err := s.coordinator.ApplyTitleState(titleState); err != nil {
		return E.Cause(err, "could not apply title state in cloud")
	}
	return nil
}

func (s *Service) SaveProfileState(profileState *D.ProfileState) error {
	if !s.IsReady() {
		return E.New("coordinator_not_ready")
	}
	if err := s.coordinator.SaveProfileState(profileState); err != nil {
		return E.Cause(err, "could not save title state in cloud")
	}
	return s.coordinator.ApplyProfileState(profileState)
}

func (s *Service) StartOptimizing() {
	if !s.IsReady() {
		return
	}
	s.coordinator.StartOptimizing(true)
}

func (s *Service) GetRoutes() map[string]*D.RelayRoute {
	if !s.IsReady() {
		return nil
	}
	return s.coordinator.GetRelayRoutes()
}

func (s *Service) GetRoutes2() []*D.Route {
	if !s.IsReady() {
		return nil
	}
	rr, _ := s.coordinator.GetRoutes()
	return rr
}

func (s *Service) GetOptimizeProgress() *D.Optimize {
	if !s.IsReady() {
		return nil
	}
	return s.coordinator.GetOptimize()
}

func (s *Service) TestSpecificNode(nodeId string) (map[string]*D.RelayRoute, error) {
	if !s.IsReady() {
		return nil, E.New("coordinator_not_ready")
	}
	return s.coordinator.OptimizeSpecificNode(nodeId)
}

func (s *Service) ClearDNSCache() {
	s.coordinator.ClearDNSCache()
}

func (s *Service) GetLatency() *D.Latency {
	return s.coordinator.GetLatency()
}
