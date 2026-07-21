package constant

import "testing"

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
	t.Cleanup(func() { Version = orig })

	cases := []struct {
		ver         string
		channel     string
		prerelease  bool
	}{
		{"v0.2.0-dev.14", "dev", true},
		{"0.2.0-beta.3", "beta", true},
		{"0.2.0-alpha.1", "alpha", true},
		{"0.2.0-rc.1", "prod", true},
		{"0.2.0", "prod", false},
	}
	for _, c := range cases {
		Version = c.ver
		if got := Channel(); got != c.channel {
			t.Errorf("%s Channel() = %q want %q", c.ver, got, c.channel)
		}
		if got := IsPrerelease(); got != c.prerelease {
			t.Errorf("%s IsPrerelease() = %v want %v", c.ver, got, c.prerelease)
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
