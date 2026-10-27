package constant

import (
	"testing"
	"time"
)

func TestSemVer(t *testing.T) {
	orig := Version
	t.Cleanup(func() { Version = orig })

	Version = "v0.2.0-beta.3"
	if got := SemVer(); got != "0.2.0-beta.3" {
		t.Fatalf("SemVer() = %q", got)
	}
	Version = "unknown"
	if got := SemVer(); got != "0.0.0-dev" {
		t.Fatalf("SemVer() unknown = %q", got)
	}
}

func TestChannelAndPrerelease(t *testing.T) {
	orig := Version
	origDev := DevBuild
	t.Cleanup(func() {
		Version = orig
		DevBuild = origDev
	})

	cases := []struct {
		ver        string
		channel    string
		prerelease bool
	}{
		{"v0.2.0-dev.14", "dev", true},
		{"0.2.0-beta.3", "beta", true},
		{"0.2.0-alpha.1", "alpha", true},
		{"0.2.0-rc.1", "prod", true},
		{"0.2.0", "prod", false},
	}
	for _, c := range cases {
		Version = c.ver
		DevBuild = ""
		if got := Channel(); got != c.channel {
			t.Errorf("%s Channel() = %q want %q", c.ver, got, c.channel)
		}
		if got := IsPrerelease(); got != c.prerelease {
			t.Errorf("%s IsPrerelease() = %v want %v", c.ver, got, c.prerelease)
		}
	}
}

func TestAdminToolsEnabled(t *testing.T) {
	origV, origD := Version, DevBuild
	t.Cleanup(func() {
		Version, DevBuild = origV, origD
	})

	DevBuild = "true"
	Version = "0.2.0"
	if !AdminToolsEnabled() {
		t.Fatal("DevBuild must enable Admin Tools")
	}

	DevBuild = ""
	cases := []struct {
		ver  string
		want bool
	}{
		{"0.2.0-dev.1", true},
		{"0.2.0-alpha.1", true},
		{"0.2.0-beta.1", false},
		{"0.2.0", false},
	}
	for _, c := range cases {
		Version = c.ver
		if got := AdminToolsEnabled(); got != c.want {
			t.Errorf("%s AdminToolsEnabled() = %v want %v", c.ver, got, c.want)
		}
	}
}

func TestUpdateCheckInterval(t *testing.T) {
	orig := Version
	t.Cleanup(func() { Version = orig })

	cases := []struct {
		ver      string
		interval time.Duration
	}{
		{"0.2.0-alpha.1", 10 * time.Minute},
		{"0.2.0-beta.3", 30 * time.Minute},
		{"0.2.0-rc.1", 30 * time.Minute},
		{"0.2.0-dev.14", 30 * time.Minute},
		{"0.2.0", time.Hour},
	}
	for _, c := range cases {
		Version = c.ver
		if got := UpdateCheckInterval(); got != c.interval {
			t.Errorf("%s UpdateCheckInterval() = %v want %v", c.ver, got, c.interval)
		}
	}
}

func TestNumericFileVersion(t *testing.T) {
	origV, origF := Version, FileVersion
	t.Cleanup(func() { Version, FileVersion = origV, origF })

	FileVersion = "0.0.0.0"
	Version = "v0.2.0-beta.3"
	if got := NumericFileVersion(42); got != "0.2.0.42" {
		t.Fatalf("NumericFileVersion = %q", got)
	}
	FileVersion = "1.2.3.99"
	if got := NumericFileVersion(1); got != "1.2.3.99" {
		t.Fatalf("prefer FileVersion: got %q", got)
	}
}
