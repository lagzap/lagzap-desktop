package main

import (
	"sync"

	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"
)

// Wails panics when Focus reaches a window whose WebView2 is not created yet
// (focus reads the controller of a nil chromium). A Show and Focus from
// another goroutine during startup (a second launch, the updater relaunching
// us, the startup gate clearing) can land while another window is still
// embedding, so a focus asked for before a window's runtime is ready waits
// for it instead.

type windowFocusState struct {
	ready   bool
	pending bool
}

var (
	windowFocusMu sync.Mutex
	windowFocus   = map[uint]*windowFocusState{}
)

// trackWindowReady starts tracking a window just created, so focusWindow
// knows when it can take focus.
func trackWindowReady(win application.Window) {
	if win == nil {
		return
	}
	id := win.ID()
	windowFocusMu.Lock()
	windowFocus[id] = &windowFocusState{}
	windowFocusMu.Unlock()
	win.OnWindowEvent(events.Common.WindowRuntimeReady, func(*application.WindowEvent) {
		windowFocusMu.Lock()
		st := windowFocus[id]
		focus := st != nil && st.pending
		if st != nil {
			st.ready, st.pending = true, false
		}
		windowFocusMu.Unlock()
		if focus {
			win.Focus()
		}
	})
}

// focusWindow focuses the window now when it is ready, else once it is.
func focusWindow(win application.Window) {
	if win == nil {
		return
	}
	windowFocusMu.Lock()
	st := windowFocus[win.ID()]
	if st != nil && !st.ready {
		st.pending = true
		windowFocusMu.Unlock()
		return
	}
	windowFocusMu.Unlock()
	win.Focus()
}
