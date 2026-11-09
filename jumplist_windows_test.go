//go:build windows

package main

import (
	"os"
	"testing"
)

// Builds a real Jump List for the test binary. Run with LAGZAP_JUMPLIST_TEST=1.
func TestApplyJumpListOnWindows(t *testing.T) {
	if os.Getenv("LAGZAP_JUMPLIST_TEST") == "" {
		t.Skip("set LAGZAP_JUMPLIST_TEST=1 to build a real Jump List")
	}
	exe, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	dir := t.TempDir()
	ico := icoFromPNG(mustPNG(t), jumpIconSize)
	icon := dir + `\ping.ico`
	if err := os.WriteFile(icon, ico, 0o644); err != nil {
		t.Fatal(err)
	}
	content := JumpListContent{Labels: testLabels(), Favorites: []JumpListTitle{{ID: "wow", Name: "World of Warcraft"}}}
	categories := jumpCategories(content, "Internet Ping: 20ms", exe, map[string]string{"ping": icon})
	if err := applyJumpList(exe, categories); err != nil {
		t.Fatal(err)
	}
	// Twice: the second build replaces the first.
	if err := applyJumpList(exe, categories); err != nil {
		t.Fatal(err)
	}
}
