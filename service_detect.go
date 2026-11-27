package main

import "github.com/lagzap/lagzap/adapter"

// DetectedTitles is the titles whose programs this PC has used, the most
// used first, for Home's suggestions. It stays on this PC.
func (s *Service) DetectedTitles() []adapter.DetectedTitle {
	if s.coordinator == nil {
		return []adapter.DetectedTitle{}
	}
	titles := s.coordinator.DetectedTitles()
	if titles == nil {
		return []adapter.DetectedTitle{}
	}
	return titles
}
