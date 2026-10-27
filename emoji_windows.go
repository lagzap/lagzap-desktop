//go:build windows

package main

import "time"

const (
	vkLWin         = 0x5B
	vkOEMPeriod    = 0xBE // .
	keyeventfKeyup = 0x0002
)

func openEmojiPanel() error {
	// Win + . opens the Windows emoji panel.
	procKeybdEvent.Call(uintptr(vkLWin), 0, 0, 0)
	time.Sleep(20 * time.Millisecond)
	procKeybdEvent.Call(uintptr(vkOEMPeriod), 0, 0, 0)
	time.Sleep(20 * time.Millisecond)
	procKeybdEvent.Call(uintptr(vkOEMPeriod), 0, keyeventfKeyup, 0)
	time.Sleep(20 * time.Millisecond)
	procKeybdEvent.Call(uintptr(vkLWin), 0, keyeventfKeyup, 0)
	return nil
}
