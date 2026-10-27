package constant

import (
	"strconv"
	"strings"
	"time"
)

// Version is injected at build time via ldflags (e.g. "v0.2.0-beta.3" or "0.2.0").
var Version = "unknown"

// FileVersion is the Windows 4-part numeric version (MAJOR.MINOR.PATCH.BUILD),
// injected at build time when packaging. Used for PE/NSIS metadata only.
var FileVersion = "0.0.0.0"

// ReleasesRepo is the public GitHub owner/repo that hosts downloadable releases
// for the auto-updater. Override via ldflags if needed.
var ReleasesRepo = "lagzap/cyrex-releases"

// DevBuild is set to "true" via ldflags for wails dev backend builds.
var DevBuild = ""

// ForceUpdaterInDev enables the auto-updater UI and checks while running a
// wails dev backend. Leave false for normal development; flip to true only
// when testing the updater gate locally.
const ForceUpdaterInDev = false

func IsDevBuild() bool {
	return DevBuild == "true"
}

// UpdaterEnabled reports whether the desktop updater should initialize and
// accept CheckForUpdates calls. Off for normal dev builds unless
// ForceUpdaterInDev is set.
func UpdaterEnabled() bool {
	return false
	return !IsDevBuild() || ForceUpdaterInDev
}

// SemVer returns Version without a leading "v", suitable for the Wails updater.
func SemVer() string {
	v := strings.TrimSpace(Version)
	v = strings.TrimPrefix(v, "v")
	v = strings.TrimPrefix(v, "V")
	if v == "" || strings.EqualFold(v, "unknown") {
		return "0.0.0-dev"
	}
	return v
}

// Channel returns the release channel derived from the SemVer prerelease suffix.
// Matches localproxy.ChannelHost rules: alpha | beta | dev | prod.
func Channel() string {
	v := strings.ToLower(SemVer())
	switch {
	case strings.HasSuffix(v, "-alpha"), strings.Contains(v, "-alpha."):
		return "alpha"
	case strings.HasSuffix(v, "-beta"), strings.Contains(v, "-beta."):
		return "beta"
	case strings.HasSuffix(v, "-dev"), strings.Contains(v, "-dev."):
		return "dev"
	default:
		return "prod"
	}
}

// AdminToolsEnabled reports whether the Admin Tools window and tray entry are
// available. Dev backend builds and alpha/dev release channels only — not beta/prod.
func AdminToolsEnabled() bool {
	if IsDevBuild() {
		return true
	}
	ch := Channel()
	return ch == "dev" || ch == "alpha"
}

// UpdateCheckInterval returns how often the background updater should poll for releases.
// Alpha: 10m, beta/rc/dev: 30m, production: 1h.
func UpdateCheckInterval() time.Duration {
	v := strings.ToLower(SemVer())
	switch {
	case strings.Contains(v, "-alpha"):
		return 10 * time.Minute
	case strings.Contains(v, "-beta"), strings.Contains(v, "-rc"), strings.Contains(v, "-dev"):
		return 30 * time.Minute
	default:
		return time.Hour
	}
}

// when checking for updates (dev / beta / alpha / rc).
func IsPrerelease() bool {
	v := strings.ToLower(SemVer())
	switch {
	case strings.Contains(v, "-dev"), strings.Contains(v, "-beta"),
		strings.Contains(v, "-alpha"), strings.Contains(v, "-rc"):
		return true
	default:
		return false
	}
}

// NumericFileVersion returns a 4-part Windows file version.
// Prefer the ldflag FileVersion when set; otherwise derive MAJOR.MINOR.PATCH.0
// from SemVer (prerelease suffixes are stripped for the numeric triple).
func NumericFileVersion(buildNumber int) string {
	if fv := strings.TrimSpace(FileVersion); fv != "" && fv != "0.0.0.0" {
		return fv
	}
	major, minor, patch := parseSemVerCore(SemVer())
	if buildNumber < 0 {
		buildNumber = 0
	}
	return strconv.Itoa(major) + "." + strconv.Itoa(minor) + "." + strconv.Itoa(patch) + "." + strconv.Itoa(buildNumber)
}

func parseSemVerCore(v string) (major, minor, patch int) {
	core := v
	if i := strings.IndexAny(core, "-+"); i >= 0 {
		core = core[:i]
	}
	parts := strings.Split(core, ".")
	if len(parts) > 0 {
		major, _ = strconv.Atoi(parts[0])
	}
	if len(parts) > 1 {
		minor, _ = strconv.Atoi(parts[1])
	}
	if len(parts) > 2 {
		patch, _ = strconv.Atoi(parts[2])
	}
	return
}
