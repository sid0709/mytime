# Setup

## Install

**macOS** (no Apple Developer account):

```bash
curl -fsSL https://github.com/sid0709/mytime/releases/latest/download/install-macos.sh | bash
```

Allow **Input Monitoring** when asked. Later updates clear Gatekeeper quarantine automatically.

If the app is blocked, right-click MyTime → **Open**.

**Windows:** download the NSIS `.exe` from [Releases](https://github.com/sid0709/mytime/releases/latest). If SmartScreen appears, choose **More info** → **Run anyway** until Authenticode signing is configured below.

## Develop

Needs Node.js, npm, Rust, and [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/).

```bash
npm install
npm run tauri dev
```

```bash
npm run tauri build
SKIP_BUILD=1 npm run build:mac-dmg   # optional local ad-hoc DMG
cargo test --manifest-path src-tauri/Cargo.toml
```

## Release

Merging to `main` / `master` (or running the **Release App** workflow) builds macOS + Windows and publishes a GitHub Release. **Bump the minor version** in `src-tauri/tauri.conf.json` (and `package.json` / `Cargo.toml`) and add bullets to `CHANGELOG.md` first, or existing installs will not be offered an update. Policy: [`.cursor/VERSIONING.md`](../.cursor/VERSIONING.md).

### GitHub Actions secrets

| Secret | Required | Purpose |
|---|---|---|
| `TAURI_SIGNING_PRIVATE_KEY` | No (needed for in-app updates) | Full minisign private key, including the `untrusted comment:` line. Without it, CI still publishes installers; the updater will not sign `latest.json`. |
| `WINDOWS_CERTIFICATE` | No | Base64 `.pfx` (OV/EV Authenticode). Without it, Windows still builds; SmartScreen warns. |
| `WINDOWS_CERTIFICATE_PASSWORD` | No | PFX password |

If Release App fails with `Missing comment in secret key`, the secret is empty or truncated. On this machine the key is `~/.tauri/mytime.key`. Paste the **entire file** into **Settings → Secrets and variables → Actions → TAURI_SIGNING_PRIVATE_KEY**. Do not add a password secret; this key has none.

Encode a Windows certificate:

```powershell
[Convert]::ToBase64String([IO.File]::ReadAllBytes("certificate.pfx"))
```

An EV cert usually skips SmartScreen immediately. An OV cert still warns until the signed file builds reputation. macOS stays ad-hoc signed unless you later add an Apple Developer ID.
