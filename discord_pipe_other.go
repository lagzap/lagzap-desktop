//go:build !windows

package main

import (
	"fmt"
	"io"
	"net"
	"os"
	"path/filepath"
)

// openDiscordPipe connects to Discord's local socket number i, in the first
// runtime directory that has it.
func openDiscordPipe(i int) (io.ReadWriteCloser, error) {
	name := fmt.Sprintf("discord-ipc-%d", i)
	var lastErr error
	for _, env := range []string{"XDG_RUNTIME_DIR", "TMPDIR", "TMP", "TEMP"} {
		dir := os.Getenv(env)
		if dir == "" {
			continue
		}
		conn, err := net.Dial("unix", filepath.Join(dir, name))
		if err == nil {
			return conn, nil
		}
		lastErr = err
	}
	conn, err := net.Dial("unix", filepath.Join("/tmp", name))
	if err == nil {
		return conn, nil
	}
	if lastErr == nil {
		lastErr = err
	}
	return nil, lastErr
}
