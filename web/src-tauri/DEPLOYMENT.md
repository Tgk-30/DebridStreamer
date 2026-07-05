# Shipping the in-window player (libmpv) on macOS

The built-in player (`render_player.rs`) links **libmpv**, which pulls in a
55-dylib tree (ffmpeg, libass, libplacebo, luajit, x264/5, … ≈ 59 MB). To ship a
turnkey player that works on a clean Mac (no Homebrew), that whole tree is bundled
into the `.app` and relocated to `@rpath`.

## Decision (v0.5)

- **Hybrid / turnkey**: bundle libmpv + deps into the `.app`; the in-window player
  is the **default** on macOS. Users can turn it off (Settings → Playback →
  "Built-in player") to hand off to an external player (VLC/IINA/…) — Stremio-style.
- **Per-arch DMGs** (not universal): build arm64 on an Apple-Silicon runner and
  x86_64 on an Intel runner, each bundling its **native** Homebrew libmpv. This
  avoids lipo-ing 55 dylibs from two brews (fragile) — each runner uses its own.
- macOS only for now (the render surface is AppKit); other platforms fall back to
  the external hand-off regardless of the setting.

## What's already in the repo (validated locally)

1. **`scripts/bundle-mpv-deps.sh <libmpv.2.dylib> <out-dir>`** — copies libmpv +
   its full non-system dependency tree into `<out-dir>`, rewrites every install
   name to `@rpath/<name>`, adds a `libmpv.dylib` link (for the linker's `-lmpv`),
   and ad-hoc signs each. Verified: 0 remaining Homebrew paths; dyld loads every
   dylib from the bundle, not Homebrew.
2. **`build.rs`** — adds rpath `@executable_path/../Frameworks` (where a release
   `.app` keeps them) and resolves the link path (env `MPV_LIB_DIR` → pkg-config →
   Homebrew). Verified: with `MPV_LIB_DIR` set to the relocated dir, the app binary
   references `@rpath/libmpv.2.dylib`, not the Homebrew absolute path.

## CI changes still to make (`.github/workflows/web-release.yml`)

These need a real CI run + the Developer ID secrets to validate, so they're
written up rather than committed blind.

### 1. Per-arch matrix (replace the single universal macOS job)

```yaml
matrix:
  include:
    - { platform: macos-15, arch: aarch64, rust_target: aarch64-apple-darwin }
    - { platform: macos-13, arch: x86_64,  rust_target: x86_64-apple-darwin  }
```
- Use `targets: ${{ matrix.rust_target }}` (single target per job, not both).
- `macos-13` is the Intel runner → its `brew install mpv` gives x86_64 dylibs
  natively (no Rosetta/lipo).

### 2. Bundle + sign step (per job, BEFORE the tauri-action build)

```bash
brew install mpv
FW="$PWD/web/src-tauri/Frameworks"
web/src-tauri/scripts/bundle-mpv-deps.sh "$(brew --prefix)/lib/libmpv.2.dylib" "$FW"
# Re-sign each dylib with the Developer ID + hardened runtime + timestamp so
# notarization accepts them (the ad-hoc sigs from the script are for local use):
for f in "$FW"/*.dylib; do
  codesign --force --timestamp --options runtime \
    --sign "$APPLE_SIGNING_IDENTITY" "$f"
done
echo "MPV_LIB_DIR=$FW" >> "$GITHUB_ENV"   # so build.rs links @rpath libmpv
```

### 3. Make Tauri bundle the Frameworks into the `.app`

Tauri copies `bundle.macOS.frameworks` entries into `Contents/Frameworks` during
assembly (before it signs), so the Developer-ID-signed dylibs get carried in and
kept intact. Pass the generated list via `tauri-action`'s `args` as a `--config`
override (the list is dynamic):

```bash
FW_JSON=$(ls "$FW"/*.dylib | jq -R . | jq -s '{bundle:{macOS:{frameworks:.}}}')
echo "$FW_JSON" > /tmp/fw.conf.json
# tauri-action: args: --config /tmp/fw.conf.json
```

Verify after build: `otool -L <app>/Contents/MacOS/debridstreamer | grep mpv`
shows `@rpath/libmpv.2.dylib`, and `codesign --verify --deep --strict <app>`
passes. The hardened-runtime entitlement `disable-library-validation`
(already in `entitlements.plist`) lets the app load these Developer-ID dylibs.

### 4. Updater `latest.json` — per-arch targets

The universal build produced one `darwin-x86_64`/`darwin-universal` entry; with
per-arch DMGs the updater manifest needs both `darwin-aarch64` and `darwin-x86_64`
platform keys pointing at their respective signed `.app.tar.gz` + signature.
tauri-action emits per-target artifacts; merge them into one `latest.json`.

## Gotchas (from the render-player work)

- `install_name_tool` invalidates code signatures → the CI re-sign in step 2 is
  mandatory, and it must run AFTER the script's `install_name_tool` rewrites.
- Pin runners (`macos-15`, `macos-13`), never `macos-latest` (moved to macOS 26,
  whose SDK produces "damaged"-app codesigning — see the release-verification notes).
- The player is macOS-gated in `VideoPlayer.tsx`; no bundling is needed for the
  Windows/Linux jobs.
