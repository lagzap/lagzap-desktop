//go:build windows

package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestReadAppInfo(t *testing.T) {
	path := filepath.Join(os.Getenv("SystemRoot"), "System32", "notepad.exe")
	info := readAppInfo(path)
	if info.Name == "" {
		t.Fatal("no file description")
	}
	if !strings.HasPrefix(info.Icon, "data:image/png;base64,") || len(info.Icon) < 200 {
		t.Fatalf("no icon: %q", info.Icon)
	}
	if missing := readAppInfo(`C:\does\not\exist.exe`); missing != (AppInfo{}) {
		t.Fatalf("missing exe: %+v", missing)
	}
}
