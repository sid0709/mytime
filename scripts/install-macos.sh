#!/usr/bin/env bash
#
# Install MyTime on macOS without an Apple Developer account.
# Downloads the latest GitHub Release, copies the app, and strips Gatekeeper
# quarantine so the first launch is not "MyTime is damaged".
#
#   curl -fsSL https://github.com/sid0709/mytime/releases/latest/download/install-macos.sh | bash
#
set -euo pipefail

REPO="${MYTIME_REPO:-sid0709/mytime}"
API="https://api.github.com/repos/${REPO}/releases/latest"
USER_AGENT="MyTime-macos-installer"

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "error: this installer is for macOS" >&2
  exit 1
fi

ARCH="$(uname -m)"
case "$ARCH" in
  arm64) MATCH='aarch64|arm64' ;;
  x86_64) MATCH='x86_64|x64' ;;
  *)
    echo "error: unsupported architecture: ${ARCH}" >&2
    exit 1
    ;;
esac

if [[ -w /Applications ]]; then
  DEST="/Applications/MyTime.app"
else
  mkdir -p "${HOME}/Applications"
  DEST="${HOME}/Applications/MyTime.app"
fi

WORKDIR="$(mktemp -d /tmp/mytime-install.XXXXXX)"
DMG_DEVICE=""
cleanup() {
  if [[ -n "${WORKDIR:-}" && -d "$WORKDIR" ]]; then
    rm -rf "$WORKDIR"
  fi
  if [[ -n "${DMG_DEVICE:-}" ]]; then
    hdiutil detach "$DMG_DEVICE" -quiet >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

echo "==> Fetching latest MyTime release (${ARCH})"
curl -fsSL -H "User-Agent: ${USER_AGENT}" -o "${WORKDIR}/release.json" "$API"

asset_url() {
  local ext="$1"
  python3 - "${WORKDIR}/release.json" "$MATCH" "$ext" <<'PY'
import json, re, sys
from pathlib import Path
release = json.loads(Path(sys.argv[1]).read_text())
pattern = re.compile(sys.argv[2])
ext = sys.argv[3]
for asset in release.get("assets") or []:
    name = asset.get("name") or ""
    url = asset.get("browser_download_url") or ""
    if name.lower().endswith(ext) and "latest.json" not in name and pattern.search(name):
        print(url)
        break
PY
}

URL="$(asset_url ".app.tar.gz" || true)"
KIND="tar"
if [[ -z "${URL}" ]]; then
  URL="$(asset_url ".dmg" || true)"
  KIND="dmg"
fi
if [[ -z "${URL}" ]]; then
  echo "error: no macOS ${ARCH} build found on ${REPO} latest release" >&2
  echo "       publish a GitHub Release first, or set MYTIME_REPO=owner/repo" >&2
  exit 1
fi

echo "==> Downloading $(basename "${URL}")"
curl -fsSL -H "User-Agent: ${USER_AGENT}" -o "${WORKDIR}/bundle" "$URL"

APP_SRC=""
if [[ "$KIND" == "tar" ]]; then
  tar -xzf "${WORKDIR}/bundle" -C "$WORKDIR"
  APP_SRC="$(find "$WORKDIR" -maxdepth 2 -name 'MyTime.app' -type d | head -n 1)"
else
  ATTACH_OUT="$(hdiutil attach "${WORKDIR}/bundle" -nobrowse -readonly)"
  DMG_DEVICE="$(printf '%s\n' "$ATTACH_OUT" | awk 'NR==1 { print $1 }')"
  MOUNT="$(printf '%s\n' "$ATTACH_OUT" | grep -o '/Volumes/.*' | tail -n 1)"
  APP_SRC="$(find "$MOUNT" -maxdepth 2 -name 'MyTime.app' -type d | head -n 1)"
fi

if [[ -z "$APP_SRC" || ! -d "$APP_SRC" ]]; then
  echo "error: MyTime.app was not inside the downloaded archive" >&2
  exit 1
fi

echo "==> Installing to ${DEST}"
if [[ -d "$DEST" ]]; then
  rm -rf "$DEST"
fi
mkdir -p "$(dirname "$DEST")"
cp -R "$APP_SRC" "$DEST"

echo "==> Clearing Gatekeeper quarantine"
xattr -cr "$DEST" 2>/dev/null || true
if command -v codesign >/dev/null 2>&1; then
  codesign --force --deep --sign - "$DEST" >/dev/null 2>&1 || true
fi

echo "==> Launching MyTime"
open "$DEST"

echo ""
echo "Installed: ${DEST}"
echo "If macOS still blocks the app, right-click it and choose Open."
echo "Then enable Input Monitoring in System Settings when MyTime asks."
