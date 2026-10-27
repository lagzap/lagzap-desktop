package main

import (
	"context"
	_ "embed"
	"fmt"
	"log/slog"
	"strings"
	"sync"
	"time"

	"github.com/lagzap/lagzap-desktop/constant"
	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"
	"github.com/wailsapp/wails/v3/pkg/updater"
	"github.com/wailsapp/wails/v3/pkg/updater/providers/github"
)

const (
	updaterWindowName   = "updater"
	updaterWindowWidth  = 460
	updaterWindowHeight = 580
	eventUpdaterRetry   = "cyrex:updater:retry"
)

//go:embed updater.key.pub
var updaterPublicKey []byte

//go:embed assets/updater/window.html
var updaterWindowHTML string

var (
	updaterMu sync.Mutex
	updaterWin *application.WebviewWindow
	updaterReady bool
	startMinimized bool
	// startupGatePending: main starts hidden while the first check runs; clear
	// once so we Show+Focus main without reloading it or touching the service.
	startupGatePending bool
	// updaterUIRequested: true for startup/manual/retry flows that intentionally
	// show the updater. Silent background polls leave this false so errors
	// do not pop the window.
	updaterUIRequested bool
)

// initUpdater sets up the frameless update window as the startup gate.
// Returns true when the updater is active (main window should stay hidden).
// Main still loads and the service keeps running under that gate; dismissing
// the updater only reveals the already-running main window.
func initUpdater(app *application.App) bool {
	if !constant.UpdaterEnabled() {
		slog.Info("updater: skipped in dev build")
		return false
	}
	repo := strings.TrimSpace(constant.ReleasesRepo)
	if repo == "" {
		slog.Warn("updater: ReleasesRepo empty; skipping init")
		return false
	}
	gh, err := github.New(github.Config{
		Repository:    repo,
		Prerelease:    constant.IsPrerelease(),
		ChecksumAsset: "SHA256SUMS",
		AssetMatcher:  preferUpdateZip,
	})
	if err != nil {
		slog.Error("updater: github provider", "error", err)
		return false
	}

	updateWin := app.Window.NewWithOptions(application.WebviewWindowOptions{
		Name:                       updaterWindowName,
		Title:                      "LagZap Update",
		Width:                      updaterWindowWidth,
		Height:                     updaterWindowHeight,
		MinWidth:                   updaterWindowWidth,
		MaxWidth:                   updaterWindowWidth,
		MinHeight:                  updaterWindowHeight,
		MaxHeight:                  updaterWindowHeight,
		DisableResize:              true,
		Frameless:                  true,
		DefaultContextMenuDisabled: true,
		ZoomControlEnabled:         false,
		HTML:                       updaterWindowHTML,
		AllowSimpleEventEmit:       true,
		BackgroundColour:           application.NewRGBA(18, 18, 18, 255),
		Windows: application.WindowsWindow{
			DisableIcon:             true,
			BackdropType:            application.Mica,
			Theme:                   application.SystemDefault,
			GeneralAutofillEnabled:  false,
			PasswordAutosaveEnabled: false,
		},
	})
	updaterMu.Lock()
	updaterWin = updateWin
	updaterReady = true
	updaterMu.Unlock()

	updateWin.OnWindowEvent(events.Common.WindowClosing, func(e *application.WindowEvent) {
		e.Cancel()
		dismissUpdater(app)
	})

	// Startup auto-applies (CheckAndInstall). Manual CheckForUpdates only
	// checks. Background polls use Check() only and never steal focus when
	// already up to date.
	app.Event.On(updater.EventUpdateAvailable, func(*application.CustomEvent) {
		showUpdaterWindow()
	})
	app.Event.On(updater.EventDownloadStarted, func(*application.CustomEvent) {
		showUpdaterWindow()
	})
	app.Event.On(updater.EventError, func(*application.CustomEvent) {
		updaterMu.Lock()
		show := startupGatePending || updaterUIRequested
		updaterMu.Unlock()
		if show {
			showUpdaterWindow()
		}
	})
	app.Event.On(updater.EventNoUpdate, func(*application.CustomEvent) {
		dismissUpdater(app)
	})
	app.Event.On(updater.EventUserCancel, func(*application.CustomEvent) {
		dismissUpdater(app)
	})
	app.Event.On(updater.EventUserSkip, func(*application.CustomEvent) {
		dismissUpdater(app)
	})
	app.Event.On(updater.EventUserRemind, func(*application.CustomEvent) {
		dismissUpdater(app)
	})
	app.Event.On(eventUpdaterRetry, func(*application.CustomEvent) {
		_ = checkForUpdates(app)
	})
	// Manual Check() leaves the window on "available"; Install / Restart are
	// user actions. Wire them here so Check-only flows work without
	// CheckAndInstall's session (which would auto-download).
	app.Event.On(updater.EventUserInstall, func(*application.CustomEvent) {
		go func() {
			if err := app.Updater.DownloadAndInstall(context.Background()); err != nil {
				slog.Error("updater: install", "error", err)
			}
		}()
	})
	app.Event.On(updater.EventUserRestart, func(*application.CustomEvent) {
		go func() {
			if err := app.Updater.Restart(context.Background()); err != nil {
				slog.Error("updater: restart", "error", err)
			}
		}()
	})

	if err := app.Updater.Init(updater.Config{
		CurrentVersion: constant.SemVer(),
		Providers:      []updater.Provider{gh},
		PublicKey:      updaterPublicKey,
		Channel:        constant.Channel(),
		// fixedSizeUpdaterHandle omits WindowSizer so Wails cannot shrink this
		// window to the compact ~348×161 checking card.
		Window: updater.BYOWindow(&fixedSizeUpdaterHandle{win: updateWin}),
		// Disable Wails' built-in CheckAndInstall ticker — it opens the window
		// and would Focus main on every up-to-date poll via EventNoUpdate.
		CheckInterval: 0,
	}); err != nil {
		slog.Error("updater: init", "error", err)
		updaterMu.Lock()
		updaterReady = false
		updaterMu.Unlock()
		return false
	}

	app.Event.OnApplicationEvent(events.Common.ApplicationStarted, func(*application.ApplicationEvent) {
		_ = checkAndApplyUpdates(app)
		startSilentUpdatePoll(app)
	})

	slog.Info("updater: ready",
		"version", constant.SemVer(),
		"repo", repo,
		"prerelease", constant.IsPrerelease(),
		"channel", constant.Channel(),
		"check_interval", constant.UpdateCheckInterval(),
	)
	return true
}

