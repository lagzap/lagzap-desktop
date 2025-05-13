package main

import (
	"sync"
	"time"
)

type servicePauseFields struct {
	pauseAccess sync.Mutex
	pauseTimer  *time.Timer
}

func (s *Service) Pause() {
	s.pauseAccess.Lock()
	defer s.pauseAccess.Unlock()
	if s.pauseTimer != nil {
		s.pauseTimer.Stop()
	}
	s.pauseTimer = time.AfterFunc(3*time.Second, s.ResetNetwork)
}

func (s *Service) Wake() {
	s.pauseAccess.Lock()
	defer s.pauseAccess.Unlock()
	if s.pauseTimer != nil {
		s.pauseTimer.Stop()
	}
	s.pauseTimer = time.AfterFunc(3*time.Minute, s.ResetNetwork)
}

func (s *Service) ResetNetwork() {
	s.lagzap.Router().ResetNetwork()
}
