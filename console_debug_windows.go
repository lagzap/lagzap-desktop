//go:build windows && debug

package main

import (
	"os"

	"golang.org/x/sys/windows"
)

// Debug builds are GUI programs like release builds (-H windowsgui), so
// starting LagZap again, as a Jump List entry does, opens no console window.
// Started from a terminal (wails3 dev), they join its console instead: logs
// show there and Ctrl+C still reaches the app for a graceful exit.
func init() {
	const attachParentProcess = ^uintptr(0)
	attach := windows.NewLazySystemDLL("kernel32.dll").NewProc("AttachConsole")
	if ok, _, _ := attach.Call(attachParentProcess); ok == 0 {
		return // not started from a console
	}
	// Output redirected to a pipe or file (wails3 dev, task) keeps going
	// there. Anything else is reopened on the console just joined: a GUI
	// program gets no usable console handle at start, and an inherited one
	// pointing at the console (go-task passes its own) writes nothing, which
	// is how the dev terminal lost every log line.
	for _, std := range []struct {
		id   uint32
		file **os.File
	}{{windows.STD_OUTPUT_HANDLE, &os.Stdout}, {windows.STD_ERROR_HANDLE, &os.Stderr}} {
		if h, err := windows.GetStdHandle(std.id); err == nil && redirected(h) {
			continue
		}
		out, err := os.OpenFile("CONOUT$", os.O_WRONLY, 0)
		if err != nil {
			continue
		}
		_ = windows.SetStdHandle(std.id, windows.Handle(out.Fd()))
		*std.file = out
	}
}

// redirected: the handle is a pipe or a file, not a console or nothing.
func redirected(h windows.Handle) bool {
	if h == 0 || h == windows.InvalidHandle {
		return false
	}
	kind, err := windows.GetFileType(h)
	if err != nil {
		return false
	}
	return kind == windows.FILE_TYPE_PIPE || kind == windows.FILE_TYPE_DISK
}
