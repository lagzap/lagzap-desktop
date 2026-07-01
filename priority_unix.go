//go:build unix

package main

import (
	"golang.org/x/sys/unix"
)

func setRealTimePriority() {
	unix.Setpriority(unix.PRIO_PROCESS, 0, -10)
}