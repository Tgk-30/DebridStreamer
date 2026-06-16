#!/bin/bash
set -e
export DEVELOPER_DIR=/Applications/Xcode-beta.app/Contents/Developer
ID="Apple Development: Brendan Toscano (5CF38X85X3)"
REPO=/Users/brendan/Desktop/DebridStreamer
REL=/tmp/ds-scratch/out/Products/Release
VLCSRC="$REPO/Vendor/VLCKit.xcframework/macos-arm64_x86_64/VLCKit.framework"
STAGE=/tmp/ds-app-stage3; APP="$STAGE/DebridStreamer.app"
cd "$REPO"
echo "[1/5] release build..."
swift build -c release --scratch-path /tmp/ds-scratch 2>&1 | grep -E "error:|Build complete" | tail -1
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
