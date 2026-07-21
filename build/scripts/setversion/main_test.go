package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestPatchConfigYML_preservesCommentSpacing(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "config.yml")
	content := `version: '3'

info:
  productName: "Cyrex"
  version: "0.1.0.0" # The application version
`
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := patchConfigYML(path, "0.1.1.7"); err != nil {
		t.Fatal(err)
	}
	out, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	s := string(out)
	if !strings.Contains(s, `version: '3'`) {
		t.Fatalf("root wails schema version must stay '3', got:\n%s", s)
	}
	if !strings.Contains(s, `version: "0.1.1.7" # The application version`) {
		t.Fatalf("expected spaced comment, got:\n%s", s)
	}
	if strings.Contains(s, `"0.1.1.7"#`) {
		t.Fatalf("missing space before comment:\n%s", s)
	}
}
