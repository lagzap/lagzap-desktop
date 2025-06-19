package main

import "github.com/lagzap/lagzap-desktop/coordinator/handler"

func (s *Service) ActionTitle(titleId string, action string) error {
	return s.coordinator.ActionTitle(&handler.TitleAction{
		TitleId: titleId,
		Action:  action,
	})
}
