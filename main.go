package main

import (
	"context"
	"embed"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"time"

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
	if !isAdminUser() {
		runAsAdministrator()
		os.Exit(0)
	}
	ctx := context.Background()
	service := &Service{}

	path, err := os.Executable()
	if err != nil {
		panic(err)
	}
	webviewBrowserPath := path[:len(path)-len(filepath.Base(path))]

	var window *application.WebviewWindow
	// var systray *application.SystemTray
	app := application.New(application.Options{
		LogLevel:    slog.Level(log.LevelError),
		Name:        "LagZap",
		Description: "A cutting-edge lag elimination software designed to deliver a seamless and smooth experience",
		Windows: application.WindowsOptions{
			WebviewBrowserPath: webviewBrowserPath,
		},
		Services: []application.Service{
			application.NewService(service),
		},
		Assets: application.AssetOptions{
			Handler: application.AssetFileServerFS(assets),
		},

		ShouldQuit: func() bool {
			window.Hide()
			return false
		},
		SingleInstance: &application.SingleInstanceOptions{
			UniqueID: "com.lagzap",
			OnSecondInstanceLaunch: func(data application.SecondInstanceData) {
				if window != nil {
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

			application.InfoDialog().SetMessage("There was a panic!").Show()
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

	app.OnApplicationEvent(events.Windows.ApplicationStarted, func(e *application.ApplicationEvent) {
		service.New(ctx, app)
	})
	app.OnApplicationEvent(events.Windows.SystemThemeChanged, func(event *application.ApplicationEvent) {
		if event.Context().IsDarkMode() {
			app.EmitEvent("theme", "dark")
			window.SetBackgroundColour(application.NewRGBA(10, 9, 5, 255))
		} else {
			app.EmitEvent("theme", "light")
			window.SetBackgroundColour(application.NewRGBA(255, 248, 244, 255))
		}
	})
	app.OnApplicationEvent(events.Windows.APMSuspend, func(e *application.ApplicationEvent) {
		service.Pause()
	})
	app.OnApplicationEvent(events.Windows.APMResumeSuspend, func(e *application.ApplicationEvent) {
		service.Wake()
	})

	window = app.NewWebviewWindowWithOptions(application.WebviewWindowOptions{
		Name:                       "main",
		Title:                      "LagZap",
		Width:                      1000,
		Height:                     800,
		MinWidth:                   320,
		MinHeight:                  640,
		ZoomControlEnabled:         false,
		EnableDragAndDrop:          false,
		DefaultContextMenuDisabled: true,
		Frameless:                  true,
		DevToolsEnabled:            true,
		BackgroundColour:           application.NewRGBA(10, 9, 5, 255),
		Windows: application.WindowsWindow{
			DisableIcon:             true,
			BackdropType:            application.Mica,
			Theme:                   application.SystemDefault,
			GeneralAutofillEnabled:  false,
			PasswordAutosaveEnabled: false,

			CustomTheme: &application.ThemeSettings{
				DarkModeBorder:             0x002D2D2D,
				DarkModeBorderInactive:     0x00171717,
				DarkModeTitleBar:           0x00050a09,
				DarkModeTitleBarInactive:   0x00050a09,
				DarkModeTitleText:          0x00FFFFFF,
				DarkModeTitleTextInactive:  0x00C8C8C8,
				LightModeTitleBar:          0x00FFFFFF,
				LightModeTitleText:         0x00000000,
				LightModeTitleTextInactive: 0x00000000,
				LightModeTitleBarInactive:  0x00FFFFFF,
				LightModeBorder:            0x00FFFFFF,
				LightModeBorderInactive:    0x00FFFFFF,
			},
		},
		URL: "/start-service/",
	})
	window.OnWindowEvent(events.Windows.WindowClosing, func(e *application.WindowEvent) {
		e.Cancel()
		window.Hide()
	})
	window.OnWindowEvent(events.Windows.WindowActive, func(e *application.WindowEvent) {
		service.SetWindow(window)
	})

	// iconBytes, _ := assets.ReadFile("assets/images/lagzap-logo-circle.png")
	// systray = app.NewSystemTray()
	// systray.SetLabel("LagZap")
	// systray.SetIcon(iconBytes)
	// systray.AttachWindow(window)

	menu := application.NewMenu()
	menu.Add("Open").OnClick(func(ctx *application.Context) {
		window.Show()
	})
	menu.Add("Quit").OnClick(func(ctx *application.Context) {
		app.Quit()
	})
	// systray.SetMenu(menu)

	// service.SetSystray(systray)
	err = app.Run()
	// systray.Run()
	if err != nil {
		log.Fatal(err)
	}
}
