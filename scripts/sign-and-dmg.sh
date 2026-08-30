#!/usr/bin/env bash
#
# Build MyTime for macOS, ad-hoc sign the .app, and package MyTime-signed.dmg.
#
# No Apple Developer account is required. Signing uses ad-hoc identity ("-").
# Recipients can install by opening the DMG, dragging MyTime to Applications, then
# on first launch either right-click → Open, or run:
#   xattr -cr /Applications/MyTime.app
#
# Optional env:
#   SKIP_BUILD=1          Skip `npm run tauri build` when .app already exists
#   SIGNING_IDENTITY=-    Ad-hoc (default). Set to a Keychain cert name to use that instead.
#   OUTPUT_DMG=/path      Override output DMG path (default: ./MyTime-signed.dmg)
#
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP="$ROOT/src-tauri/target/release/bundle/macos/MyTime.app"
ENTITLEMENTS="$ROOT/src-tauri/entitlements.plist"
OUTPUT_DMG="${OUTPUT_DMG:-$ROOT/MyTime-signed.dmg}"
IDENTITY="${SIGNING_IDENTITY:--}"
SKIP_BUILD="${SKIP_BUILD:-0}"

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "error: this script must be run on macOS" >&2
  exit 1
fi

if ! command -v codesign >/dev/null 2>&1; then
  echo "error: codesign not found (install Xcode Command Line Tools)" >&2
  exit 1
fi

if [[ ! -f "$ENTITLEMENTS" ]]; then
  echo "error: entitlements not found at $ENTITLEMENTS" >&2
  exit 1
fi

STAGING=""
cleanup() {
  if [[ -n "$STAGING" && -d "$STAGING" ]]; then
    rm -rf "$STAGING"
  fi
}
trap cleanup EXIT

if [[ "$SKIP_BUILD" != "1" ]] || [[ ! -d "$APP" ]]; then
  echo "==> Building release bundle (npm run tauri build)"
  cd "$ROOT"
  npm run tauri build
fi

if [[ ! -d "$APP" ]]; then
  echo "error: app bundle not found at $APP" >&2
  exit 1
fi

sign_file() {
  local target="$1"
  local use_entitlements="${2:-0}"
  if [[ "$use_entitlements" == "1" ]]; then
    codesign --force --sign "$IDENTITY" --entitlements "$ENTITLEMENTS" --options runtime "$target"
  else
    codesign --force --sign "$IDENTITY" --options runtime "$target" 2>/dev/null \
      || codesign --force --sign "$IDENTITY" "$target"
  fi
}

echo "==> Signing nested libraries and frameworks (identity: ${IDENTITY})"
# Deepest paths first so signatures remain valid.
while IFS= read -r -d '' item; do
  sign_file "$item" 0
done < <(find "$APP/Contents" -type f \( -name '*.dylib' -o -name '*.so' \) -print0 2>/dev/null | sort -rz || true)

while IFS= read -r -d '' framework; do
  sign_file "$framework" 0
done < <(find "$APP/Contents/Frameworks" -depth -type d -name '*.framework' -print0 2>/dev/null | sort -rz || true)

while IFS= read -r -d '' helper; do
  sign_file "$helper" 0
done < <(find "$APP/Contents/MacOS" -type f -perm +111 -print0 2>/dev/null | sort -rz || true)

MAIN_BIN="$APP/Contents/MacOS/mytime"
if [[ ! -f "$MAIN_BIN" ]]; then
  echo "error: main binary not found at $MAIN_BIN" >&2
  exit 1
fi

echo "==> Signing main binary and app bundle"
sign_file "$MAIN_BIN" 1
sign_file "$APP" 1

echo "==> Verifying signature"
codesign --verify --deep --strict --verbose=2 "$APP"
spctl --assess --type execute -vv "$APP" 2>&1 || true

echo "==> Creating DMG at $OUTPUT_DMG"
rm -f "$OUTPUT_DMG"
STAGING="$(mktemp -d /tmp/mytime-dmg-staging.XXXXXX)"
cp -R "$APP" "$STAGING/"
ln -s /Applications "$STAGING/Applications"

hdiutil create \
  -volname "MyTime" \
  -srcfolder "$STAGING" \
  -ov \
  -format UDZO \
  "$OUTPUT_DMG"

echo "==> Signing DMG"
codesign --force --sign "$IDENTITY" "$OUTPUT_DMG"

echo ""
echo "Done: $OUTPUT_DMG"
ls -lh "$OUTPUT_DMG"
echo ""
echo "Install on another Mac:"
echo "  1. Open MyTime-signed.dmg and drag MyTime to Applications"
echo "  2. First launch: right-click MyTime → Open (Gatekeeper), or run:"
echo "       xattr -cr /Applications/MyTime.app"
echo ""
echo "Note: Without an Apple Developer ID + notarization, macOS will warn on first open."
echo "      Ad-hoc signing still helps the app run consistently after the user approves it."
