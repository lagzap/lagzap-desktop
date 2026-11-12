package main

import (
	"fmt"
	"os"
	"os/exec"
	"strconv"
	"strings"
	"time"
)

// Quitting LagZap from the UI (the logo menu's Exit) works exactly like the
// tray's Quit: the window close and app quit are otherwise turned into
// "hide to tray". Restart quits the same way and starts LagZap again.

// afterExitArg: a restarted LagZap waits for the old process (this pid) to
// exit first, or the single-instance lock would hand it to the old one.
const afterExitArg = "--after-exit="

// afterExitWait bounds that wait: a stuck old process never blocks the new.
const afterExitWait = 15 * time.Second

// QuitApp quits LagZap (the tray's Quit).
func (s *Service) QuitApp() {
	if s.quitApp != nil {
		go s.quitApp()
	}
}

// RestartApp starts a new LagZap that waits for this one to exit, then quits.
func (s *Service) RestartApp() error {
	exe, err := os.Executable()
	if err != nil {
		return fmt.Errorf("restart: %w", err)
	}
	cmd := exec.Command(exe, afterExitArg+strconv.Itoa(os.Getpid()))
	hideRestartConsole(cmd)
	if err := cmd.Start(); err != nil {
		return fmt.Errorf("restart: %w", err)
	}
	_ = cmd.Process.Release()
	s.QuitApp()
	return nil
}

// waitForOldInstance is called first thing in main: a restarted LagZap waits
// here until the LagZap that started it has exited.
func waitForOldInstance(args []string) {
	for _, arg := range args {
		value, ok := strings.CutPrefix(arg, afterExitArg)
		if !ok {
			continue
		}
		pid, err := strconv.Atoi(value)
		if err != nil || pid <= 0 {
			return
		}
		waitForProcessExit(pid, afterExitWait)
		return
	}
}
