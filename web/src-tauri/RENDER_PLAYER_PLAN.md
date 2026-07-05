All versions confirmed. I have complete ground truth: real repo at `/Users/brendan/Developer/DebridStreamer`, branch on `player.rs` sidecar/`--wid`, libmpv 0.41 with render API present, objc2 0.3.x family, libmpv2 6.0.0. I can now write the concrete plan.

---

# mpv Render-API In-Window Player — Concrete Implementation Plan

## Ground truth verified on this machine (so the plan targets reality, not the reports)

- **Real active repo:** `/Users/brendan/Developer/DebridStreamer` (the `~/Desktop/DebridStreamer` iCloud copy is dataless — only `web/src`, no git, no `src-tauri`). All paths below are under `web/src-tauri/`.
- **Current branch state** (`dc91762`): the player is `src/player.rs` — a **sidecar + `--wid`** design, *not* the `tauri-plugin-libmpv` you referenced. There is **no vendored plugin** and **no `libmpv2` dep** on this branch (that was branch `feat/v0.5-player`). So the render-API work is a **new module that replaces `player.rs`**, and the "replace tauri-plugin-libmpv IPC" instruction actually means "replace the `mpv_*` JSON-IPC commands."
- **`tauri.conf.json` has NO `transparent` / `macOSPrivateApi` yet** — must be added (they exist only on the other branch).
- libmpv **0.41.0** at `/opt/homebrew/lib/libmpv.2.dylib`; `_mpv_render_context_create` / `_render` symbols present. Render API is fully available on-device.
- Crates confirmed on crates.io: `libmpv2 = 6.0.0`, `objc2 = 0.6` family with `objc2-quartz-core/app-kit/foundation = 0.3.2`, `objc2-core-video = 0.3.2`, `raw-window-handle = 0.6` (already a dep). rustc 1.95.

> One correction to the render-API report before you code from it: the `libmpv2` 6.0.0 `RenderContext::render(fbo, w, h, flip)` **owns the FBO/flip params internally** — you do *not* also pass a `RenderParam::FBO`. And `OpenGLInitParams.get_proc_address` is a plain `fn` pointer (not a closure) — capture-free. Both matter for the code below.

---

## Decision up front: skip CAOpenGLLayer's `draw…` callback; use an explicit FBO + CVDisplayLink

The macOS-surface report leads with subclassing `CAOpenGLLayer` and rendering inside `drawInCGLContext…`. **Do not do that first.** Subclassing an Obj-C class from `objc2` (declaring an `extern_class!` + `define_class!` with method overrides + ivars holding the mpv context) is the single most error-prone part, and CAOpenGLLayer's async draw callback runs on a private CA thread that is exactly where the earlier main-thread deadlock risk lives.

**Chosen architecture (de-risked):**

