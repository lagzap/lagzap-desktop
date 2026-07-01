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
	connections := s.coordinator.Connections()
	routes := s.coordinator.GetRouteMonitoringData()

	s.app.Event.Emit("connections", connections)
	s.app.Event.Emit("routes", routes)

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
			connections := s.coordinator.Connections()
			routes := s.coordinator.GetRouteMonitoringData()

			s.app.Event.Emit("connections", connections)
			s.app.Event.Emit("routes", routes)
		}
	}
}
