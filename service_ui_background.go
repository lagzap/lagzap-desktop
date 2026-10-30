package main

import (
	"sync/atomic"
	"time"
)

// The UI goes quiet while the user is elsewhere (in a game): the main window
// lost focus and no latency overlay is open (that one is meant to be watched
// in game). Live streams then update every few seconds instead of twice a
// second, so the WebView barely draws over the game.
var (
	mainWindowUnfocused atomic.Bool
	latencyOverlayOpen  atomic.Bool
	uiBackground        atomic.Bool
)

// uiBackgroundEvery matches the coordinator's slowed streams.
const uiBackgroundEvery = 3 * time.Second

func (s *Service) setMainWindowFocused(focused bool) {
	mainWindowUnfocused.Store(!focused)
	s.applyUIBackground()
}

func (s *Service) setLatencyOverlayOpen(open bool) {
	latencyOverlayOpen.Store(open)
	s.applyUIBackground()
}

func (s *Service) applyUIBackground() {
	background := mainWindowUnfocused.Load() && !latencyOverlayOpen.Load()
	uiBackground.Store(background)
	if s.coordinator != nil {
		s.coordinator.SetUIBackground(background)
	}
}
