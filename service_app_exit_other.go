//go:build !windows

package main

import (
	"os"
	"os/exec"
	"syscall"
	"time"
)

func waitForProcessExit(pid int, limit time.Duration) {
	deadline := time.Now().Add(limit)
	for time.Now().Before(deadline) {
		process, err := os.FindProcess(pid)
		if err != nil || process.Signal(syscall.Signal(0)) != nil {
			return
		}
		time.Sleep(100 * time.Millisecond)
	}
}

func hideRestartConsole(*exec.Cmd) {}
