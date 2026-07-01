//go:build windows

package main

import (
	"syscall"
)

func setRealTimePriority() {
	kernel32 := syscall.NewLazyDLL("kernel32.dll")
	setPriority := kernel32.NewProc("SetPriorityClass")
	handle, _ := syscall.GetCurrentProcess()
	setPriority.Call(uintptr(handle), uintptr(0x00000100))
}