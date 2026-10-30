package main

import (
	"context"
	"embed"
	"fmt"
	"log/slog"
	"os"
	"time"

	"github.com/lagzap/lagzap-desktop/constant"
	"github.com/lagzap/lagzap/log"
	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"
)

//go:embed all:frontend/.output/public
var assets embed.FS

type PanicDetails struct {
	StackTrace     string    // The stack trace of where the panic occurred. Potentially trimmed to provide more context
	Error          error     // The error that caused the panic
	Time           time.Time // The time when the panic occurred
	FullStackTrace string    // The complete stack trace including runtime frames
}

func main() {
	setRealTimePriority()
	startDebugPprof()
	ctx := context.Background()
	service := &Service{}

	var window *application.WebviewWindow
	var systray *application.SystemTray
	var app *application.App
	quiting := false
	app = application.New(application.Options{
		LogLevel:    slog.Level(log.LevelDebug),
		Name:        "LagZap",
		Description: "LagZap",
		Linux:       application.LinuxOptions{},
		Windows: application.WindowsOptions{
			// Tray app: closing/hiding windows must not terminate the process.
			DisableQuitOnLastWindowClosed: true,
		},
		Services: []application.Service{
			application.NewService(service),
		},
		Assets: application.AssetOptions{
			Handler: application.AssetFileServerFS(assets),
		},

		ShouldQuit: func() bool {
			// OS / Alt+F4 style quit requests: stay in tray unless tray Quit was used.
			if quiting {
				return true
			}
			if window != nil {
				window.Hide()
			}
			return false
		},
		SingleInstance: &application.SingleInstanceOptions{
			UniqueID: "com.lagzap",
			OnSecondInstanceLaunch: func(data application.SecondInstanceData) {
				if window != nil {
					window.Show()
					window.Restore()
					window.Focus()
				}
			},
		},
		PanicHandler: func(panicDetails *application.PanicDetails) {
			fmt.Printf("*** There was a panic! ***\n")
			fmt.Printf("Time: %s\n", panicDetails.Time)
			fmt.Printf("Error: %s\n", panicDetails.Error)
			fmt.Printf("Stacktrace: %s\n", panicDetails.StackTrace)

			app.Dialog.Info().
				SetTitle("LagZap crashed!").
				SetMessage("A crash has been occurred, please restart the application!").
				Show()
			file, err := os.OpenFile("panic.log", os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o644)
			if err != nil {
				fmt.Printf("Failed to open panic log file: %s\n", err)
				return
			}
			defer file.Close()

			logMessage := fmt.Sprintf("Time: %s\nError: %s\nStacktrace: %s\n\n", panicDetails.Time, panicDetails.Error, panicDetails.FullStackTrace)
			if _, err := file.WriteString(logMessage); err != nil {
				fmt.Printf("Failed to write to panic log file: %s\n", err)
			}
		},
	})
	service.New(ctx, app)
	for _, arg := range os.Args[1:] {
		if arg == startupMinimizeArg {
			startMinimized = true
			break
		}
	}
	updaterActive := initUpdater(app)
	disableAutostartIfDev(app)

	// PrtScn is swallowed by WebView2 while focused; bridge opens Snipping Tool.
	startPrintScreenBridge()
	defer stopPrintScreenBridge()

	app.Event.OnApplicationEvent(events.Windows.SystemThemeChanged, func(event *application.ApplicationEvent) {
		if event.Context().IsDarkMode() {
			app.Event.Emit("theme", "dark")
			window.SetBackgroundColour(application.NewRGBA(18, 18, 18, 255))
		} else {
			app.Event.Emit("theme", "light")
			window.SetBackgroundColour(application.NewRGBA(245, 245, 245, 255))
		}
	})
	app.Event.OnApplicationEvent(events.Common.ApplicationStarted, func(event *application.ApplicationEvent) {
		if err := service.StartBootstrapLocalProxy(); err != nil {
			fmt.Printf("localproxy bootstrap on start: %v\n", err)
		}
	})

	window = app.Window.NewWithOptions(application.WebviewWindowOptions{
		Name:               "main",
		Title:              "LagZap",
		Width:              1000,
		Height:             800,
		MinWidth:           320,
		MinHeight:          640,
		ZoomControlEnabled: false,
		Frameless:          true,
		Hidden:             updaterActive || startMinimized,
		BackgroundColour:   application.NewRGBA(10, 10, 10, 255),
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
		URL: "/#/start-service",
	})
	// Hook (sync) on Common.WindowClosing — OnWindowEvent listeners are async and
	// cannot reliably Cancel before Wails' default destroy handler runs. Taskbar
	// Close / Alt+F4 must hide to tray, not destroy the window.
	window.RegisterHook(events.Common.WindowClosing, func(e *application.WindowEvent) {
		if quiting {
			return
		}
		window.Hide()
		e.Cancel()
	})
	window.OnWindowEvent(events.Windows.WindowActive, func(e *application.WindowEvent) {
		service.SetWindow(window)
	})
	window.OnWindowEvent(events.Common.WindowFocus, func(e *application.WindowEvent) {
		service.setMainWindowFocused(true)
	})
	window.OnWindowEvent(events.Common.WindowLostFocus, func(e *application.WindowEvent) {
		service.setMainWindowFocused(false)
	})
	window.OnWindowEvent(events.Windows.WindowMaximise, func(e *application.WindowEvent) {
		app.Event.Emit("WindowMaximised", true)
	})
	window.OnWindowEvent(events.Windows.WindowUnMaximise, func(e *application.WindowEvent) {
		app.Event.Emit("WindowMaximised", false)
	})

	lightIcon, _ := assets.ReadFile("assets/images/icons/light/warning.png")
	darkIcon, _ := assets.ReadFile("assets/images/icons/dark/warning.png")
	systray = app.SystemTray.New()
	systray.SetLabel("LagZap")
	systray.SetIcon(lightIcon)
	systray.SetDarkModeIcon(darkIcon)

	menu := application.NewMenu()
	menu.Add("Open").OnClick(func(ctx *application.Context) {
		window.Show()
		window.Focus()
	})
	if constant.AdminToolsEnabled() {
		menu.Add("Admin Tools").OnClick(func(ctx *application.Context) {
			service.OpenAdminTools()
		})
	}
	menu.Add("Quit").OnClick(func(ctx *application.Context) {
		quiting = true
		_ = service.StopLocalProxy()
		service.StopService()
		window.Close()
		systray.Destroy()
		app.Quit()
		os.Exit(0)
	})
	systray.OnClick(func() {
		window.Show()
		window.Focus()
	})
	systray.OnDoubleClick(func() {
		window.Show()
		window.Focus()
	})
	systray.SetMenu(menu)

	service.SetSystray(systray)
	app.Run()
}
