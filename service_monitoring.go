package main

import (
	"time"

	"github.com/lagzap/lagzap/log"
)

type Log struct {
	Time    time.Time `json:"time"`
	Type    string    `json:"type"`
	Payload string    `json:"payload"`
}

func (s *Service) startLogging() {
	subscription, done, err := s.logFactory.Subscribe()
	if err != nil {
		return
	}
	defer s.logFactory.UnSubscribe(subscription)

	var logEntry log.Entry
	for {
		select {
		case <-done:
			return
		case logEntry = <-subscription:
		}
		s.app.Event.Emit("log", Log{
			Time:    time.Now(),
			Type:    log.FormatLevel(logEntry.Level),
			Payload: logEntry.Message,
		})
	}
}

func (s *Service) startMonitoring() {
	if s.monitoring == nil {
		return
	}
	s.app.Event.Emit("connections", s.monitoring.Connections())
	s.app.Event.Emit("closed-connections", s.monitoring.ClosedConnections())

	tick := time.NewTicker(time.Second)
	defer tick.Stop()
	for {
		select {
		case <-s.ctx.Done():
			return
		case <-tick.C:
			if s.lagzap == nil {
				return
			}
			s.app.Event.Emit("connections", s.monitoring.Connections())
			s.app.Event.Emit("closed-connections", s.monitoring.ClosedConnections())
		}
	}
}
