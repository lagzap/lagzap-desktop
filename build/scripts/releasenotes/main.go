// Command releasenotes renders a GitHub Release body from CHANGELOG + template.
//
// Usage:
//
//	go run ./build/scripts/releasenotes \
//	  -version v0.1.0-beta.1 \
//	  -build 42 \
//	  -channel beta \
//	  -public-repo lagzap/cyrex-releases \
//	  -output release-body.md
package main

import (
	"bufio"
	"bytes"
	"flag"
	"fmt"
	"os"
	"regexp"
	"strings"
	"time"
)

func main() {
	version := flag.String("version", "", "Git tag (e.g. v0.1.0-beta.1)")
	build := flag.String("build", "0", "CI build number")
	channel := flag.String("channel", "", "Release channel (dev|beta|alpha|prod)")
	publicRepo := flag.String("public-repo", "lagzap/cyrex-releases", "Public releases owner/repo")
	changelogPath := flag.String("changelog", "CHANGELOG.md", "Path to CHANGELOG.md")
	templatePath := flag.String("template", ".github/release-notes-template.md", "Release notes template")
	outputPath := flag.String("output", "release-body.md", "Where to write the rendered body")
	flag.Parse()

	if strings.TrimSpace(*version) == "" {
		fatal("version is required")
	}
	tag := strings.TrimSpace(*version)
	semver := strings.TrimPrefix(strings.TrimPrefix(tag, "v"), "V")
	if *channel == "" {
		*channel = channelFromSemver(semver)
	}

	changelog, err := extractChangelog(*changelogPath, semver)
	if err != nil {
		fatal(err)
	}
	if strings.TrimSpace(changelog) == "" {
		changelog = "_No CHANGELOG entry for this version yet. Edit `CHANGELOG.md` under `## [" + semver + "]` before tagging._"
	}

	tmpl, err := os.ReadFile(*templatePath)
	if err != nil {
		fatal(err)
	}

	replacements := map[string]string{
		"{{VERSION}}":     tag,
		"{{SEMVER}}":      semver,
		"{{BUILD}}":       *build,
		"{{CHANNEL}}":     *channel,
		"{{DATE}}":        time.Now().UTC().Format("2006-01-02"),
		"{{CHANGELOG}}":   strings.TrimSpace(changelog),
		"{{PUBLIC_REPO}}": *publicRepo,
		"{{BADGE_LINE}}":  badgeLine(semver),
	}

	out := string(tmpl)
	for k, v := range replacements {
		out = strings.ReplaceAll(out, k, v)
	}

	if err := os.WriteFile(*outputPath, []byte(out), 0o644); err != nil {
		fatal(err)
	}
	fmt.Printf("releasenotes: wrote %s (%d bytes)\n", *outputPath, len(out))
}

func channelFromSemver(v string) string {
	lower := strings.ToLower(v)
	switch {
	case strings.Contains(lower, "-alpha"):
		return "alpha"
	case strings.Contains(lower, "-beta"):
		return "beta"
	case strings.Contains(lower, "-dev"):
		return "dev"
	case strings.Contains(lower, "-rc"):
		return "rc"
	default:
		return "stable"
	}
}

func badgeLine(semver string) string {
	ch := channelFromSemver(semver)
	switch ch {
	case "stable":
		return "🟢 **Stable release**"
	case "beta":
		return "🟡 **Beta** — feedback welcome"
	case "alpha":
		return "🟠 **Alpha** — internal testing"
	case "dev":
		return "🔵 **Dev build** — not for production"
	case "rc":
		return "🟣 **Release candidate**"
	default:
		return ""
	}
}

var headingRE = regexp.MustCompile(`^##\s+\[([^\]]+)\]`)

func extractChangelog(path, semver string) (string, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}
	scanner := bufio.NewScanner(bytes.NewReader(data))
	var (
		collecting bool
		lines      []string
	)
	for scanner.Scan() {
		line := scanner.Text()
		if m := headingRE.FindStringSubmatch(line); m != nil {
			headingVer := normalizeVersion(m[1])
			if collecting {
				break
			}
			if headingVer == normalizeVersion(semver) {
				collecting = true
				continue
			}
		}
		if collecting {
			if strings.HasPrefix(line, "## ") {
				break
			}
			trimmed := strings.TrimSpace(line)
			if strings.HasPrefix(trimmed, "<!--") {
				continue
			}
			lines = append(lines, line)
		}
	}
	if err := scanner.Err(); err != nil {
		return "", err
	}
	// Drop leading blank lines and the optional date line "- 2026-..."
	body := strings.TrimSpace(strings.Join(trimLeadingBlank(lines), "\n"))
	body = stripDateOnlyLine(body)
	return body, nil
}

func normalizeVersion(v string) string {
	v = strings.TrimSpace(v)
	v = strings.TrimPrefix(strings.TrimPrefix(v, "v"), "V")
	return strings.ToLower(v)
}

func trimLeadingBlank(lines []string) []string {
	i := 0
	for i < len(lines) && strings.TrimSpace(lines[i]) == "" {
		i++
	}
	return lines[i:]
}

func stripDateOnlyLine(body string) string {
	lines := strings.Split(body, "\n")
	if len(lines) > 0 {
		t := strings.TrimSpace(lines[0])
		if matched, _ := regexp.MatchString(`^\d{4}-\d{2}-\d{2}$`, t); matched {
			return strings.TrimSpace(strings.Join(lines[1:], "\n"))
		}
	}
	return body
}

func fatal(err any) {
	fmt.Fprintln(os.Stderr, "releasenotes:", err)
	os.Exit(1)
}
