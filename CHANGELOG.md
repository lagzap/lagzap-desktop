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
- Fixes and improvements while the beta is still in development.

### Fixed
- LagZap could crash while installing an update and reopening its windows.
- Updating could fail with a digest mismatch right after a new version came out.

---

## [0.1.3-beta.8] - 2026-11-26

### Added
- Each app's settings show where its traffic goes out as one card: the default internet, one internet, or load balancing over several. Multi Internet and main-and-backup internets have the same cards, and backups can be put in order by dragging them.
- A warning on a game's page when an internet one of its profiles uses is unplugged, disabled or has no internet, with one click to switch to another internet or remove it.
- A dot on Settings, and on each part of a game, shows which settings are set for that app; hover it to see which ones.
- A Retry button on the "Cloud service: Offline" notice.
- An alert on a game's page when LagZap can't connect it through the chosen location, with a quick way to change location.
- The location picker lists every location; the ones that can't connect right now say Unavailable.

### Changed
- Settings that follow the global ones show the value in use; set for an app they turn gold, with a button back to the global value. Each explanation is now in a ? next to its setting.
- "Network Status" is now "Internet Status".
- The data used now sits next to the chart's time range.

### Fixed
- With an internet disabled or unplugged, apps could fail to connect at all. LagZap now uses an internet that is connected.
- When a connection couldn't be carried, LagZap could use a lot of CPU and fill its logs while the app kept retrying.
- A server that didn't answer for a moment could be dropped. LagZap now checks it thoroughly, on each of your internets, before it avoids it.
- When a server in your chosen location can't connect, LagZap now tries the next one there instead of failing.

---

## [0.1.0-beta.1] - 2026-07-21

### Added
- Initial beta release for Windows testers.

### Changed
- (edit before you tag)

### Fixed
- (edit before you tag)
