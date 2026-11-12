//go:build windows

package main

import (
	"os/exec"
	"syscall"
	"time"

	"golang.org/x/sys/windows"
)

func waitForProcessExit(pid int, limit time.Duration) {
	handle, err := windows.OpenProcess(windows.SYNCHRONIZE, false, uint32(pid))
	if err != nil {
		return // already gone
	}
	defer windows.CloseHandle(handle)
	_, _ = windows.WaitForSingleObject(handle, uint32(limit.Milliseconds()))
}

// hideRestartConsole: the new LagZap opens no console window.
func hideRestartConsole(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: windows.CREATE_NO_WINDOW}
}
