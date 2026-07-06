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

## v0.6 — cross-platform in-window player (Windows + Linux)

The in-window player runs on all three desktop OSes. Architecture:
`render_player/core.rs` (shared mpv lifecycle + `VideoSurface` trait + `PreInit`)
+ a per-OS surface (`render_player/surface_{macos,windows,linux}.rs`):

- **macOS** — render API into a CAOpenGLLayer (`vo=libmpv`).
- **Windows** — mpv `wid`-embed into the window's HWND (`vo=gpu-next` + d3d11 +
  d3d11va).
- **Linux** — mpv `wid`-embed into the X11 window id (`vo=gpu` + gpu-context=auto
  + hwdec=auto-copy). Wayland has no XID → the surface errors and the app offers a
  one-click external-player fallback; XWayland (`GDK_BACKEND=x11`) enables it.

`surface_linux.rs`/`surface_windows.rs` need no extra crate (both read the native
window handle via `raw-window-handle`); the shared `core` links libmpv, so both
jobs must supply libmpv at link time + ship a runtime libmpv.

### The blind build loop — `.github/workflows/desktop-build.yml`

On push to the player branches this compiles + bundles Windows (nsis) and Linux
(deb), NO signing/release, and uploads the installers as artifacts for human
runtime testing. It provisions libmpv per OS:

- **Windows** — `ilammy/msvc-dev-cmd` (for `lib.exe`/`dumpbin`), fetch the latest
  shinchiro `mpv-dev-x86_64-2*.7z`. The archive ships no `mpv.def`, so synthesise
  one from `libmpv-2.dll`'s export table via `dumpbin /exports` → `.def`. The `.def`
  MUST start with `LIBRARY libmpv-2` (else `lib.exe` names the import DLL after the
  .def basename and the exe looks for the wrong module). `lib /def /out:mpv.lib
  /machine:x64`; point `build.rs` at it with `MPV_LIB_DIR`; copy `libmpv-2.dll` into
  `web/src-tauri/lib/` (shipped via `resources: lib/**/*`).
  Runtime: the DLL lives in `resources/lib`, NOT next to the exe, so a plain static
  import wouldn't resolve at load. build.rs **delay-loads** it
  (`/DELAYLOAD:libmpv-2.dll` + `delayimp`) so the app always launches, and
  `preload_bundled_libmpv()` (lib.rs, `.setup()`) `LoadLibraryExW`s the bundled copy
  by full path before the first mpv call so the delay-load stub binds to it — the
  Windows analogue of the macOS dlopen preload.
- **Linux** — `ubuntu-24.04` (libmpv.so.2 = mpv 0.37; the 2.x client API the
  libmpv2 crate needs — NOT 22.04's 0.34). apt `libmpv-dev`; the .deb declares
  `depends: libmpv2 | libmpv1`. build.rs adds the pkg-config libdir.

`tauri.ci.conf.json` sets `createUpdaterArtifacts:false` so no signing key is
needed. libmpv2-sys uses pregenerated bindings → no mpv headers required, only the
link lib.

**GATE (human, on real hardware):** in-window video appears; hwdec engages (mpv
log); and the compositing — a *windowed* WebView2 / WebKitGTK does NOT reveal video
behind it (airspace), so today mpv fills the window and covers the web UI. The
refinement is DOM-rect child positioning via `player_set_rect` (SetWindowPos /
XConfigureWindow), shared by both wid platforms — build it once the model is
confirmed on real Windows + Linux.

### Still TODO — ship the player in the real release

`web-release.yml` still builds Windows/Linux with the libmpv-free **stub** (its
Linux job is `ubuntu-22.04`, no libmpv provisioning). Since the Cargo change now
makes the Linux binary link libmpv unconditionally, that job will FAIL to link on
the next `v*-web` tag until the provisioning is ported.

The clean, decision-free plan (no glibc-baseline tradeoff needed):
- Windows job: add the same MSVC + mpv.lib(dumpbin+LIBRARY) + libmpv-2.dll steps.
- Linux job: move to `ubuntu-24.04` + apt `libmpv-dev`, build **deb + AppImage**
  (set `APPIMAGE_EXTRACT_AND_RUN=1`). The **.deb** targets 24.04+ (system libmpv2);
  the **AppImage self-contains libmpv.so.2** (verified) so it runs on ANY distro,
  INCLUDING < 24.04 — so there's no loss of reach and no baseline decision to make.
  Drop the rpm target (or give it a libmpv Requires) since it isn't validated.
- macOS is unchanged (Developer ID signing + per-arch libmpv relocation).
