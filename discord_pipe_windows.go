//go:build windows

package main

import (
	"fmt"
	"io"
	"os"
)

// openDiscordPipe opens Discord's local pipe number i (Discord, PTB and
// Canary take the first free of 0-9).
func openDiscordPipe(i int) (io.ReadWriteCloser, error) {
	return os.OpenFile(fmt.Sprintf(`\\.\pipe\discord-ipc-%d`, i), os.O_RDWR, 0)
}
