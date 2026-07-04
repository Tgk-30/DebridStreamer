# Built-in (embedded) libmpv player

Status: **foundation complete + tested; native distributable packaging NOT yet
verified.** The in-window player is gated behind an experimental Settings toggle
that is **off by default** (`builtInPlayer`). Turning it on today only works in a
dev environment where libmpv is already on the system (e.g. `brew install mpv`).

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

1. `libmpv-wrapper.{dylib,so,dll}` — the plugin's C ABI shim (prebuilt by
   <https://github.com/nini22P/libmpv-wrapper/releases>).
2. `libmpv` itself — the player core (`brew`/`apt` on mac/linux; zhongfly's
   Windows build).

## The two macOS problems to solve before shipping

Both were confirmed by inspecting the installed bundle + the plugin source
(`~/.cargo/registry/.../tauri-plugin-libmpv-0.3.2/src/desktop.rs`).

### 1. Wrapper discovery: `Resources/lib` vs `MacOS/lib`

The plugin searches only `current_exe()`'s dir and `current_exe()/lib`
(`get_wrapper()` in `desktop.rs`). On macOS that is `…/Contents/MacOS[/lib]`.
But Tauri bundles `resources` into `…/Contents/Resources/lib/` — so the
documented `resources: ["lib/**/*"]` puts the wrapper where the plugin will
**not** look. Options:

- **(preferred) Vendor the plugin** as a local path dep and add
  `app.path().resource_dir()` + `.../lib` to `search_dirs`. Deterministic,
  ~5 lines, MIT-licensed. Cost: maintaining the fork.
- A post-build CI step that copies the wrapper into `Contents/MacOS/lib/`
  before signing — fragile with `tauri-action`'s atomic sign+notarize.

### 2. `libmpv` load: leaf-name `dlopen` on a clean Mac

The prebuilt wrapper links **nothing** but `libSystem` (`otool -L`); it loads
libmpv at runtime via `dlopen("libmpv.dylib")` — a **leaf name**, baked in, not
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
  — i.e. `exe_dir/lib`, exactly where `get_wrapper()` looks — so the wrapper IS
  found in dev. The `Contents/Resources/lib` gap is a **bundle-only** problem.
- **Writable-dylib gotcha.** Homebrew's `libmpv.2.dylib` is mode `444`; a `cp -L`
  preserves that, and Tauri's dev resource-copy then makes a `444` copy under
  `target/debug/lib/`. The next build fails to overwrite it with
  `Permission denied (os error 13)` in the build script. Fix: `chmod u+w` the
  bundled `lib/*.dylib` (and any stale `target/**/lib` copies) — CI must ensure
  the fetched dylibs are writable before the tauri build step.
- Capability grant `"libmpv:default"` is required in `capabilities/default.json`
  or the plugin's IPC commands are denied at runtime.

## Per-platform CI bundling (to add to `web-release.yml` once verified)

Mirror the existing `download_tauri_node_runtime.mjs` precedent — drop files
into `web/src-tauri/lib/` before the `tauri-action` step.

- **macOS (`macos-15`, universal):** download `libmpv-wrapper-macos-aarch64`
  and `-x86_64` zips → `lipo -create` → `lib/libmpv-wrapper.dylib`;
  `brew install mpv` and copy `libmpv.2.dylib` for both arches (lipo) →
  `lib/libmpv.dylib`. Apply macOS fixes #1 and #2 above.
- **Linux (`ubuntu-22.04`):** `apt install libmpv-dev libmpv2`; download
  `libmpv-wrapper-linux-x86_64` → `lib/libmpv-wrapper.so`; copy
  `libmpv.so.2` → `lib/`. (deb/AppImage exe layout differs — re-check the
  `current_exe()/lib` search there too.)
- **Windows (`windows-latest`):** `npx tauri-plugin-libmpv-api setup-lib`
  fetches `libmpv-wrapper.dll` + `libmpv-2.dll` into `lib/`. Windows places
  resources next to the exe, so discovery there is expected to work as-is.

Pin versions + verify downloads (size/sha) like the Node runtime script does.

## To turn it on after verification

1. Bundle the dylibs (above) and confirm a **clean-machine** build renders video.
2. Flip `builtInPlayer` default to `true` in `web/src/data/settings.ts` and the
   `useBuiltInPlayer` prop default in `VideoPlayer.tsx`.
3. Drop the "experimental" wording in `Settings.tsx`.
