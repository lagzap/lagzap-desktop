package main

import (
	"os"

	"github.com/lagzap/lagzap-desktop/constant"
	"github.com/wailsapp/wails/v3/pkg/application"
	D "github.com/lagzap/zap/data"
)

const startupMinimizeArg = "--minimized"

func isDevBuild() bool {
	if constant.IsDevBuild() {
		return true
	}
	return os.Getenv("FRONTEND_DEVSERVER_URL") != ""
}

func disableAutostartIfDev(app *application.App) {
	if !isDevBuild() || app == nil || app.Autostart == nil {
		return
	}
	_ = app.Autostart.Disable()
}

func (s *Service) applyStartupSettings(settings *D.ClientSettings) {
	if s.app == nil || s.app.Autostart == nil || settings == nil {
		return
	}
	if isDevBuild() {
		_ = s.app.Autostart.Disable()
		return
	}
	if !settings.GetLaunchOnStartup() {
		_ = s.app.Autostart.Disable()
		return
	}
	opts := application.AutostartOptions{}
	if settings.GetLaunchOnStartupMinimize() {
		opts.Arguments = []string{startupMinimizeArg}
	}
	_ = s.app.Autostart.EnableWithOptions(opts)
}

func (s *Service) IsLaunchOnStartupEnabled() bool {
	if isDevBuild() {
		return false
	}
	if s.app == nil || s.app.Autostart == nil {
		return false
	}
	enabled, err := s.app.Autostart.IsEnabled()
	if err != nil {
		return false
	}
	return enabled
}
