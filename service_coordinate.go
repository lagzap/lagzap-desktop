package main

import (
	"github.com/lagzap/lagzap/adapter"
)

func (s *Service) FetchData() error {
	var err error
	err = s.coordinator.RequestRegions()
	if err != nil {
		return err
	}
	err = s.coordinator.RequestTitles()
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
	err = s.coordinator.RequestRules()
	if err != nil {
		return err
	}
	return nil
}

func (s *Service) GetRegions() map[string]*adapter.Region {
	return s.coordinator.GetRegions()
}

func (s *Service) GetTitles() map[string]*adapter.Title {
	return s.coordinator.GetTitles()
}

func (s *Service) GetTitleStates() map[string]*adapter.TitleState {
	return s.coordinator.GetTitleStates()
}

func (s *Service) GetProfileStates() map[string]*adapter.ProfileState {
	return s.coordinator.GetProfileStates()
}

func (s *Service) GetNodes() map[string]*adapter.Node {
	return s.coordinator.GetNodes()
}

func (s *Service) ActionTitle(titleId string, payload *adapter.TitleState) (*adapter.TitleState, error) {
	return s.coordinator.ActionTitle(titleId, payload)
}

func (s *Service) ActionProfile(profileId string, payload *adapter.ProfileState) (*adapter.ProfileState, error) {
	return s.coordinator.ActionProfile(profileId, payload)
}

func (s *Service) StartOptimizing() {
	s.coordinator.StartOptimizing()
}

func (s *Service) GetOptimizeResults() map[string]*adapter.NodeOptimizeResult {
	return s.coordinator.GetOptimizeResults()
}

func (s *Service) GetOptimizeProgress() *adapter.OptimizeProgress {
	return s.coordinator.GetOptimizeProgress()
}

func (s *Service) TestSpecificNode(nodeId string) (*adapter.NodeOptimizeResult, map[string]*adapter.NodeOptimizeResult, error) {
	return s.coordinator.OptimizeSpecificNode(nodeId)
}
