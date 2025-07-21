package main

import (
	"github.com/lagzap/lagzap/adapter"
	"github.com/lagzap/lagzap/coordinator"
)

func (s *Service) ActionTitle(titleId string, action string) error {
	return s.coordinator.Action(coordinator.ClientMessage_ACTION_PROFILE.String(), &coordinator.TitleAction{
		TitleId: titleId,
		Action:  action,
	})
}

func (s *Service) ActionProfile(titleId string, profileId string, action string) error {
	return s.coordinator.Action(coordinator.ClientMessage_ACTION_PROFILE.String(), &coordinator.ProfileAction{
		TitleId:   titleId,
		ProfileId: profileId,
		Action:    action,
	})
}

func (s *Service) FetchData() error {
	var err error
	err = s.coordinator.GetRegions()
	if err != nil {
		return err
	}
	err = s.coordinator.GetTitles()
	if err != nil {
		return err
	}
	err = s.coordinator.GetNodes()
	if err != nil {
		return err
	}
	err = s.coordinator.GetRules()
	if err != nil {
		return err
	}
	return nil
}

func (s *Service) GetRegions() error {
	return s.coordinator.GetRegions()
}

func (s *Service) GetTitles() error {
	return s.coordinator.GetTitles()
}

func (s *Service) GetNodes() error {
	return s.coordinator.GetNodes()
}

func (s *Service) GetEchoResults() map[string]*adapter.NodeEchoResult {
	return s.coordinator.GetEchoResults()
}

func (s *Service) GetEchoProgress() *adapter.TestProgress {
	return s.coordinator.GetEchoProgress()
}

func (s *Service) TestSpecificNode(nodeId string) (*adapter.NodeEchoResult, map[string]*adapter.NodeEchoResult, error) {
	return s.coordinator.TestSpecificNode(nodeId)
}
