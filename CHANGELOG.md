# Changelog

All notable changes to LagZap are documented here. Before each release, add a section for the tag you are about to push.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). CI reads the matching section and renders it with `.github/release-notes-template.md` on the public [lagzap-releases](https://github.com/lagzap/lagzap-releases) GitHub Release.

## [Unreleased]

### Added
- Windows release pipeline with auto-updater and GitHub Releases publishing.
- Crash reports: if LagZap crashes, the report is sent on the next start so we can fix it. Only when usage statistics are allowed.
- When a game can't connect or a server it uses goes down, its connection log is sent to help us find the problem. IP addresses and site names in it are hidden. Only when usage statistics are allowed.

### Changed
- The syncing notice now just says syncing has problems and is retrying.

### Fixed
- LagZap could crash while installing an update and reopening its windows.
- Updating could fail with a digest mismatch right after a new version came out.

---

## [0.1.0-beta.1] - 2026-07-21

### Added
- Initial beta release for Windows testers.

### Changed
- (edit before you tag)

### Fixed
- (edit before you tag)
