package main

import (
	"context"
	"embed"
	"fmt"
	"log/slog"
	"os"
	"strings"
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

	var window *application.WebviewWindow
	var systray *application.SystemTray
	app := application.New(application.Options{
		LogLevel:    slog.Level(log.LevelError),
		Name:        "LagZap",
		Description: "A cutting-edge lag elimination software designed to deliver a seamless and smooth experience",
		Linux:       application.LinuxOptions{},
		Windows:     application.WindowsOptions{},
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

			dialog := application.InfoDialog()
			dialog.SetTitle("LagZap crashed!")
			dialog.SetMessage("A crash has been occurred, please restart the application!")
			dialog.Show()
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

	app.Event.OnApplicationEvent(events.Windows.SystemThemeChanged, func(event *application.ApplicationEvent) {
		if event.Context().IsDarkMode() {
			app.Event.Emit("theme", "dark")
			window.SetBackgroundColour(application.NewRGBA(10, 9, 5, 255))
		} else {
			app.Event.Emit("theme", "light")
			window.SetBackgroundColour(application.NewRGBA(255, 248, 244, 255))
		}
	})
	app.Event.OnApplicationEvent(events.Common.ApplicationStarted, func(event *application.ApplicationEvent) {
		err := service.ReloadService()
		if err != nil {
			if strings.Contains(err.Error(), "driver is not installed") {
				dialog := application.ErrorDialog()
				dialog.SetTitle("LagZap driver is not installed!")
				dialog.SetMessage("Please reinstall lagzap from the official website.")
				dialog.Show()
			} else {
				dialog := application.ErrorDialog()
				dialog.SetTitle("LagZap error occurred!")
				dialog.SetMessage(err.Error())
				dialog.Show()
			}
			service.Close()
			app.Quit()
			systray.Destroy()
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
		EnableDragAndDrop:  false,
		Frameless:          true,
		BackgroundColour:   application.NewRGBA(10, 9, 5, 255),
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
		OpenInspectorOnStartup: true,
		URL:                    "/start-service/",
	})
	window.OnWindowEvent(events.Windows.WindowClosing, func(e *application.WindowEvent) {
		window.Hide()
		e.Cancel()
	})
	window.OnWindowEvent(events.Windows.WindowActive, func(e *application.WindowEvent) {
		service.SetWindow(window)
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
	menu.Add("Quit").OnClick(func(ctx *application.Context) {
		app.Quit()
	})
	systray.OnClick(func() {
		window.Focus()
	})
	systray.OnDoubleClick(func() {
		window.Show()
	})
	systray.SetMenu(menu)

	service.SetSystray(systray)
	app.Run()
}
