# Built-in (embedded) libmpv player

## v0.5 status (2026-07-05)

**Native packaging is SOLVED and validated on a real bundle** - a locally-built
`.app` loads libmpv + the wrapper from inside `Contents/Resources/lib` and
decodes/plays video (confirmed on-device: the Sintel trailer rendered from the
built app). The three prior blockers are fixed:

1. **Wrapper discovery** - the plugin is now **vendored** (`vendor/tauri-plugin-libmpv`,
   a Cargo `path` dep) and patched: `get_wrapper()` also searches
   `exe_dir/../Resources/lib` (and `resource_dir()`), since Tauri bundles
   resources there, not next to the exe.
2. **libmpv load on a clean Mac** - the patch adds `preload_bundled_libmpv()`:
   `libc::dlopen(RTLD_NOW|RTLD_GLOBAL)` of the co-located libmpv so the wrapper's
   leaf `dlopen("libmpv.dylib")` resolves to it. Requires the bundled dylib's
   install-name leaf to be `libmpv.dylib` (`install_name_tool -id libmpv.dylib`).
3. **The SIGKILL crash** - `install_name_tool` INVALIDATES the code signature →
   `dlopen` is killed with "Code Signature Invalid". **You MUST re-sign after the
   edit** (`codesign --force --sign - libmpv.dylib`; CI: sign with the Developer
   ID). Hardened runtime also needs `entitlements.plist`
   (disable-library-validation), wired via `tauri.conf` `bundle.macOS.entitlements`.

**OPEN - the in-window blocker.** On macOS the plugin embeds mpv via `--wid`
(passing the window's NSView pointer, which IS valid). But mpv opens its OWN
window instead of compositing inside the app surface. Root cause confirmed:
mpv's macOS `--wid` view attachment needs AppKit's **main thread**, but the
plugin's `init` is a Tauri IPC command that runs on a **worker thread**
(`main_thread=false`). Dispatching `mpv_wrapper_create` to the main thread and
blocking on the result **deadlocks** (mpv's init needs the main run loop that the
blocking create occupies). So `--wid` has no clean fix here in mpv 0.41. The
robust in-window path is mpv's **render API** (an `mpv_render_context` drawing
into a `CAMetalLayer` behind the transparent webview) - how IINA does it - which
this plugin does not provide. That is the remaining (large) piece for true
in-window on macOS.

---

Status: **SHIPPED and default-on** (`builtInPlayer` defaults to `true`). libmpv
is bundled per-platform in `web-release.yml`: macOS via `scripts/bundle-mpv-deps.sh`
(Homebrew libmpv + deps relocated to @rpath), Linux via the `.deb` dependency and
a self-contained `libmpv.so.2` in the AppImage, Windows via the "Provision libmpv"
step (import lib + runtime DLL, delay-loaded by `build.rs` and `LoadLibrary`'d from
`resources/lib` at startup by `preload_bundled_libmpv`). If the native surface
can't init (Wayland, or a missing lib) playback falls back automatically to the
webview HLS transcode (resume preserved), then to an external player. The
graduation checklist below is DONE; it is kept for the bundling reference.

## Architecture

`tauri-plugin-libmpv` renders mpv on a **native Metal/GL surface behind the
webview**. To reveal it, the page is made transparent and the app UI hidden
while the player is mounted:

- Window: `transparent: true` + app `macOSPrivateApi: true` (`tauri.conf.json`).
- Plugin registered in `src/lib.rs` (`tauri_plugin_libmpv::init()`), Cargo
  feature `tauri = { features = ["macos-private-api"] }`.
- Frontend: `web/src/components/EmbeddedPlayer.tsx` drives libmpv over IPC
  (`tauri-plugin-libmpv-api`) and draws the controls; `EmbeddedPlayer.css` adds
  `html.mpv-active` rules that punch the page transparent and hide `.app`.
- `VideoPlayer.tsx` chooses the embedded path only when
  `underTauri && mode === "external" && useBuiltInPlayer` (MKV/HEVC), replacing
  the separate-window external hand-off. When off, the bundled-mpv / VLC
  hand-off is unchanged.

