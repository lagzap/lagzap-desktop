package main

import (
	"sync"

	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"
)

const latencyOverlayWindowName = "latency-overlay"

var (
	latencyOverlayMu     sync.Mutex
	latencyOverlayWindow application.Window
)

// OpenLatencyOverlay opens (or focuses) a frameless always-on-top latency chart window.
func (s *Service) OpenLatencyOverlay() {
	if s.app == nil {
		return
	}

	latencyOverlayMu.Lock()
	defer latencyOverlayMu.Unlock()

	if win, ok := s.app.Window.GetByName(latencyOverlayWindowName); ok && win != nil {
		latencyOverlayWindow = win
		win.Show()
		win.Focus()
		s.app.Event.Emit("latency-overlay-opened", nil)
		return
	}

	win := s.app.Window.NewWithOptions(application.WebviewWindowOptions{
		Name:             latencyOverlayWindowName,
		Title:            "Latency",
		Width:            420,
		Height:           300,
		MinWidth:         300,
		MinHeight:        180,
		AlwaysOnTop:      true,
		Frameless:        true,
		BackgroundType:   application.BackgroundTypeTransparent,
		BackgroundColour: application.NewRGBA(18, 18, 18, 230),
		URL:              "/#/latency-overlay",
		ZoomControlEnabled: false,
		Windows: application.WindowsWindow{
			DisableIcon:                      true,
			BackdropType:                     application.None,
			DisableFramelessWindowDecorations: true,
			GeneralAutofillEnabled:           false,
			PasswordAutosaveEnabled:          false,
		},
		Linux: application.LinuxWindow{
			WebviewGpuPolicy: application.WebviewGpuPolicyAlways,
		},
	})

	latencyOverlayWindow = win
	win.OnWindowEvent(events.Common.WindowClosing, func(e *application.WindowEvent) {
		latencyOverlayMu.Lock()
		latencyOverlayWindow = nil
		latencyOverlayMu.Unlock()
		s.app.Event.Emit("latency-overlay-closed", nil)
	})

	win.Show()
	win.Focus()
	s.app.Event.Emit("latency-overlay-opened", nil)
}

// CloseLatencyOverlay docks the latency overlay back (closes the pop-out window).
func (s *Service) CloseLatencyOverlay() {
	if s.app == nil {
		return
	}

	latencyOverlayMu.Lock()
	win := latencyOverlayWindow
	if win == nil {
		if existing, ok := s.app.Window.GetByName(latencyOverlayWindowName); ok {
			win = existing
		}
	}
	latencyOverlayMu.Unlock()

	if win != nil {
		win.Close()
	}
}

// IsLatencyOverlayOpen reports whether the pop-out latency window is visible.
func (s *Service) IsLatencyOverlayOpen() bool {
	if s.app == nil {
		return false
	}
	win, ok := s.app.Window.GetByName(latencyOverlayWindowName)
	return ok && win != nil && win.IsVisible()
}

// SetLatencyOverlayAlwaysOnTop toggles always-on-top for the latency overlay window.
func (s *Service) SetLatencyOverlayAlwaysOnTop(alwaysOnTop bool) {
	if s.app == nil {
		return
	}
	win, ok := s.app.Window.GetByName(latencyOverlayWindowName)
	if !ok || win == nil {
		return
	}
	win.SetAlwaysOnTop(alwaysOnTop)
}
