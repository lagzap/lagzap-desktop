package main

import (
	"github.com/lagzap/lagzap/adapter"
	"github.com/lagzap/lagzap/common/device"
	"github.com/lagzap/lagzap/log"
	E "github.com/lagzap/zap/common/exceptions"
	"google.golang.org/protobuf/proto"
)

func (s *Service) SetAccessToken(token string) {
	if s.coordinator == nil {
		return
	}
	s.coordinator.SetToken(token)
}

func (s *Service) SetEndpoints(hostnames []string) {
	if s.coordinator == nil {
		return
	}
	s.coordinator.SetEndpoints(hostnames)
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

func (s *Service) Connect() {
	if s.coordinator == nil {
		return
	}
	s.coordinator.Connect()
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

func (s *Service) Credentials() adapter.CredentialsPayload {
	return *s.coordinator.GetCredentials()
}

func (s *Service) FetchData() error {
	if !s.IsReady() {
		return E.New("coordinator_not_ready")
	}
	var err error
	err = s.coordinator.RequestRegions()
	if err != nil {
		return err
	}
	err = s.coordinator.RequestTitles()
	if err != nil {
		return err
	}
	err = s.coordinator.RequestProfiles()
	if err != nil {
		return err
	}
	err = s.coordinator.RequestServerVersions()
	if err != nil {
		return err
	}
	err = s.coordinator.RequestNodes()
	if err != nil {
		return err
	}
	err = s.coordinator.RequestRules()
	if err != nil {
		return err
	}
	err = s.coordinator.RequestRoutes()
	if err != nil {
		return err
	}
	err = s.coordinator.RequestUserData()
	if err != nil {
		return err
	}
	return nil
}

func (s *Service) GetRegions() map[string]*adapter.Region {
	if !s.IsReady() {
		return nil
	}
	return s.coordinator.GetRegions()
}

func (s *Service) GetTitles() map[string]*adapter.Title {
	if !s.IsReady() {
		return nil
	}
	return s.coordinator.GetTitles()
}

func (s *Service) GetProfiles() map[string]*adapter.Profile {
	if !s.IsReady() {
		return nil
	}
	return s.coordinator.GetProfiles()
}

func (s *Service) GetTitleStates() map[string]*adapter.TitleState {
	if !s.IsReady() {
		return nil
	}
	return s.coordinator.GetTitleStates()
}

func (s *Service) GetProfileStates() map[string]*adapter.ProfileState {
	if !s.IsReady() {
		return nil
	}
	return s.coordinator.GetProfileStates()
}

func (s *Service) GetNodes() map[string]*adapter.Node {
	if !s.IsReady() {
		return nil
	}
	return s.coordinator.GetNodes()
}

func (s *Service) ActionTitle(titleState *adapter.TitleState) (*adapter.TitleState, error) {
	if !s.IsReady() {
		return nil, E.New("coordinator_not_ready")
	}
	message, err := s.coordinator.Action(adapter.ClientMessage_ACTION_TITLE, titleState)
	if err != nil {
		return nil, err
	}
	var payload adapter.TitleState
	if err := proto.Unmarshal(message.Payload, &payload); err != nil {
		return nil, err
	}
	return s.coordinator.ActionTitle(&payload)
}

func (s *Service) ActionProfile(profileState *adapter.ProfileState) (*adapter.ProfileState, error) {
	if !s.IsReady() {
		return nil, E.New("coordinator_not_ready")
	}
	message, err := s.coordinator.Action(adapter.ClientMessage_ACTION_PROFILE, profileState)
	if err != nil {
		return nil, err
	}
	var payload adapter.ProfileState
	if err := proto.Unmarshal(message.Payload, &payload); err != nil {
		return nil, err
	}
	return s.coordinator.ActionProfile(&payload)
}

func (s *Service) StartOptimizing() {
	if !s.IsReady() {
		return
	}
	s.coordinator.StartOptimizing(true)
}

func (s *Service) GetRoutes() map[string]*adapter.RelayRoute {
	if !s.IsReady() {
		return nil
	}
	return s.coordinator.GetRelayRoutes()
}

func (s *Service) GetRoutes2() []*adapter.Route {
	if !s.IsReady() {
		return nil
	}
	rr, _ := s.coordinator.GetRoutes()
	return rr
}

func (s *Service) GetOptimizeProgress() *adapter.Optimize {
	if !s.IsReady() {
		return nil
	}
	return s.coordinator.GetOptimize()
}

func (s *Service) TestSpecificNode(nodeId string) (map[string]*adapter.RelayRoute, error) {
	if !s.IsReady() {
		return nil, E.New("coordinator_not_ready")
	}
	return s.coordinator.OptimizeSpecificNode(nodeId)
}