func showUpdaterWindow() {
	updaterMu.Lock()
	win := updaterWin
	updaterMu.Unlock()
	if win == nil {
		return
	}
	win.Show()
}

func hideUpdaterWindow() {
	updaterMu.Lock()
	win := updaterWin
	updaterMu.Unlock()
	if win != nil {
		win.Hide()
	}
}

// dismissUpdater hides the updater and, if the startup gate is still pending,
// reveals the already-running main window. Does not stop the service or reload
// the main webview. After the gate has cleared, an up-to-date result only hides
// the updater (no focus steal).
func dismissUpdater(app *application.App) {
	hideUpdaterWindow()

	updaterMu.Lock()
	gate := startupGatePending
	startupGatePending = false
	updaterUIRequested = false
	updaterMu.Unlock()

	if startMinimized {
		return
	}
	mainWin, ok := app.Window.GetByName("main")
	if !ok || mainWin == nil {
		return
	}
	if gate {
		// First dismiss after startup: main has been working hidden — show it.
		mainWin.Show()
		mainWin.Focus()
		return
	}
	// Later dismissals (manual up-to-date / skip): never interrupt a visible main.
	if !mainWin.IsVisible() {
		mainWin.Show()
	}
}

// revealMainApp is kept as an alias for callers that mean "updater done".
func revealMainApp(app *application.App) {
	dismissUpdater(app)
}

// startSilentUpdatePoll runs Check() on an interval. Up-to-date polls are
// silent; EventUpdateAvailable still opens the updater for user install.
func startSilentUpdatePoll(app *application.App) {
	interval := constant.UpdateCheckInterval()
	if interval <= 0 || app == nil || app.Updater == nil {
		return
	}
	go func() {
		t := time.NewTicker(interval)
		defer t.Stop()
		for range t.C {
			updaterMu.Lock()
			ready := updaterReady
			updaterMu.Unlock()
			if !ready {
				continue
			}
			switch app.Updater.State() {
			case updater.StateChecking, updater.StateDownloading,
				updater.StateVerifying, updater.StateInstalling:
				continue
			}
			if _, err := app.Updater.Check(context.Background()); err != nil {
				slog.Debug("updater: background check", "error", err)
			}
		}
	}()
}

// fixedSizeUpdaterHandle satisfies updater.WindowHandle without implementing
// updater.WindowSizer, so state transitions cannot resize our fixed chrome.
type fixedSizeUpdaterHandle struct {
	win *application.WebviewWindow
}

func (h *fixedSizeUpdaterHandle) Show() { h.win.Show() }

// Close hides instead of destroying so later checks can reuse the window and
// the main app/service keep running.
func (h *fixedSizeUpdaterHandle) Close() { h.win.Hide() }
func (h *fixedSizeUpdaterHandle) EmitEvent(name string, data ...any) bool {
	return h.win.EmitEvent(name, data...)
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
	return runUpdateCheck(app, false)
}

func checkAndApplyUpdates(app *application.App) error {
	return runUpdateCheck(app, true)
}

func runUpdateCheck(app *application.App, autoInstall bool) error {
	if !constant.UpdaterEnabled() {
		return fmt.Errorf("updates are not available in development builds")
	}
	if app == nil || app.Updater == nil {
		return fmt.Errorf("updater unavailable")
	}
	updaterMu.Lock()
	ready := updaterReady
	updaterMu.Unlock()
	if !ready {
		return fmt.Errorf("updater unavailable")
	}
	go func() {
		updaterMu.Lock()
		updaterUIRequested = true
		if autoInstall {
			startupGatePending = true
		}
		updaterMu.Unlock()

		showUpdaterWindow()
		ctx := context.Background()
		if autoInstall {
			// Startup gate: download + install as soon as an update is found.
			if err := app.Updater.CheckAndInstall(ctx); err != nil {
				slog.Error("updater: check-and-install", "error", err)
			}
			return
		}
		// Manual check: surface available/up-to-date UI; user must click Install.
		if _, err := app.Updater.Check(ctx); err != nil {
			slog.Error("updater: check", "error", err)
		}
	}()
	return nil
}
