package main

import (
	"context"
	_ "embed"
	"fmt"
	"log/slog"
	"strings"

	"github.com/lagzap/lagzap-desktop/constant"
	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"
	"github.com/wailsapp/wails/v3/pkg/updater"
	"github.com/wailsapp/wails/v3/pkg/updater/providers/github"
)

const (
	updaterWindowWidth  = 460
	updaterWindowHeight = 580
)

//go:embed updater.key.pub
var updaterPublicKey []byte

//go:embed assets/updater/window.html
var updaterWindowHTML string

func initUpdater(app *application.App) {
	if constant.IsDevBuild() {
		slog.Info("updater: skipped in dev build")
		return
	}
	repo := strings.TrimSpace(constant.ReleasesRepo)
	if repo == "" {
		slog.Warn("updater: ReleasesRepo empty; skipping init")
		return
	}
	gh, err := github.New(github.Config{
		Repository:    repo,
		Prerelease:    constant.IsPrerelease(),
		ChecksumAsset: "SHA256SUMS",
		AssetMatcher:  preferUpdateZip,
	})
	if err != nil {
		slog.Error("updater: github provider", "error", err)
		return
	}

	updateWin := app.Window.NewWithOptions(application.WebviewWindowOptions{
		Name:                       "updater",
		Title:                      "Cyrex Update",
		Width:                      updaterWindowWidth,
		Height:                     updaterWindowHeight,
		MinWidth:                   updaterWindowWidth,
		MaxWidth:                   updaterWindowWidth,
		MinHeight:                  updaterWindowHeight,
		MaxHeight:                  updaterWindowHeight,
		DisableResize:              true,
		DefaultContextMenuDisabled: true,
		ZoomControlEnabled:         false,
		HTML:                       updaterWindowHTML,
		AllowSimpleEventEmit:       true,
		BackgroundColour:           application.NewRGBA(18, 18, 18, 255),
		Windows: application.WindowsWindow{
			Theme: application.SystemDefault,
		},
	})
	updateWin.Hide()
	updateWin.OnWindowEvent(events.Common.WindowClosing, func(e *application.WindowEvent) {
		updateWin.Hide()
		e.Cancel()
	})
	app.Event.On("wails:updater:check-started", func(*application.CustomEvent) {
		updateWin.Show()
		updateWin.Focus()
	})

	if err := app.Updater.Init(updater.Config{
		CurrentVersion: constant.SemVer(),
		Providers:      []updater.Provider{gh},
		PublicKey:      updaterPublicKey,
		Channel:        constant.Channel(),
		Window:         updater.BYOWindow(updateWin.AsUpdaterWindow()),
	}); err != nil {
		slog.Error("updater: init", "error", err)
		return
	}
	slog.Info("updater: ready",
		"version", constant.SemVer(),
		"repo", repo,
		"prerelease", constant.IsPrerelease(),
		"channel", constant.Channel(),
	)
}

// preferUpdateZip picks the auto-update zip and ignores NSIS setup installers.
func preferUpdateZip(req updater.CheckRequest, assets []github.ReleaseAsset) int {
	plat := strings.ToLower(req.Platform)
	arch := strings.ToLower(req.Arch)
	best := -1
	for i, a := range assets {
		name := strings.ToLower(a.Name)
		if strings.Contains(name, "setup") || strings.Contains(name, "installer") {
			continue
		}
		if strings.HasSuffix(name, ".sig") || strings.HasSuffix(name, ".asc") {
			continue
		}
		if name == "sha256sums" || strings.HasPrefix(name, "sha256sums.") {
			continue
		}
		if plat != "" && !strings.Contains(name, plat) {
			continue
		}
		if arch != "" && !(strings.Contains(name, arch) ||
			(arch == "amd64" && (strings.Contains(name, "x86_64") || strings.Contains(name, "x64")))) {
			continue
		}
		if strings.HasSuffix(name, ".zip") {
			return i
		}
		if best < 0 {
			best = i
		}
	}
	return best
}

func checkForUpdates(app *application.App) error {
	if app == nil || app.Updater == nil {
		return fmt.Errorf("updater unavailable")
	}
	go func() {
		if err := app.Updater.CheckAndInstall(context.Background()); err != nil {
			slog.Error("updater: check", "error", err)
		}
	}()
	return nil
}
