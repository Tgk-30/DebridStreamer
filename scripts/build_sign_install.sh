#!/bin/bash
set -e
# Local-only dev helper. Override the toolchain + signing identity via env vars;
# REPO is derived from this script's location so it works from any checkout.
export DEVELOPER_DIR="${DEVELOPER_DIR:-/Applications/Xcode-beta.app/Contents/Developer}"
# Signing identity: set SIGN_IDENTITY to your own (e.g. "Apple Development: …"
# or "Developer ID Application: …"); defaults to "-" for ad-hoc local signing.
ID="${SIGN_IDENTITY:--}"
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REL=/tmp/ds-scratch/out/Products/Release
VLCSRC="$REPO/Vendor/VLCKit.xcframework/macos-arm64_x86_64/VLCKit.framework"
STAGE=/tmp/ds-app-stage3; APP="$STAGE/DebridStreamer.app"
cd "$REPO"
echo "[1/5] release build..."
# Pipe to grep loses swift's exit code under `set -e` (grep's success masks a failed
# build), which silently ships a STALE binary. Capture PIPESTATUS[0] = swift's real
# status; on failure, clean a corrupt Release intermediates dir and retry once.
release_build() {
  swift build -c release --scratch-path /tmp/ds-scratch 2>&1 | grep -E "error:|Build complete" | tail -1
  return "${PIPESTATUS[0]}"
}
if ! release_build; then
  echo "    release build failed - cleaning Release intermediates and retrying once..."
  rm -rf /tmp/ds-scratch/out/Intermediates.noindex/DebridStreamer.build/Release \
         /tmp/ds-scratch/out/Products/Release
  if ! release_build; then
    echo "    release build still failing after clean - aborting (not shipping stale binary)." >&2
    exit 1
  fi
fi
pkill -f "/Applications/DebridStreamer.app" 2>/dev/null || true; sleep 1
echo "[2/5] assemble..."
rm -rf "$STAGE"; mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Frameworks" "$APP/Contents/Resources"
ditto --noextattr --norsrc "$REL/DebridStreamer" "$APP/Contents/MacOS/DebridStreamer"
ditto --noextattr --norsrc "$VLCSRC" "$APP/Contents/Frameworks/VLCKit.framework"
ditto --noextattr --norsrc "$REL/DebridStreamer_DebridStreamer.bundle" "$APP/Contents/Resources/DebridStreamer_DebridStreamer.bundle"
install_name_tool -add_rpath "@executable_path/../Frameworks" "$APP/Contents/MacOS/DebridStreamer" 2>/dev/null || true
cat > "$APP/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleExecutable</key><string>DebridStreamer</string>
<key>CFBundleIdentifier</key><string>com.tgk30.DebridStreamer</string>
<key>CFBundleName</key><string>DebridStreamer</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleShortVersionString</key><string>1.0</string><key>CFBundleVersion</key><string>1</string>
<key>LSMinimumSystemVersion</key><string>14.0</string><key>NSPrincipalClass</key><string>NSApplication</string>
<key>NSHighResolutionCapable</key><true/></dict></plist>
PLIST
echo "[3/5] sign..."
codesign --force --deep --sign "$ID" --timestamp=none "$APP/Contents/Frameworks/VLCKit.framework" >/dev/null 2>&1
codesign --force --sign "$ID" --timestamp=none "$APP/Contents/Resources/DebridStreamer_DebridStreamer.bundle" >/dev/null 2>&1
codesign --force --sign "$ID" --timestamp=none "$APP/Contents/MacOS/DebridStreamer" >/dev/null 2>&1
codesign --force --sign "$ID" --timestamp=none "$APP" >/dev/null 2>&1
codesign --verify --deep --strict "$APP" && echo "    verify OK"
echo "[4/5] install..."
rm -rf /Applications/DebridStreamer.app; ditto "$APP" /Applications/DebridStreamer.app
echo "[5/5] launch..."
open /Applications/DebridStreamer.app