Two native libraries are required at runtime (bundled via
`bundle.resources: ["lib/**/*"]`, `.gitignore`d so they aren't committed):

1. `libmpv-wrapper.{dylib,so,dll}` - the plugin's C ABI shim (prebuilt by
   <https://github.com/nini22P/libmpv-wrapper/releases>).
2. `libmpv` itself - the player core (`brew`/`apt` on mac/linux; zhongfly's
   Windows build).

## The two macOS problems to solve before shipping

Both were confirmed by inspecting the installed bundle + the plugin source
(`~/.cargo/registry/.../tauri-plugin-libmpv-0.3.2/src/desktop.rs`).

### 1. Wrapper discovery: `Resources/lib` vs `MacOS/lib`

The plugin searches only `current_exe()`'s dir and `current_exe()/lib`
(`get_wrapper()` in `desktop.rs`). On macOS that is `…/Contents/MacOS[/lib]`.
But Tauri bundles `resources` into `…/Contents/Resources/lib/` - so the
documented `resources: ["lib/**/*"]` puts the wrapper where the plugin will
**not** look. Options:

- **(preferred) Vendor the plugin** as a local path dep and add
  `app.path().resource_dir()` + `.../lib` to `search_dirs`. Deterministic,
  ~5 lines, MIT-licensed. Cost: maintaining the fork.
- A post-build CI step that copies the wrapper into `Contents/MacOS/lib/`
  before signing - fragile with `tauri-action`'s atomic sign+notarize.

### 2. `libmpv` load: leaf-name `dlopen` on a clean Mac

The prebuilt wrapper links **nothing** but `libSystem` (`otool -L`); it loads
libmpv at runtime via `dlopen("libmpv.dylib")` - a **leaf name**, baked in, not
configurable by the plugin. On this dev Mac it resolves via Homebrew; on a clean
Mac it will fail. Our bundled `libmpv.dylib` also has a machine-specific install
name (`/opt/homebrew/opt/mpv/lib/libmpv.2.dylib`). Options:

- In `lib.rs` `.setup()`, before first `init`, set
  `DYLD_FALLBACK_LIBRARY_PATH` to include `resource_dir/lib` (in-process
  `setenv` is honored by later `dlopen`s). Verify the exact leaf the wrapper
  requests and bundle libmpv under that name.
- Or fix the bundled dylib's install name (`install_name_tool -id`) and confirm
  `@loader_path` resolution end-to-end.

**Neither can be validated without running a bundled build on a clean machine.**

### Smoke-test findings (2026-07-04, dev on this M1)

- **Dev discovery works.** `tauri dev` copies `lib/**/*` to `target/debug/lib/`
  - i.e. `exe_dir/lib`, exactly where `get_wrapper()` looks - so the wrapper IS
  found in dev. The `Contents/Resources/lib` gap is a **bundle-only** problem.
- **Writable-dylib gotcha.** Homebrew's `libmpv.2.dylib` is mode `444`; a `cp -L`
  preserves that, and Tauri's dev resource-copy then makes a `444` copy under
  `target/debug/lib/`. The next build fails to overwrite it with
  `Permission denied (os error 13)` in the build script. Fix: `chmod u+w` the
  bundled `lib/*.dylib` (and any stale `target/**/lib` copies) - CI must ensure
  the fetched dylibs are writable before the tauri build step.
- Capability grant `"libmpv:default"` is required in `capabilities/default.json`
  or the plugin's IPC commands are denied at runtime.

## Per-platform CI bundling (to add to `web-release.yml` once verified)

Mirror the existing `download_tauri_node_runtime.mjs` precedent - drop files
into `web/src-tauri/lib/` before the `tauri-action` step.

- **macOS (`macos-15`, universal):** download `libmpv-wrapper-macos-aarch64`
  and `-x86_64` zips → `lipo -create` → `lib/libmpv-wrapper.dylib`;
  `brew install mpv` and copy `libmpv.2.dylib` for both arches (lipo) →
  `lib/libmpv.dylib`. Apply macOS fixes #1 and #2 above.
- **Linux (`ubuntu-22.04`):** `apt install libmpv-dev libmpv2`; download
  `libmpv-wrapper-linux-x86_64` → `lib/libmpv-wrapper.so`; copy
  `libmpv.so.2` → `lib/`. (deb/AppImage exe layout differs - re-check the
  `current_exe()/lib` search there too.)
- **Windows (`windows-latest`):** `npx tauri-plugin-libmpv-api setup-lib`
  fetches `libmpv-wrapper.dll` + `libmpv-2.dll` into `lib/`. Windows places
  resources next to the exe, so discovery there is expected to work as-is.

Pin versions + verify downloads (size/sha) like the Node runtime script does.

## Graduation checklist (DONE - kept for reference)

1. Bundle the dylibs (above) and confirm a **clean-machine** build renders video.
2. Flip `builtInPlayer` default to `true` in `web/src/data/settings.ts` and the
   `useBuiltInPlayer` prop default in `VideoPlayer.tsx`.
3. Drop the "experimental" wording in `Settings.tsx`.