- A plain `NSOpenGLView` (or a bare `NSView` + `wantsBestResolutionOpenGLSurface`) inserted **behind** the WKWebView, backed by our own `NSOpenGLContext`.
- **We own the render loop**, driven by a **CVDisplayLink** (its callback fires on a *dedicated CV thread*, never main). mpv's update-callback just sets an atomic; the CVDisplayLink tick reads it, and if a frame is pending, makes the GL context current and calls `render_context.render(fbo, w, h, true)` then flushes.
- The FBO is **fbo `0`** (the NSOpenGLContext's default drawable/back buffer). No custom FBO, no CAOpenGLLayer draw-callback, no CA-thread reentrancy.

This keeps every mpv call on our CV thread, every AppKit hierarchy mutation on main, and the two never block on each other → the deadlock class is structurally impossible.

---

## Implement-first order

### Stage 0 — Deps + config (30 min, must compile before anything else)

`web/src-tauri/Cargo.toml`, add under `[target.'cfg(target_os = "macos")'.dependencies]` (macOS-gate everything so the Windows/Linux release matrix is untouched):

```toml
[target.'cfg(target_os = "macos")'.dependencies]
keyring = { version = "3", features = ["apple-native"] }   # existing
libmpv2 = "6.0.0"
objc2 = "0.6"
objc2-foundation = "0.3"
objc2-app-kit = { version = "0.3", features = ["NSOpenGL", "NSOpenGLView", "NSView", "NSWindow"] }
objc2-quartz-core = "0.3"
objc2-core-video = { version = "0.3", features = ["CVDisplayLink", "CVBase", "CVReturn"] }
libc = "0.2"        # dlopen/dlsym for get_proc_address
```

**Conflict check:** none. `raw-window-handle 0.6` is already in the tree and is what Tauri 2 exposes; `objc2 0.6` is compatible with the `objc2-* 0.3.2` framework crates (they depend on `objc2 ^0.6`). `libmpv2 6.0.0` pulls `libmpv2-sys` which links `libmpv` — but you'll load it at runtime via the bundled dylib, not link-time (see Stage 4 packaging); for dev, brew's `libmpv.2.dylib` on the default dylib path satisfies the linker. `core-video`/`core-video-sys` are NOT needed — use `objc2-core-video` (typed, same objc2 family) to avoid a second FFI style.

`tauri.conf.json` — add to the single window object and enable private API:

```jsonc
"windows": [{ "title": "DebridStreamer", "width": 1280, "height": 860,
              "minWidth": 960, "minHeight": 640,
              "transparent": true }],
"app": { "macOSPrivateApi": true, ... }
```

And `web/src/index.css` (or the root style): `html, body, #root { background: transparent; }` gated behind a `html.mpv-active` class so the app is opaque normally and only goes transparent while the player is mounted (mirror the `.mpv-active` mechanism from the other branch).

`Cargo.toml` needs `macos-private-api` Tauri feature: `tauri = { version = "2", features = ["macos-private-api"] }`.

**Gate:** `cargo build` (macOS) links and runs; app window still shows the React UI (transparent only when `mpv-active`).

---

### Stage 1 — MINIMAL FIRST PROOF: one video frame inside the window (the make-or-break)

New file **`web/src-tauri/src/render_player.rs`**. This stage does the absolute minimum: hardcode a test URL, no controls, no observe. Goal: prove `mpv → NSOpenGLContext → visible in the app window behind the webview`.

**Init sequence and thread assignment (this is the deadlock-critical part):**

```
                    MAIN THREAD (AppKit)                    CV DISPLAY-LINK THREAD
 player_load cmd ──▶ app.run_on_main_thread(|| {
                       1. read AppKit ns_view (raw-window-handle)
                       2. content = [ns_view superview]  (WKWebView's container)
                       3. create NSOpenGLView (our pixel format, double-buffered)
                       4. [content addSubview:glview positioned:NSWindowBelow relativeTo:nil]
                          + setAutoresizingMask (width|height sizable)
                       5. ctx = [glview openGLContext]; [ctx makeCurrentContext]
                       6. build Mpv (vo=libmpv, hwdec=auto)         ── Mpv::create is Send; ok on main
                       7. create_render_context(OpenGl, InitParams{ get_proc_address, ctx: () })
                       8. set_update_callback(|| FRAME.store(true))  ── fires on mpv's thread
                       9. start CVDisplayLink(callback=render_tick, ctx=*RenderState)
                     }).await
                    10. mpv.command(["loadfile", url])              ─────────────────────────────▶ ticks begin
                                                                    render_tick (every vsync):
                                                                      if FRAME.swap(false):
                                                                        [ctx makeCurrentContext]   (CV thread owns GL)
                                                                        rc.update()
                                                                        rc.render(0, w, h, true)
                                                                        [ctx flushBuffer]
                                                                        rc.report_swap()
```

Why this never deadlocks the way `--wid` / the CAOpenGLLayer path did:

- The **GL context is made current on the CV thread only** and never touched from main after step 5 hands it off. (Call `[ctx clearCurrentContext]` at the end of the main-thread block so ownership transfers cleanly.)
- **No mpv API call ever happens inside the update callback** — it only flips an `AtomicBool`. The actual `update()`/`render()` run on the CV thread.
- Main thread never *blocks waiting* on the render thread. `run_on_main_thread` is fire-and-forget for the loop; `player_load` returns as soon as setup is queued.
- `CVDisplayLink` callback is a C `extern "C"` fn on a CV-owned thread — it must not call back into AppKit. It only does GL + mpv render.

**Key implementation specifics for Stage 1:**

- **`get_proc_address`** must be a bare `fn(&(), &str) -> *mut c_void)` (no captures). Implement it with `dlopen("/System/Library/Frameworks/OpenGL.framework/OpenGL", RTLD_LAZY)` cached in a `once_cell`/`OnceLock`, then `dlsym`. (The macOS-surface report's snippet is correct; just cache the handle.) Add `-DGL_SILENCE_DEPRECATION` concerns don't apply to Rust — you're calling C symbols by name, deprecation is compile-time only.
- **Pixel format:** `NSOpenGLPixelFormat` with `NSOpenGLPFAOpenGLProfile = NSOpenGLProfileVersion3_2Core`, `NSOpenGLPFADoubleBuffer`, `NSOpenGLPFAAccelerated`, `NSOpenGLPFAColorSize 24`, `NSOpenGLPFAAlphaSize 8`. Core profile 3.2 is what libmpv's `gpu`/`gpu-next` GL backend wants.
- **FBO = 0**, width/height in **backing pixels** (`[glview convertRectToBacking:bounds]` → Retina-correct; wrong scale = video renders in a corner quarter). `flip = true` (GL origin bottom-left vs mpv top-left).
- **`RenderState` struct** (heap-boxed, pointer handed to CVDisplayLink as its `userInfo`): holds `RenderContext<'static>` (leak the `Mpv` with `Box::leak` or store both in the same struct so lifetimes hold), the `NSOpenGLContext` (Retained), the `AtomicBool`, and current `(w,h)`. **`RenderContext` is `!Send`** — so it must be *created on and only touched by the CV thread*. That means: create `Mpv` on main, but **create the render context inside the first CV tick** (or on a dedicated thread you spawn and then attach the CVDisplayLink to). Simplest correct ordering: create `Mpv` on main (Send), move it into the `RenderState`, and do `create_render_context` + `set_update_callback` **lazily on the first CVDisplayLink callback**, so the render context is born on the render thread it's bound to.

- **mpv init options for Stage 1:** `vo=libmpv`, `hwdec=no` (turn hwdec ON only after a frame shows — hwdec + GL interop is a second failure surface), `terminal=yes`, `msg-level=all=status,vo=v` so mpv's `[vo/gpu-next] … reconfig to WxH … Video display` lines hit stderr → the `tauri dev` log, giving you headless proof a frame rendered even before you eyeball it.

**Test:** `npm run tauri dev`, `player_load("https://media.w3.org/2010/05/sintel/trailer.mp4")` from a temporary devtools button. Success = Sintel visible **inside** the app window (no separate mpv titlebar) + stderr shows `Video display`. (Use `dangerouslyDisableSandbox` for the build per the sandbox-taint memory.)

**If Stage 1 works, the whole approach is proven.** Everything after is mechanical.

---

### Stage 2 — Full command surface + wire the webview

Flesh out `render_player.rs` into the 7 commands the task specifies, replacing the `player::mpv_*` set in `lib.rs`:

| Command | Body |
|---|---|
| `player_load(url)` | the Stage-1 setup (idempotent: reuse the view/context if already created; else create). Then `mpv.command(["loadfile", url])`. |
| `player_command(name, args)` | thin passthrough → `mpv.command(&[name, ...args])` (covers seek, playlist, cycle, sub-add, etc.) |
| `player_set(prop, value)` | `mpv.set_property(prop, value)` — value as `serde_json::Value`, dispatch to string/bool/f64/i64 |
| `player_get(prop) -> Value` | `mpv.get_property(prop)` |
| `player_observe(props: [{name,format}]) -> ()` | register mpv property observers; forward events to the webview via `window.emit("player-event", {...})` from mpv's event thread (Mpv event loop runs on a spawned std::thread that calls `mpv.wait_event`, then `window.emit`) |
| `player_destroy()` | stop CVDisplayLink, `clearCurrentContext`, drop RenderContext + Mpv, and on **main thread** `[glview removeFromSuperview]`; restore `html.mpv-active` off |
| `player_resize(w,h)` | update the `(w,h)` in RenderState (autoresizing mask handles the view; this just keeps the render dims in sync, in backing pixels) |

**State:** `.manage(render_player::PlayerState::default())` in `lib.rs`; register the 7 commands; **remove** the old `player::mpv_*` from `invoke_handler` and the `MpvState` manage (keep `player.rs` around as the fallback external-player path if you like, or delete). Keep `open_in_external_player` as the ultimate fallback.

**Webview side** — in `web/src/components/`, create/replace `EmbeddedPlayer.tsx` to call the new commands (memory says a rich `EmbeddedPlayer.tsx` exists on `feat/v0.5-player`; port it and swap its IPC layer):

```ts
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

// mount
document.documentElement.classList.add("mpv-active");
await invoke("player_load", { url });
await invoke("player_observe", { props: [
  {name:"time-pos", format:"double"}, {name:"duration", format:"double"},
  {name:"pause", format:"flag"}, {name:"paused-for-cache", format:"flag"},
  {name:"track-list", format:"node"}, {name:"eof-reached", format:"flag"},
]});
const un = await listen("player-event", (e) => updateControls(e.payload));
// controls
play/pause: invoke("player_set", { prop:"pause", value:false/true })
scrub:      invoke("player_command", { name:"seek", args:[t,"absolute"] })
audio/sub:  invoke("player_set", { prop:"aid"/"sid", value })
// unmount
await invoke("player_destroy"); un(); document.documentElement.classList.remove("mpv-active");
```

`VideoPlayer.tsx` routes the external/MKV path to `EmbeddedPlayer` when the `builtInPlayer` setting is on (that setting + routing already exists on the other branch — port it).

Also reserve control-bar space so subtitles/video aren't hidden behind controls: `mpv.set_property("video-margin-ratio-bottom", 0.18)` (the render API respects it same as `setVideoMarginRatio` did).

**Capabilities:** add the new commands to `web/src-tauri/capabilities/*.json` (`"core:event:default"` for emit/listen is likely already present; the custom commands are auto-allowed for the local window but confirm the capability set doesn't deny them).

---

### Stage 3 — hwdec + polish

- Turn on `hwdec=videotoolbox` (macOS) now that base GL works. If it corrupts/blackscreens, fall back to `hwdec=no`. VideoToolbox → GL interop is the most common breakage; keep it a runtime-switchable option.
- Handle **resize/Retina scale-factor changes** (move between displays): re-read `convertRectToBacking` on `windowDidChangeBackingProperties`; you can observe via a lightweight main-thread notification or just re-fetch backing size each CV tick (cheap).
- **Pause efficiency:** when mpv is paused and no frame pending, `CVDisplayLinkStop`; restart on the next update-callback. Prevents idle GPU churn (the perf-fix memory shows this matters).
- Track pickers (audio/sub/chapter) from `track-list`, fullscreen, keyboard — port from the existing rich `EmbeddedPlayer.tsx`.

---

### Stage 4 — Packaging (already 90% solved per memory; re-apply)

The dylib discovery + signing story is fully worked out in memory (`debridstreamer-embedded-player.md`). But note **this branch does not use the vendored plugin**, so you're loading libmpv via `libmpv2`/`libmpv2-sys` directly, which `dlopen`s by the linked install-name. Reuse the proven recipe:

1. Bundle `libmpv.2.dylib` into the app: add `"lib/**/*"` to `bundle.resources` and place `libmpv.2.dylib` (copied `-L` from brew) there.
2. `install_name_tool -id "@rpath/libmpv.2.dylib" lib/libmpv.2.dylib` (or leaf name) **then** `codesign --force --sign - lib/libmpv.2.dylib` — **install_name_tool invalidates the signature → dlopen SIGKILLs; re-sign after.** (The confirmed crash root cause from memory.)
3. `preload_bundled_libmpv()` in `.setup()`: `libc::dlopen(resource_dir/lib/libmpv.2.dylib, RTLD_NOW|RTLD_GLOBAL)` **before** `libmpv2` first touches mpv, so its leaf-name resolution binds to the bundled copy on a brew-less Mac.
4. `entitlements.plist` with `com.apple.security.cs.disable-library-validation` + `allow-jit`, wired via `bundle.macOS.entitlements`.
5. Pin `macos-15` runner in CI (not `macos-latest` = beta SDK) per the release-verification memory; fetch the dylib in CI (not committed; `lib/*.dylib` gitignored).

For **dev on this Mac**, none of this is needed — brew's dylib on the default path is found automatically.

---

## Module structure summary

```
web/src-tauri/src/
  render_player.rs   ← NEW. All below:
    struct PlayerState(Mutex<Option<Player>>)          // Tauri-managed, at-most-one
    struct Player { mpv: Mpv, view: Retained<NSView>,  // main-thread-owned handle to teardown
                    display_link, render_state: *mut RenderState }
    struct RenderState { ctx: NSOpenGLContext(Retained), rc: Option<RenderContext>,
                         frame_pending: AtomicBool, dims: Mutex<(i32,i32)>, mpv_weak }
    extern "C" fn display_link_cb(...) -> CVReturn      // CV thread: update()+render(0,w,h,true)+flush
    fn get_proc_address(&(), name) -> *mut c_void       // dlopen OpenGL.framework, cached
    #[tauri::command] player_load / player_command / player_set /
                      player_get / player_observe / player_destroy / player_resize
    fn preload_bundled_libmpv()                          // Stage 4, called from setup()
  lib.rs   ← EDIT: mod render_player; .manage(PlayerState); register 7 cmds;
             drop player::mpv_* from handler; call preload_bundled_libmpv() in .setup()
  player.rs ← keep as external-player fallback, or delete
web/src/components/
  EmbeddedPlayer.tsx ← port rich UI from feat/v0.5-player, swap IPC → player_* commands
  VideoPlayer.tsx    ← route builtInPlayer path to EmbeddedPlayer
web/src-tauri/tauri.conf.json ← transparent:true, macOSPrivateApi:true, lib/** resource
web/src-tauri/Cargo.toml       ← macOS-gated crates + tauri macos-private-api feature
```

---

## Biggest risks / unknowns / fallbacks (ordered by likelihood of biting)

1. **View z-order: our NSOpenGLView ends up in front of, or gets buried by, WKWebView's compositing layers.** WKWebView manages its own sublayers and can reorder. Mitigation: insert with `addSubview:positioned:NSWindowBelow relativeTo:nil` and verify at runtime by dumping the content view's `subviews`. **Fallback:** if sibling ordering is unstable, make the GL view a layer-hosting view and use `insertSublayer:atIndex:0` on the content view's root layer instead.

2. **`RenderContext` `!Send` vs. where it's created.** If you accidentally create it on main and use it on the CV thread you get UB/panic. **Mitigation (already baked in above):** create the render context lazily inside the first CVDisplayLink callback so it's born on its render thread. This is the single most important correctness detail.

3. **VideoToolbox↔OpenGL interop black/green frames.** Common on macOS. **Fallback:** `hwdec=no` (SW decode, GL upload) — proven to work in the POC. Make hwdec a runtime option, default `no` until validated.

4. **CAOpenGLLayer temptation / main-thread deadlock recurrence.** Explicitly avoided by not using the CA async draw callback at all. If you ever *must* (e.g. NSOpenGLView deprecation on a future macOS), the CVDisplayLink+explicit-context pattern still holds — just render into a CAOpenGLLayer's FBO from *your* thread with `asynchronous=false` and `setNeedsDisplay`, never inside CA's callback.

5. **SW-render fallback if CAOpenGLLayer/GL integration fails entirely.** libmpv2 6.0.0's safe wrapper does **not** expose the SW render path — you'd drop to `libmpv2-sys` raw FFI: `MPV_RENDER_API_TYPE_SW` + `MPV_RENDER_PARAM_SW_SIZE`/`SW_FORMAT`/`SW_STRIDE`/`SW_POINTER`, render into a `Vec<u8>` RGBA buffer on the CV thread, wrap it as a `CGImage` (`CGBitmapContext`) and set it as a plain `CALayer.contents` on the main thread. ~2-3× the CPU, but no GL context needed and immune to all GL-interop breakage. Keep this documented as the escape hatch; don't build it unless GL fails.

6. **OpenGL deprecation on macOS 26+.** OpenGL.framework still ships and `dlsym` still resolves (verified pattern), but it's living on borrowed time. Long-term the modern path is Metal via `MPV_RENDER_API_TYPE_SW` isn't it — mpv's Metal render backend is immature. For now GL is correct; revisit only if a future SDK drops OpenGL.framework.

7. **Update callback firing before render context fully constructed.** `set_update_callback` fires immediately. Register it only *after* the render context exists and the AtomicBool is in place (it is, in the lazy-first-tick ordering).

**Recommended first commit boundary:** land Stage 0 + Stage 1 as one branch (`feat/render-player`) and get the Sintel frame on-screen before writing any of Stage 2's command surface. That single frame retires ~80% of the technical risk.