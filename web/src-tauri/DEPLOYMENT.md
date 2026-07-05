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

## CI — now WIRED (`.github/workflows/web-release.yml`)

The workflow builds macOS **per-arch** and bundles libmpv into each `.app`. What
it does, in order (macOS jobs):

1. **Per-arch matrix** — `macos-15` builds `aarch64-apple-darwin`, `macos-13`
   (Intel) builds `x86_64-apple-darwin`. Each installs its NATIVE Homebrew mpv
   (no lipo), downloads only its own Node runtime (`darwin-arm64` / `darwin-x64`),
   and its `smoke_tauri_server_bundle.mjs` checks the runner's own arch — all
   consistent per job. Runtime node selection is by `std::env::consts::ARCH`
   (`server_host.rs`), so a single-arch bundle launches correctly.
2. **Import the Developer ID cert** (`apple-actions/import-codesign-certs`) into a
   keychain FIRST — so the relocated dylibs can be Developer-ID signed here. Because
   the cert is already imported, `tauri-action` is given `APPLE_SIGNING_IDENTITY`
   but NOT `APPLE_CERTIFICATE` (that would re-import).
3. **Bundle + sign** — `bundle-mpv-deps.sh $(brew --prefix)/lib/libmpv.2.dylib
   web/src-tauri/Frameworks`, then re-sign every dylib with the Developer ID +
   `--options runtime` + `--timestamp` (AFTER `install_name_tool`, which the script
   runs internally — it invalidates sigs). Sets `MPV_LIB_DIR` (so `build.rs` links
   `@rpath/libmpv.2.dylib`) and generates a `--config` override listing the real
   dylibs under `bundle.macOS.frameworks` (paths relative to `tauri.conf.json`;
   symlink excluded via `find -type f`).
4. **tauri-action** builds with `--target <arch> --config <fw.conf.json>`, copies
   the dylibs into `Contents/Frameworks`, signs + notarizes the `.app`.
5. **Notarize & staple the .dmg** (tauri-action notarizes the `.app` but not the
   `.dmg` container), then re-upload it to the draft release.

The hardened-runtime entitlements (`disable-library-validation` + `allow-jit`,
already in `entitlements.plist`) let the app load the bundled dylibs.

### First-run checklist (validate on the first real release)

- **Signing identity flow** — confirm the single `import-codesign-certs` + no
  `APPLE_CERTIFICATE` to tauri-action actually signs the `.app`. If tauri-action
  complains it needs the cert, add `APPLE_CERTIFICATE`/`_PASSWORD` back to its env
  (double-import is usually harmless).
- **Dylibs carried + signed** — on a built `.app`:
  `otool -L Contents/MacOS/debridstreamer | grep mpv` → `@rpath/libmpv.2.dylib`;
  `codesign --verify --deep --strict <app>` passes; notarization log lists no
  unsigned/`runtime`-less dylibs. If dylibs are rejected, the step-3 re-sign didn't
  take — check it ran after the script.
- **`latest.json` merge** — two macOS jobs + Linux + Windows all upload to the same
  draft release; tauri-action merges platform keys into one `latest.json`. This repo
  ALREADY relied on that merge across 3 concurrent jobs, so a 4th (2nd mac arch)
  should just add `darwin-aarch64` + `darwin-x86_64`. Verify both keys land and
  neither job clobbers the other (matrix is `fail-fast: false`).
- **Clean-Mac smoke** — on a Mac with NO `brew install mpv`, open the notarized
  DMG, install, play an MKV → the in-window player renders. `DYLD_PRINT_LIBRARIES=1
  /Applications/DebridStreamer.app/Contents/MacOS/debridstreamer` should load
  libmpv from inside the app bundle, not `/opt/homebrew` or `/usr/local`.

## Gotchas (from the render-player work)

- `install_name_tool` invalidates code signatures → the CI re-sign is mandatory and
  must run AFTER the script's `install_name_tool` rewrites (it does — step 3).
- Pin runners (`macos-15`, `macos-13`), never `macos-latest` (moved to macOS 26,
  whose SDK produces "damaged"-app codesigning — see the release-verification notes).
- The player is macOS-gated in `VideoPlayer.tsx`; no bundling on the Windows/Linux
  jobs (`matrix.os == 'macos'` guards every player step).
