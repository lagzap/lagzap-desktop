// Command setversion syncs VERSION / BUILD_NUMBER into Windows packaging metadata.
//
// Usage:
//
//	go run ./build/scripts/setversion -version v0.2.0-beta.3 -build 42
package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
)

func main() {
	version := flag.String("version", "", "SemVer with optional leading v (required)")
	build := flag.Int("build", 0, "Build number (4th Windows file version component)")
	root := flag.String("root", ".", "Desktop project root")
	flag.Parse()
	if strings.TrimSpace(*version) == "" {
		fmt.Fprintln(os.Stderr, "setversion: -version is required")
		os.Exit(2)
	}

	semver := strings.TrimPrefix(strings.TrimSpace(*version), "v")
	semver = strings.TrimPrefix(semver, "V")
	fileVer := numericFileVersion(semver, *build)

	rootAbs, err := filepath.Abs(*root)
	if err != nil {
		fatal(err)
	}

	if err := patchInfoJSON(filepath.Join(rootAbs, "build", "windows", "info.json"), fileVer, semver); err != nil {
		fatal(err)
	}
	if err := patchConfigYML(filepath.Join(rootAbs, "build", "config.yml"), fileVer); err != nil {
		fatal(err)
	}
	if err := patchNSH(filepath.Join(rootAbs, "build", "windows", "nsis", "wails_tools.nsh"), fileVer); err != nil {
		fatal(err)
	}

	fmt.Printf("setversion: semver=%s file=%s\n", semver, fileVer)
	// Emit for GitHub Actions / shells that source the output.
	fmt.Printf("SEMVER=%s\n", semver)
	fmt.Printf("FILE_VERSION=%s\n", fileVer)
}

func numericFileVersion(semver string, build int) string {
	core := semver
	if i := strings.IndexAny(core, "-+"); i >= 0 {
		core = core[:i]
	}
	parts := strings.Split(core, ".")
	major, minor, patch := 0, 0, 0
	if len(parts) > 0 {
		major, _ = strconv.Atoi(parts[0])
	}
	if len(parts) > 1 {
		minor, _ = strconv.Atoi(parts[1])
	}
	if len(parts) > 2 {
		patch, _ = strconv.Atoi(parts[2])
	}
	if build < 0 {
		build = 0
	}
	return fmt.Sprintf("%d.%d.%d.%d", major, minor, patch, build)
}

func patchInfoJSON(path, fileVer, productVer string) error {
	data, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	var doc map[string]any
	if err := json.Unmarshal(data, &doc); err != nil {
		return err
	}
	fixed, _ := doc["fixed"].(map[string]any)
	if fixed == nil {
		fixed = map[string]any{}
		doc["fixed"] = fixed
	}
	fixed["file_version"] = fileVer

	info, _ := doc["info"].(map[string]any)
	if info == nil {
		info = map[string]any{}
		doc["info"] = info
	}
	locale, _ := info["0000"].(map[string]any)
	if locale == nil {
		locale = map[string]any{}
		info["0000"] = locale
	}
	// ProductVersion string can include prerelease; PE file_version stays numeric.
	locale["ProductVersion"] = productVer

	out, err := json.MarshalIndent(doc, "", "\t")
	if err != nil {
		return err
	}
	return os.WriteFile(path, append(out, '\n'), 0o644)
}

func patchConfigYML(path, fileVer string) error {
	data, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	// Only info.version (indented); do not touch root wails config schema version.
	re := regexp.MustCompile(`(?m)^(\s+version:\s*)"[^"]*"(\s*(?:#.*))?\s*$`)
	replaced := re.ReplaceAllFunc(data, func(match []byte) []byte {
		sub := re.FindSubmatch(match)
		prefix := string(sub[1])
		suffix := ""
		if len(sub) > 2 && len(sub[2]) > 0 {
			comment := strings.TrimSpace(string(sub[2]))
			if strings.HasPrefix(comment, "#") {
				suffix = " " + comment
			}
		}
		return []byte(fmt.Sprintf("%s\"%s\"%s", prefix, fileVer, suffix))
	})
	return os.WriteFile(path, replaced, 0o644)
}

func patchNSH(path, fileVer string) error {
	data, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	re := regexp.MustCompile(`(!define INFO_PRODUCTVERSION\s+)"[^"]*"`)
	replaced := re.ReplaceAll(data, []byte(fmt.Sprintf(`${1}"%s"`, fileVer)))
	return os.WriteFile(path, replaced, 0o644)
}

func fatal(err error) {
	fmt.Fprintln(os.Stderr, "setversion:", err)
	os.Exit(1)
}
