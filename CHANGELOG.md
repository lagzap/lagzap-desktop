# Changelog

All notable changes to LagZap are documented here. Before each release, add a section for the tag you are about to push.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). CI reads the matching section and renders it with `.github/release-notes-template.md` on the public [lagzap-releases](https://github.com/lagzap/lagzap-releases) GitHub Release.

## [Unreleased]

### Added
- Windows release pipeline with auto-updater and GitHub Releases publishing.
- Crash reports: if LagZap crashes, the report is sent on the next start so we can fix it. Only when usage statistics are allowed.
- When a game can't connect or a server it uses goes down, its connection log is sent to help us find the problem. IP addresses and site names in it are hidden. Only when usage statistics are allowed.
- Home suggests games found on your PC, with a search.
- Apps & Games has a search and groups apps by category.
- Connections shows your apps as cards, and blocked connections in the table.
- It's clear everywhere when LagZap is paused.

### Changed
- The syncing notice now just says syncing has problems and is retrying.
- Fixes and improvements while the beta is still in development.
- The main on/off switch is next to the logo.

### Fixed
- LagZap could crash while installing an update and reopening its windows.
- Updating could fail with a digest mismatch right after a new version came out.
- Route pings on a location's page could look much lower than they really were after a server outage. They are now worked out correctly and checked on the right internet.
- A server is no longer avoided because one of your internets was lagging. LagZap sets it aside only when it really stops working, and only on that internet.
- When a game is about to run out of working connections, LagZap now looks for fresh routes straight away.
- If your plan briefly failed to load, LagZap no longer stops your games' routing. It checks again first, and keeps checking until the plan is back.

---

## [0.1.3-beta.8] - 2026-11-26

### Added
- Pick the internet each app uses: one, the default, or load balancing.
- Warnings when a game's internet or location can't connect.
- Favorites grid in the sidebar, and Add App or Game.

### Changed
- Settings set for an app are marked.
- Improvements and bug fixes.

### Fixed
- Apps could fail to connect with an internet unplugged.
- Some connections, including anti-cheat games, could skip LagZap.
- If a server fails, the next one in your location is tried.
- High CPU use when a connection couldn't be carried.
- Updates could fail to download on a slow internet.

---

## [0.1.0-beta.1] - 2026-07-21

### Added
- Initial beta release for Windows testers.

### Changed
- (edit before you tag)

### Fixed
- (edit before you tag)
