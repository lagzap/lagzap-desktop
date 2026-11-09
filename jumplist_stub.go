//go:build !windows

package main

// Jump Lists are a Windows taskbar feature.
func applyJumpList(string, []jumpCategory) error { return nil }
