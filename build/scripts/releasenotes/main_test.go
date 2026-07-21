package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestExtractChangelog(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "CHANGELOG.md")
	content := `# Changelog

## [Unreleased]

### Added
- wip

## [0.1.0-beta.1] - 2026-07-21

### Added
- Beta installer

### Fixed
- Crash on start

## [0.1.0-beta.2] - 2026-07-22

### Added
- newer
`
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
	got, err := extractChangelog(path, "0.1.0-beta.1")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(got, "Beta installer") {
		t.Fatalf("missing beta entry: %q", got)
	}
	if strings.Contains(got, "newer") {
		t.Fatalf("should not include next version: %q", got)
	}
}

func TestChannelFromSemver(t *testing.T) {
	if channelFromSemver("0.2.0-beta.3") != "beta" {
		t.Fatal("expected beta")
	}
	if channelFromSemver("0.2.0") != "stable" {
		t.Fatal("expected stable")
	}
}
