package main

import (
	"sync"

	"github.com/lagzap/lagzap-desktop/constant"
	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"
)

const adminToolsWindowName = "admin-tools"

var (
	adminToolsMu     sync.Mutex
	adminToolsWindow application.Window
)

// AdminToolsEnabled reports whether Admin Tools are available on this build.
func (s *Service) AdminToolsEnabled() bool {
	return constant.AdminToolsEnabled()
}

// OpenAdminTools opens (or focuses) the Admin Tools window. No-op outside
// dev/alpha (and wails DevBuild).
func (s *Service) OpenAdminTools() {
	if s.app == nil || !constant.AdminToolsEnabled() {
		return
	}

	adminToolsMu.Lock()
	defer adminToolsMu.Unlock()

	if win, ok := s.app.Window.GetByName(adminToolsWindowName); ok && win != nil {
		adminToolsWindow = win
		win.Show()
		win.Focus()
		s.app.Event.Emit("admin-tools-opened", nil)
		return
	}

	win := s.app.Window.NewWithOptions(application.WebviewWindowOptions{
		Name:               adminToolsWindowName,
		Title:              "Admin Tools",
		Width:              1100,
		Height:             800,
		MinWidth:           800,
		MinHeight:          600,
		ZoomControlEnabled: false,
		Frameless:          true,
		BackgroundColour:   application.NewRGBA(10, 10, 10, 255),
		URL:                "/#/admin/connections",
		Windows: application.WindowsWindow{
			DisableIcon:             true,
			BackdropType:            application.Mica,
			Theme:                   application.SystemDefault,
			GeneralAutofillEnabled:  false,
			PasswordAutosaveEnabled: false,
			CustomTheme: application.ThemeSettings{
				DarkModeActive: &application.WindowTheme{
					BorderColour:    func() *uint32 { v := uint32(0x002D2D2D); return &v }(),
					TitleBarColour:  func() *uint32 { v := uint32(0x00050a09); return &v }(),
					TitleTextColour: func() *uint32 { v := uint32(0x00FFFFFF); return &v }(),
				},
				DarkModeInactive: &application.WindowTheme{
					BorderColour:    func() *uint32 { v := uint32(0x00171717); return &v }(),
					TitleBarColour:  func() *uint32 { v := uint32(0x00050a09); return &v }(),
					TitleTextColour: func() *uint32 { v := uint32(0x00C8C8C8); return &v }(),
				},
				LightModeActive: &application.WindowTheme{
					BorderColour:    func() *uint32 { v := uint32(0x00FFFFFF); return &v }(),
					TitleBarColour:  func() *uint32 { v := uint32(0x00FFFFFF); return &v }(),
					TitleTextColour: func() *uint32 { v := uint32(0x00000000); return &v }(),
				},
				LightModeInactive: &application.WindowTheme{
					BorderColour:    func() *uint32 { v := uint32(0x00FFFFFF); return &v }(),
					TitleBarColour:  func() *uint32 { v := uint32(0x00FFFFFF); return &v }(),
					TitleTextColour: func() *uint32 { v := uint32(0x00000000); return &v }(),
				},
			},
		},
		Linux: application.LinuxWindow{
			WebviewGpuPolicy: application.WebviewGpuPolicyAlways,
		},
	})

	adminToolsWindow = win
	win.OnWindowEvent(events.Common.WindowClosing, func(e *application.WindowEvent) {
		adminToolsMu.Lock()
		adminToolsWindow = nil
		adminToolsMu.Unlock()
		s.app.Event.Emit("admin-tools-closed", nil)
	})

	win.Show()
	win.Focus()
	s.app.Event.Emit("admin-tools-opened", nil)
}

// CloseAdminTools closes the Admin Tools window.
func (s *Service) CloseAdminTools() {
	if s.app == nil {
		return
	}

	adminToolsMu.Lock()
	win := adminToolsWindow
	if win == nil {
		if existing, ok := s.app.Window.GetByName(adminToolsWindowName); ok {
			win = existing
		}
	}
	adminToolsMu.Unlock()

	if win != nil {
		win.Close()
	}
}

// IsAdminToolsOpen reports whether the Admin Tools window is visible.
func (s *Service) IsAdminToolsOpen() bool {
	if s.app == nil {
		return false
	}
	win, ok := s.app.Window.GetByName(adminToolsWindowName)
	return ok && win != nil && win.IsVisible()
}
