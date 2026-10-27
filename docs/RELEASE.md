# LagZap Windows releases

## Versioning

Source of truth is **git tags** on the private `lagzap-desktop` repo.

| Tag | Channel | GitHub Release |
|-----|---------|----------------|
| `v0.2.0-dev.N` | dev | prerelease |
| `v0.2.0-beta.N` | beta | prerelease |
| `v0.2.0-rc.N` | prod host (prerelease updates) | prerelease |
| `v0.2.0` | prod | latest |

- Marketing / updater version = tag without leading `v` (e.g. `0.2.0-beta.3`).
- Windows PE / NSIS file version = `MAJOR.MINOR.PATCH.BUILD` where `BUILD` is `github.run_number` (or local `BUILD_NUMBER`).

### Local builds

```bash
# Dev / debug
wails3 task build VERSION=v0.2.0-dev.1 BUILD_TYPE=beta

# Production-shaped binary (no Garble unless seed set)
wails3 task package VERSION=v0.2.0-beta.3 BUILD_TYPE=production BUILD_NUMBER=42

# Full release artifacts (setup + zip + SHA256SUMS)
wails3 task release:windows VERSION=v0.2.0-beta.3 BUILD_TYPE=production BUILD_NUMBER=42 GARBLE_SEED=<hex>
```

### What to bump

1. Add a section to [`CHANGELOG.md`](CHANGELOG.md) for the version you are about to tag (see `## [0.1.0-beta.1]`).
2. Commit, create and push the tag — CI builds, renders release notes from `CHANGELOG.md` + [`.github/release-notes-template.md`](.github/release-notes-template.md), and publishes to the public repo with binaries attached.
3. The same formatted notes are mirrored on the private `lagzap-desktop` Releases page (no binaries there — downloads live on `cyrex-releases`).
4. Optional local override: pass `VERSION=` / `BUILD_NUMBER=` to Task.
5. Packaging metadata (`info.json`, `config.yml`, `wails_tools.nsh`) is synced by `task sync:version`.

### Release notes template

Edit these on **lagzap-desktop** before tagging:

| File | Role |
|------|------|
| [`CHANGELOG.md`](CHANGELOG.md) | What changed (Keep a Changelog sections per version) |
| [`.github/release-notes-template.md`](.github/release-notes-template.md) | LagZap-branded layout (badges, download table, beta SmartScreen note) |
| [`.github/release.yml`](.github/release.yml) | Optional GitHub UI “Generate release notes” categories when drafting a release manually |

Preview locally:

```bash
go run ./build/scripts/releasenotes \
  -version v0.1.0-beta.1 \
  -build 42 \
  -channel beta \
  -output /tmp/release-body.md
```

## Artifacts (per Windows release)

Published to a releases repo based on channel (override with `RELEASES_REPO`):

| Channel | Repo |
|---------|------|
| `dev`, `alpha` | `lagzap/current` (internal) |
| `beta`, `rc`, stable | `lagzap/cyrex-releases` (public) |

| File | Purpose |
|------|---------|
| `LagZap-windows-amd64-setup.exe` | NSIS first-time install |
| `LagZap-windows-amd64.zip` | Auto-update payload (`LagZap.exe` only) |
| `SHA256SUMS` | Digests for the updater |
| `update.manifest.json` | Optional Wails update manifest + Ed25519 signatures |

## Auto-updater

- In-app: Wails GitHub provider → `constant.ReleasesRepo` (baked at build: `lagzap/current` for alpha/dev, `lagzap/cyrex-releases` for beta/public).
- Download integrity: `SHA256SUMS` asset (digest verification).
- Ed25519 keypair (`updater.key` / `updater.key.pub`): CI signs `update.manifest.json` for stronger / future endpoint-based updates. The public key is embedded in the app.
- Beta/dev/rc builds set `Prerelease: true` so they see GitHub prereleases.
- Authenticode is **not** required for updater authenticity.

### Updater private key

Generated once with:

```bash
wails3 updater genkey
```

- Commit only `updater.key.pub` (already at repo root).
- Store `updater.key` as GitHub Actions secret `UPDATER_PRIVATE_KEY` on the **private** repo.
- Local copy (gitignored): `build/keys/updater.key`.

Sign artifacts before upload:

