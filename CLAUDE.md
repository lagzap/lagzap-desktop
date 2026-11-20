# LagZap desktop

## lagzap core first

- When the desktop app uses changes in lagzap (the core repo, `../..`), first
  ask to commit lagzap and tag a new version. After the person confirms, do
  both, then point the desktop app at that version (`go get
  github.com/lagzap/lagzap@<tag>`) before continuing here.

## Changelog

- Write `CHANGELOG.md` only when asked to commit, not while working. Then add
  every user-facing change in that commit (added, changed, fixed, removed)
  under `## [Unreleased]`, in the Keep a Changelog sections already used there.
  Write it for users, in plain words; no internal names.
- Before committing, show the changelog entries and ask the person committing
  to review them. Commit only after they confirm.
