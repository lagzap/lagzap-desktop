# Updater Ed25519 keys
#
# - updater.key.pub — safe to keep here; the app embeds ../updater.key.pub
# - updater.key — PRIVATE. Gitignored. Also store as GitHub secret UPDATER_PRIVATE_KEY
#
# Generate: wails3 updater genkey
# See docs/RELEASE.md