```bash
wails3 updater sign -key build/keys/updater.key bin/LagZap-windows-amd64.zip
wails3 updater manifest \
  -key build/keys/updater.key \
  -version 0.2.0-beta.3 \
  -channel beta \
  -o bin/update.manifest.json \
  bin/LagZap-windows-amd64.zip
```

## Garble seeds

Release builds with `GARBLE_SEED` set compile via Garble (`-literals -tiny`) and the `wails_obfuscated` tag.

- Generate a random seed per release (CI does this if unset).
- Persist `version → seed` privately (CI uploads `garble-seed.txt` as a private Actions artifact / secret store). Never publish seeds to `cyrex-releases`.
- Regenerate stable binding IDs after adding Service methods:

```bash
wails3 task common:generate:bindings:obfuscated
# commit wails_obfuscated.gen.go and updated frontend/bindings
```

Windows Defender may flag Garble intermediates — exclude Go temp + the project path on build machines ([Wails obfuscation guide](https://v3.wails.io/guides/build/obfuscation/)).

## Code signing (Authenticode)

### Beta (current)

**Ship unsigned.** Do not self-sign for external testers — SmartScreen still shows Unknown publisher, same as unsigned.

Tell testers: More info → Run anyway.

### Production (later)

1. Buy an OV/EV code signing certificate (PFX).
2. Store PFX as CI secret `WINDOWS_CERT_PFX` (base64) and password as `WAILS_WINDOWS_CERT_PASSWORD`.
3. Locally: `wails3 setup signing` or set Task vars:

```yaml
# build/windows/Taskfile.yml vars
SIGN_CERTIFICATE: path/to/cert.pfx
# or SIGN_THUMBPRINT: ...
TIMESTAMP_SERVER: http://timestamp.digicert.com
```

4. After build:

```bash
wails3 task windows:sign
wails3 task windows:sign:installer
```

Self-signed certs are only for dry-running this pipeline — not for beta distribution.

## CI secrets (private `lagzap-desktop`)

| Secret | Purpose |
|--------|---------|
| `GO_MODULE_TOKEN` | Fine-grained PAT with **Contents: Read** on every private module repo. Must include at least `lagzap/echo`, `lagzap/lagzap`, `lagzap/zap`, and any other `github.com/lagzap/*` in `go.mod`. CI writes this to `%USERPROFILE%\_netrc` for Windows `go mod` / Task subprocesses. |
| `RELEASES_TOKEN` | PAT / GitHub App token with `contents: write` on **both** `lagzap/cyrex-releases` and `lagzap/current` |
| `UPDATER_PRIVATE_KEY` | Ed25519 private key PEM for update signing |
| `WINDOWS_CERT_PFX` | (later) Base64 PFX for Authenticode |
| `WAILS_WINDOWS_CERT_PASSWORD` | (later) PFX password |

`GO_MODULE_TOKEN` can be the same fine-grained PAT as `RELEASES_TOKEN` if you grant it read on private module repos **and** write on both release repos. Locally you use `go.work` replaces; CI has no `go.work` (gitignored) so it downloads modules from GitHub.

## Releases repos

| Repo | Audience | Channels |
|------|----------|----------|
| `lagzap/cyrex-releases` | Public | beta, rc, stable |
| `lagzap/current` | Internal | alpha, dev |

Create each as an empty releases-only repo (no source). CI creates Releases there from tags on the private desktop repo. The chosen repo is also baked into the binary via `constant.ReleasesRepo` so the updater polls the same place.

## Tag → release flow

1. Edit `CHANGELOG.md` — add `## [0.1.0-beta.1]` with Added/Changed/Fixed bullets.
2. Commit and push: `git push origin main`
3. Tag and push: `git tag v0.1.0-beta.1 && git push origin v0.1.0-beta.1`
4. Workflow `.github/workflows/release-windows.yml`:
   - Renders notes from CHANGELOG + template
   - Builds Windows artifacts
   - Publishes release binaries to `lagzap/current` (alpha/dev) or `lagzap/cyrex-releases` (beta/public)
   - Mirrors the same notes on **private** `lagzap-desktop` Releases (no binaries)
5. Testers install `*-setup.exe` from the public repo; installed apps update from the zip via Check for Updates.

Manual re-run (tag already exists): **Actions → Release Windows → Run workflow** and enter the tag name.
