// Shared, PLATFORM-AGNOSTIC core of the in-window mpv player.
//
// Everything here is free of `#[cfg]` and identical on every OS: the mpv handle,
// the event loop that forwards property changes to the webview, property/command
// marshalling, the Tauri command surface, and the `VideoSurface` trait that is the
// ONLY platform-specific seam. Each OS provides a `surface_*.rs` that implements
// `VideoSurface` + an `attach_surface()` constructor; `mod.rs` selects one by cfg.
//
// The mpv lifecycle logic was lifted verbatim from the original macOS-only
// `render_player.rs` - see `surface_macos.rs` for the macOS render surface.

use std::collections::HashMap;
use std::ffi::{c_void, CStr};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, OnceLock};
use std::thread::JoinHandle;

use libmpv2::{Format, Mpv};

use serde::Deserialize;
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager, Runtime, State, Window};

/// Trace log, OFF unless `DS_MPV_DEBUG` is set. GUI-app stderr is unreliable under
/// `tauri dev`, so when enabled this appends to a file. Shared by core + surfaces.
pub(crate) fn rp_debug_enabled() -> bool {
    static ON: OnceLock<bool> = OnceLock::new();
    *ON.get_or_init(|| std::env::var_os("DS_MPV_DEBUG").is_some())
}

pub(crate) fn rp_log(msg: &str) {
    use std::io::Write;
    if !rp_debug_enabled() {
        return;
    }
    if let Ok(mut f) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open("/tmp/ds-rp-debug.log")
    {
        let _ = writeln!(f, "{msg}");
    }
}

/// The ONE platform-specific seam. A surface owns the native video rendering
/// (macOS: CAOpenGLLayer render API; Windows: a wid-embedded child HWND; Linux: a
/// wid-embedded X11 child window) and composites it with the app window. The mpv
/// handle is shared; a render-API surface binds an `mpv_render_context` to it,
/// while a wid surface just hands mpv a native window handle.
///
/// Object-safe (no `attach` here); construction is the cfg-selected free function
/// `attach_surface()`, so `Player` can hold an `Arc<dyn VideoSurface>` shared with
/// the mpv event thread.
pub trait VideoSurface: Send + Sync {
    /// Keep the video rect synced to the app layout, in BACKING pixels. A no-op on
    /// macOS (the surface autoresizes with the window) and on the wid-embed
    /// surfaces for now (mpv fills the wid window); the future refinement is a
    /// DOM-rect child reposition (SetWindowPos / XConfigureWindow).
    fn set_rect(&self, x: i32, y: i32, w: i32, h: i32);

    /// A new file is about to replace the current one. Render surfaces that own
    /// native window geometry use this to discard the prior video's aspect until
    /// mpv publishes the new dwidth/dheight pair.
    fn video_file_started(&self) {}

    /// mpv's aspect-corrected display dimensions changed. macOS uses this to wrap
    /// the NSWindow content area around the video; wid-based surfaces do nothing.
    fn video_dimensions_changed(&self, _width: i64, _height: i64) {}

    /// Playback reached EOF (or otherwise ended). Native window constraints and
    /// session-owned window geometry must be restored by the platform surface.
    fn video_playback_ended(&self) {}

    /// ORDERED teardown - the single most bug-prone invariant. Each surface MUST:
    /// stop its redraws, free any `mpv_render_context` (or DestroyWindow) BEFORE
    /// the shared `Arc<Mpv>` drops and destroys mpv (freeing a render context after
    /// mpv is destroyed is a use-after-free = the historical "back button crash"),
    /// and detach the native view on the UI thread. Must be idempotent.
    fn detach(&self);
}

/// A live in-window player: shared mpv + a platform surface + the event thread.
pub struct Player {
    pub(crate) mpv: Arc<Mpv>,
    surface: Arc<dyn VideoSurface>,
    event_stop: Arc<AtomicBool>,
    event_thread: Option<JoinHandle<()>>,
}

impl Player {
    /// Stop the event thread, then tear the surface down. The surface's `detach`
    /// owns the ordered render-context-before-mpv teardown; `self.mpv` drops after.
    fn shutdown(&mut self) {
        self.event_stop.store(true, Ordering::Release);
        if let Some(t) = self.event_thread.take() {
            let _ = t.join();
        }
        self.surface.detach();
    }
}

/// One property to observe (from the JS `MpvConfig.observedProperties`).
#[derive(Deserialize)]
pub struct ObserveSpec {
    pub name: String,
    /// "flag" | "double" | "int64" | "string"
    pub format: String,
}

/// Tauri-managed: at most one in-window player at a time.
#[derive(Default)]
pub struct PlayerState(pub std::sync::Mutex<Option<Player>>);

// ---- mpv event loop → webview events ------------------------------------
// Uses raw libmpv2-sys `mpv_wait_event` (libmpv2's safe wrapper panics on a
// MPV_FORMAT_NONE property change, which happens routinely when a property
// becomes unavailable). Emits `player-event` = { name, data } to the webview.
fn spawn_event_thread<R: Runtime>(
    app: AppHandle<R>,
    mpv: Arc<Mpv>,
    mut observed: Vec<ObserveSpec>,
    stop: Arc<AtomicBool>,
    surface: Arc<dyn VideoSurface>,
) -> JoinHandle<()> {
    // Window wrapping is Rust-owned and must not depend on which diagnostics the
    // frontend happens to request. Keep these observations internal-by-default;
    // duplicate names are avoided when the frontend already requested them.
    for (name, format) in [
        ("dwidth", "int64"),
        ("dheight", "int64"),
        ("eof-reached", "flag"),
    ] {
        if !observed.iter().any(|spec| spec.name == name) {
            observed.push(ObserveSpec {
                name: name.to_string(),
                format: format.to_string(),
            });
        }
    }

    std::thread::spawn(move || {
        // The primary handle already has its own event queue and libmpv's client
        // API is thread-safe. Do NOT create a secondary client here: libmpv2 5.0.3
        // wraps a possibly-null mpv_create_client result with NonNull::new_unchecked,
        // which aborts the process under a rapid create/destroy race instead of
        // returning an error.
        if stop.load(Ordering::Acquire) {
            return;
        }
        for (i, spec) in observed.iter().enumerate() {
            let fmt = match spec.format.as_str() {
                "flag" => Format::Flag,
                "double" => Format::Double,
                "int64" => Format::Int64,
                _ => Format::String,
            };
            let _ = mpv.observe_property(&spec.name, fmt, i as u64);
        }
        let ctx = mpv.ctx.as_ptr();
        let mut display_width: Option<i64> = None;
        let mut display_height: Option<i64> = None;
        while !stop.load(Ordering::Acquire) {
            let ev = unsafe { &*libmpv2_sys::mpv_wait_event(ctx, 0.25) };
            match ev.event_id {
                libmpv2_sys::mpv_event_id_MPV_EVENT_NONE => {}
                libmpv2_sys::mpv_event_id_MPV_EVENT_SHUTDOWN => break,
                libmpv2_sys::mpv_event_id_MPV_EVENT_START_FILE => {
                    display_width = None;
                    display_height = None;
                    surface.video_file_started();
                    rp_log("RPGEO event=file-start engine=native-mpv dwidth=? dheight=?");
                }
                libmpv2_sys::mpv_event_id_MPV_EVENT_END_FILE => {
                    let ef = unsafe { &*(ev.data as *mut libmpv2_sys::mpv_event_end_file) };
                    surface.video_playback_ended();
                    rp_log(&format!(
                        "event thread: END_FILE reason={} error={}",
                        ef.reason, ef.error
                    ));
                    // mpv_end_file_reason (stable public ABI): EOF=0, STOP=2,
                    // QUIT=3, ERROR=4, REDIRECT=5. Only ERROR is a genuine playback
                    // FAILURE - a file `loadfile` ACCEPTED but that then failed to
                    // demux/decode (corrupt data, or a codec this build can't
                    // handle). `loadfile` returns success in that case and the
                    // decode error surfaces only here, asynchronously, so this is
                    // the sole signal the webview gets to fall back to the HLS
                    // transcode. EOF/stop/quit/redirect are normal and are never
                    // forwarded (a forwarded EOF would tear down the end card).
                    // Widen to i64 before comparing: `reason` is a bindgen enum
                    // alias whose primitive type (c_int vs c_uint) we don't pin
                    // here, and i64 fits either without a lint-flagged narrowing.
                    const MPV_END_FILE_REASON_ERROR: i64 = 4;
                    if ef.reason as i64 == MPV_END_FILE_REASON_ERROR {
                        let _ = app.emit(
                            "player-event",
                            json!({
                                "name": "end-file",
                                "data": { "error": true, "code": ef.error as i64 }
                            }),
                        );
                    }
                    rp_log(&format!(
                        "RPGEO event=file-end engine=native-mpv dwidth={} dheight={}",
                        display_width
                            .map(|v| v.to_string())
                            .unwrap_or_else(|| "?".to_string()),
                        display_height
                            .map(|v| v.to_string())
                            .unwrap_or_else(|| "?".to_string())
                    ));
                }
                libmpv2_sys::mpv_event_id_MPV_EVENT_PROPERTY_CHANGE => {
                    let prop = unsafe { &*(ev.data as *mut libmpv2_sys::mpv_event_property) };
                    if prop.name.is_null() {
                        continue;
                    }
                    let name = unsafe { CStr::from_ptr(prop.name) }
                        .to_string_lossy()
                        .into_owned();
                    let data = unsafe { prop_data_to_json(prop.format, prop.data) };
                    let dimension_changed = match name.as_str() {
                        "dwidth" => {
                            display_width = data.as_i64().filter(|v| *v > 0);
                            true
                        }
                        "dheight" => {
                            display_height = data.as_i64().filter(|v| *v > 0);
                            true
                        }
                        _ => false,
                    };
                    if dimension_changed {
                        rp_log(&format!(
                            "RPGEO event=mpv-display-property engine=native-mpv property={name} dwidth={} dheight={}",
                            display_width
                                .map(|v| v.to_string())
                                .unwrap_or_else(|| "?".to_string()),
                            display_height
                                .map(|v| v.to_string())
                                .unwrap_or_else(|| "?".to_string())
                        ));
                        if let (Some(width), Some(height)) = (display_width, display_height) {
                            surface.video_dimensions_changed(width, height);
                        }
                    } else if name == "eof-reached" {
                        if data == Value::Bool(true) {
                            surface.video_playback_ended();
                        } else if data == Value::Bool(false) {
                            // Replay after keep-open does not necessarily emit a
                            // fresh START_FILE/dwidth pair. Re-apply the retained
                            // dimensions when EOF clears.
                            if let (Some(width), Some(height)) = (display_width, display_height) {
                                surface.video_dimensions_changed(width, height);
                            }
                        }
                    }
                    let _ = app.emit("player-event", json!({ "name": name, "data": data }));
                }
                _ => {}
            }
        }
        rp_log("event thread: stopped");
    })
}

unsafe fn prop_data_to_json(format: libmpv2_sys::mpv_format, data: *mut c_void) -> Value {
    if data.is_null() {
        return Value::Null;
    }
    match format {
        libmpv2_sys::mpv_format_MPV_FORMAT_FLAG => json!(*(data as *mut i32) != 0),
        libmpv2_sys::mpv_format_MPV_FORMAT_INT64 => json!(*(data as *mut i64)),
        libmpv2_sys::mpv_format_MPV_FORMAT_DOUBLE => json!(*(data as *mut f64)),
        libmpv2_sys::mpv_format_MPV_FORMAT_STRING
        | libmpv2_sys::mpv_format_MPV_FORMAT_OSD_STRING => {
            let s = *(data as *mut *mut std::os::raw::c_char);
            if s.is_null() {
                Value::Null
            } else {
                json!(CStr::from_ptr(s).to_string_lossy().into_owned())
            }
        }
        _ => Value::Null,
    }
}

/// Options OWNED by the native renderer that frontend-supplied values must never
/// override, because they are required for safety. The app drives mpv entirely
/// through libmpv and does not use mpv's built-in Lua scripts; Homebrew's arm64
/// mpv bundles LuaJIT, and on newer macOS the Hardened Runtime rejects the
/// executable pages LuaJIT creates while loading built-ins such as stats/console
/// and kills the signed app with CODESIGNING/Invalid Page. `load-scripts=no` alone
/// only disables USER scripts in mpv 0.41, so every built-in script switch must be
/// turned off explicitly. Applied at init on macOS only (the crash is macOS-
/// specific and some switches need mpv >= 0.40), but the frontend-override block
/// in `create_player` uses this list on every platform. (vo/hwdec are deliberately
/// NOT here: they are single-sourced per-platform in `best_in_class_options` and
/// guarded separately in `create_player`.)
const FORCED_MPV_OPTIONS: &[(&str, &str)] = &[
    ("load-scripts", "no"),
    ("load-auto-profiles", "no"),
    ("load-commands", "no"),
    ("load-console", "no"),
    ("load-context-menu", "no"),
    ("load-positioning", "no"),
    ("load-select", "no"),
    ("load-stats-overlay", "no"),
    ("osc", "no"),
    ("ytdl", "no"),
];

fn is_forced_mpv_option(name: &str) -> bool {
    FORCED_MPV_OPTIONS.iter().any(|(forced, _)| *forced == name)
}

/// Best-in-class mpv options applied to EVERY player before user overrides -
/// the same engine mpv/IINA use, tuned for high-quality scaling, debanding,
/// hardware decode, and streaming-cache "debrid feel". Per-platform decode +
/// output are selected by `cfg!(target_os)`:
///   * macOS/Linux use the OpenGL render API → `vo=libmpv` is MANDATORY; the
///     quality options below still tune the gpu renderer the render API drives.
///     (gpu-next-as-a-vo does not apply under the render API - see the memory.)
///   * Windows wid-embeds mpv → it owns a native `vo=gpu-next` + d3d11.
/// hwdec is per-OS: zero-copy `videotoolbox` on macOS, `d3d11va` on Windows,
/// `auto-copy` (vaapi/nvdec) on Linux - all fall back to software automatically,
/// so they can't break playback. It is set ONLY here (the webview no longer
/// overrides it).
pub(crate) fn best_in_class_options() -> Vec<(&'static str, &'static str)> {
    let mut o = vec![
        // The native surface always fills the window; mpv owns any genuine
        // letterboxing and must never stretch the decoded picture to that surface.
        ("keepaspect", "yes"),
        // Rendering quality (libplacebo-grade scaling + downscale correctness).
        ("scale", "ewa_lanczossharp"),
        ("cscale", "ewa_lanczossharp"),
        ("dscale", "mitchell"),
        ("scale-antiring", "0.6"),
        ("cscale-antiring", "0.6"),
        ("correct-downscaling", "yes"),
        ("linear-downscaling", "yes"),
        ("sigmoid-upscaling", "yes"),
        // Debanding + dithering (big win on compressed debrid streams).
        ("deband", "yes"),
        ("deband-iterations", "2"),
        ("deband-threshold", "35"),
        ("deband-range", "16"),
        ("deband-grain", "4"),
        ("dither-depth", "auto"),
        ("dither", "error-diffusion"),
        ("error-diffusion", "sierra-lite"),
        // Streaming cache - the debrid-feel levers (instant seek both directions).
        ("cache", "yes"),
        // 256MiB forward buffer absorbs debrid latency spikes on 4K HEVC/AV1
        // (~40-80 Mbit/s fills 150MiB in ~15-30s); 50MiB back-buffer = instant
        // backward seek within the recent window.
        ("demuxer-max-bytes", "256MiB"),
        ("demuxer-max-back-bytes", "50MiB"),
        ("cache-secs", "60"),
        ("demuxer-readahead-secs", "20"),
        // Wait for the initial buffer before starting instead of starting then
        // immediately stalling on a cold debrid cache.
        ("cache-pause-initial", "yes"),
        // Only re-wake the network once the cache drains ~10s below full, instead
        // of on every tiny dip - steadier throughput, fewer stalls.
        ("demuxer-hysteresis-secs", "10"),
        ("hls-bitrate", "max"),
        // Subtitles (libass; per-style props are driven live by the app UI).
        ("sub-auto", "fuzzy"),
        // `yes` (mpv 0.41 renamed the old `scale`): scale ASS to the window but
        // RESPECT the track's positioning/styling so signs, karaoke and
        // top-positioned lines aren't mangled. (`force` was removed in 0.38.)
        ("sub-ass-override", "yes"),
        // Audio.
        ("gapless-audio", "weak"),
        // Normalize surround→stereo downmix so loud 5.1/7.1 scenes don't clip on
        // Mac laptop/desktop speakers (default is off).
        ("audio-normalize-downmix", "yes"),
    ];
    #[cfg(target_os = "macos")]
    {
        o.push(("vo", "libmpv")); // render API requires vo=libmpv
        // ZERO-COPY VideoToolbox: the IOSurface stays on the GPU and is sampled
        // directly by mpv's GL renderer (no GPU→CPU→GPU round-trip) - ~2x the
        // throughput and a fraction of the memory of copy mode on 4K HEVC/AV1
        // 10-bit, with no green/black-frame issues under this OpenGL render path.
        // hwdec is single-sourced HERE (the webview no longer overrides it).
        // Software decode remains the automatic fallback if VT can't handle a codec.
        o.push(("hwdec", "videotoolbox"));
        o.push(("ao", "coreaudio"));
    }
    #[cfg(target_os = "linux")]
    {
        // wid-embed: mpv owns a native GL vo inside the X11 child window. `gpu`
        // (not `gpu-next`) is used for broad libmpv-version compat; gpu-context
        // auto picks x11egl/x11 and honours the quality options above.
        o.push(("vo", "gpu"));
        o.push(("gpu-context", "auto"));
        // Copy-mode vaapi/nvdec, SW fallback - can't break playback.
        o.push(("hwdec", "auto-copy"));
        o.push(("ao", "pipewire,pulse,alsa"));
    }
    #[cfg(target_os = "windows")]
    {
        o.push(("vo", "gpu-next")); // wid-embed: mpv owns its native vo
        o.push(("gpu-api", "d3d11"));
        o.push(("gpu-context", "d3d11"));
        o.push(("hwdec", "d3d11va"));
        o.push(("ao", "wasapi"));
    }
    o
}

/// What a surface contributes BEFORE mpv is initialized. The wid-embed surfaces
/// (Windows HWND, Linux X11 XID) pass `wid` as a pre-init option (mpv's `wid` is
/// init-only); the macOS render-API surface needs nothing pre-init and returns an
/// empty `PreInit`. The opaque `handle` (the native window id as a usize) is
/// handed back to `surface_attach`.
pub struct PreInit {
    pub options: Vec<(String, String)>,
    pub handle: usize,
}

/// Windows: `libmpv-2.dll` is DELAY-LOADED (build.rs) and ships in `resources/lib`,
/// NOT next to the exe - so the loader can't find it on its own. Load it by full
/// path here, ONCE, BEFORE any mpv FFI call. This is critical for safety: if the
/// DLL is absent, letting mpv be touched would trip the delay-load helper's
/// unhandled SEH exception and CRASH the process (an SEH, not a catchable Rust
/// error). By loading + checking first we instead return a normal `Err`, so the
/// webview shows the error card + the external-player fallback. Mirrors the macOS
/// dlopen preload. No-op success on non-Windows.
#[cfg(target_os = "windows")]
fn ensure_libmpv_loaded<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::System::LibraryLoader::{
        LoadLibraryExW, LOAD_WITH_ALTERED_SEARCH_PATH,
    };
    static LOADED: OnceLock<bool> = OnceLock::new();
    let ok = *LOADED.get_or_init(|| {
        let Ok(dir) = app.path().resource_dir() else {
            return false;
        };
        let dll = dir.join("lib").join("libmpv-2.dll");
        let wide: Vec<u16> = dll
            .as_os_str()
            .encode_wide()
            .chain(std::iter::once(0))
            .collect();
        // LOAD_WITH_ALTERED_SEARCH_PATH also resolves the DLL's own deps from its
        // dir. A non-null handle means every export is now resolvable, so the
        // delay-load stubs bind on first use.
        let h =
            unsafe { LoadLibraryExW(wide.as_ptr(), std::ptr::null_mut(), LOAD_WITH_ALTERED_SEARCH_PATH) };
        !h.is_null()
    });
    if ok {
        Ok(())
    } else {
        Err("the in-window player is unavailable: bundled libmpv-2.dll could not be loaded".into())
    }
}

// ---- Player creation (mpv + surface + event thread; NO loadfile) ---------
pub fn create_player<R: Runtime>(
    app: AppHandle<R>,
    options: HashMap<String, String>,
    observed: Vec<ObserveSpec>,
) -> Result<(), String> {
    // Windows: guarantee libmpv is loaded before any mpv FFI, or bail cleanly
    // (never crash via the delay-load SEH). No-op elsewhere.
    #[cfg(target_os = "windows")]
    ensure_libmpv_loaded(&app)?;

    let state = app.state::<PlayerState>();
    {
        let mut guard = state.0.lock().map_err(|_| "player state poisoned")?;
        if let Some(mut old) = guard.take() {
            old.shutdown();
        }
    }

    // Phase 1: let the surface create any native handle it needs before mpv
    // (Windows: the child HWND) and contribute pre-init mpv options (Windows: wid).
    let pre = super::surface_pre_init(&app)?;

    let mpv = Mpv::with_initializer(|init| {
        // Best-in-class defaults first, then the surface's pre-init options, then
        // user options override - except `vo`/`hwdec` (Rust-owned on every
        // platform) and the forced safety options below.
        for (k, v) in best_in_class_options() {
            if let Err(e) = init.set_option(k, v) {
                rp_log(&format!("create_player: default {k}={v} ERR {e}"));
            }
        }
        // Apply the renderer-owned safety options next, macOS ONLY: they defend
        // against the LuaJIT Hardened Runtime crash (see FORCED_MPV_OPTIONS),
        // which is macOS-specific, and two of the switches (load-console,
        // load-commands) only exist on mpv >= 0.40 - an older Linux system libmpv
        // must not fail player creation over an unknown option. Non-fatal: an
        // option the local mpv rejects is logged and skipped, like the defaults.
        #[cfg(target_os = "macos")]
        for &(name, value) in FORCED_MPV_OPTIONS {
            if let Err(e) = init.set_option(name, value) {
                rp_log(&format!("create_player: forced {name}={value} ERR {e}"));
            }
        }
        for (k, v) in &pre.options {
            if let Err(e) = init.set_option(k.as_str(), v.as_str()) {
                rp_log(&format!("create_player: pre-init {k}={v} ERR {e}"));
            }
        }
        for (k, v) in &options {
            // vo and hwdec are Rust-owned on EVERY platform (single-sourced
            // per-OS in `best_in_class_options`); a frontend value must not
            // override either - vo=libmpv is a render-API mandate on macOS, and
            // hwdec is a stability/perf decision the webview no longer makes.
            if k == "vo" || k == "hwdec" {
                continue;
            }
            // Never let a frontend value re-enable a renderer-owned safety option.
            if is_forced_mpv_option(k) {
                continue;
            }
            if let Err(e) = init.set_option(k.as_str(), v.as_str()) {
                rp_log(&format!("create_player: set_option {k}={v} ERR {e}"));
            }
        }
        Ok(())
    })
    .map_err(|e| format!("mpv init failed: {e}"))?;
    let mpv = Arc::new(mpv);
    rp_log("create_player: mpv created");

    // Phase 2: bind mpv to the native surface (macOS creates the render-context
    // surface; Windows/Linux wrap the already-wid'd native window). The
    // cfg-selected `surface_pre_init`/`surface_attach` live in the active surface.
    let surface = super::surface_attach(&app, mpv.clone(), pre.handle)?;

    let event_stop = Arc::new(AtomicBool::new(false));
    let event_thread = Some(spawn_event_thread(
        app.clone(),
        mpv.clone(),
        observed,
        event_stop.clone(),
        surface.clone(),
    ));

    let mut guard = state.0.lock().map_err(|_| "player state poisoned")?;
    *guard = Some(Player {
        mpv,
        surface,
        event_stop,
        event_thread,
    });
    rp_log("create_player: ready");
    rp_log("RPGEO event=player-ready engine=native-mpv");
    Ok(())
}

fn with_player<T>(
    state: &State<'_, PlayerState>,
    f: impl FnOnce(&Player) -> Result<T, String>,
) -> Result<T, String> {
    let guard = state.0.lock().map_err(|_| "player state poisoned")?;
    let p = guard.as_ref().ok_or("no player running")?;
    f(p)
}

// ---- Tauri commands ------------------------------------------------------

/// Create the player (mpv + surface + event thread). Loading a file is a separate
/// `player_command("loadfile", [url])`.
///
/// MUST be `async`: on macOS `create_player` blocks on a channel while the AppKit
/// surface is built on the main thread (via Tauri's native-webview callback). A
/// SYNC Tauri command runs ON the main thread, which would deadlock. Async commands
/// run off the main thread.
#[tauri::command]
pub async fn player_init<R: Runtime>(
    app: AppHandle<R>,
    options: HashMap<String, String>,
    observed: Vec<ObserveSpec>,
) -> Result<(), String> {
    create_player(app, options, observed)
}

/// Convenience: create with defaults + load a URL.
#[tauri::command]
pub async fn player_load<R: Runtime>(
    app: AppHandle<R>,
    _window: Window<R>,
    url: String,
) -> Result<(), String> {
    create_player(app.clone(), HashMap::new(), Vec::new())?;
    let state = app.state::<PlayerState>();
    with_player(&state, |p| {
        rp_log("RPGEO event=loadfile-command engine=native-mpv path=player_load");
        p.mpv
            .command("loadfile", &[&url])
            .map_err(|e| format!("loadfile failed: {e}"))
    })
}

#[tauri::command]
pub fn player_command(state: State<'_, PlayerState>, args: Vec<String>) -> Result<(), String> {
    with_player(&state, |p| {
        let (name, rest) = args.split_first().ok_or("empty command")?;
        let rest_refs: Vec<&str> = rest.iter().map(|s| s.as_str()).collect();
        if name == "loadfile" {
            // Do not include the URL: debrid links commonly contain credentials.
            rp_log("RPGEO event=loadfile-command engine=native-mpv path=player_command");
        }
        let r = p
            .mpv
            .command(name, &rest_refs)
            .map_err(|e| format!("mpv command failed: {e}"));
        if name == "loadfile" {
            rp_log(&format!("cmd loadfile [url redacted] -> {r:?}"));
        } else {
            rp_log(&format!("cmd {name} {rest:?} -> {r:?}"));
        }
        r
    })
}

#[tauri::command]
pub fn player_set_property(
    state: State<'_, PlayerState>,
    name: String,
    value: String,
) -> Result<(), String> {
    with_player(&state, |p| {
        let r = p
            .mpv
            .set_property(&name, value.as_str())
            .map_err(|e| format!("set_property failed: {e}"));
        rp_log(&format!("set {name}={value} -> {r:?}"));
        r
    })
}

/// Get a property as JSON. `track-list`/`chapter-list` are assembled from mpv
/// sub-properties (avoids raw mpv_node FFI); everything else returns a string.
#[tauri::command]
pub fn player_get_property(state: State<'_, PlayerState>, name: String) -> Result<Value, String> {
    with_player(&state, |p| match name.as_str() {
        "track-list" => Ok(build_track_list(&p.mpv)),
        "chapter-list" => Ok(build_chapter_list(&p.mpv)),
        _ => Ok(json!(p.mpv.get_property::<String>(&name).unwrap_or_default())),
    })
}

/// Reserve a fraction of the bottom of the video for the control bar so the
/// controls never cover the picture (mpv `video-margin-ratio-bottom`).
#[tauri::command]
pub fn player_set_video_margin(state: State<'_, PlayerState>, bottom: f64) -> Result<(), String> {
    with_player(&state, |p| {
        let r = p
            .mpv
            .set_property("video-margin-ratio-bottom", bottom)
            .map_err(|e| format!("set video margin failed: {e}"));
        rp_log(&format!("video-margin {bottom} -> {r:?}"));
        r
    })
}

/// Sync the native video rect to the app layout (backing px). No-op on OSes whose
/// surface autoresizes with the window; used on Windows for the child HWND.
#[tauri::command]
pub fn player_set_rect(
    state: State<'_, PlayerState>,
    x: i32,
    y: i32,
    width: i32,
    height: i32,
) -> Result<(), String> {
    with_player(&state, |p| {
        p.surface.set_rect(x, y, width, height);
        Ok(())
    })
}

#[tauri::command]
pub async fn player_destroy<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    let state = app.state::<PlayerState>();
    let taken = {
        let mut guard = state.0.lock().map_err(|_| "player state poisoned")?;
        guard.take()
    };
    if let Some(mut p) = taken {
        p.shutdown();
    }
    Ok(())
}

fn build_track_list(mpv: &Mpv) -> Value {
    let count = mpv.get_property::<i64>("track-list/count").unwrap_or(0);
    let mut arr = Vec::new();
    for i in 0..count {
        let s = |p: &str| mpv.get_property::<String>(&format!("track-list/{i}/{p}")).ok();
        let b = |p: &str| {
            mpv.get_property::<bool>(&format!("track-list/{i}/{p}"))
                .unwrap_or(false)
        };
        arr.push(json!({
            "id": mpv.get_property::<i64>(&format!("track-list/{i}/id")).ok(),
            "type": s("type"),
            "title": s("title"),
            "lang": s("lang"),
            "selected": b("selected"),
            "codec": s("codec"),
            "external": b("external"),
        }));
    }
    Value::Array(arr)
}

fn build_chapter_list(mpv: &Mpv) -> Value {
    let count = mpv.get_property::<i64>("chapter-list/count").unwrap_or(0);
    let mut arr = Vec::new();
    for i in 0..count {
        arr.push(json!({
            "title": mpv.get_property::<String>(&format!("chapter-list/{i}/title")).unwrap_or_default(),
            "time": mpv.get_property::<f64>(&format!("chapter-list/{i}/time")).unwrap_or(0.0),
        }));
    }
    Value::Array(arr)
}

#[cfg(test)]
mod tests {
    use super::best_in_class_options;
    use super::is_forced_mpv_option;
    use std::collections::HashMap;

    /// A frontend option must never be able to re-enable the renderer-owned safety
    /// switches that keep mpv's built-in Lua scripts (LuaJIT) from loading.
    #[test]
    fn frontend_cannot_override_native_player_safety_options() {
        for &(name, _) in super::FORCED_MPV_OPTIONS {
            assert!(is_forced_mpv_option(name), "{name} must stay forced");
        }
        assert!(!is_forced_mpv_option("cache"));
    }

    /// The best-in-class defaults are stable + platform-correct. Pure/headless - 
    /// no GPU, no mpv instance - so it runs on every CI runner.
    #[test]
    fn best_in_class_options_are_quality_and_platform_correct() {
        let opts = best_in_class_options();
        let map: HashMap<&str, &str> = opts.iter().cloned().collect();
        // No duplicate keys (a later override would silently win).
        assert_eq!(map.len(), opts.len(), "duplicate option keys: {opts:?}");

        // Cross-platform quality baseline.
        assert_eq!(map.get("keepaspect"), Some(&"yes"));
        assert_eq!(map.get("scale"), Some(&"ewa_lanczossharp"));
        assert_eq!(map.get("cscale"), Some(&"ewa_lanczossharp"));
        assert_eq!(map.get("deband"), Some(&"yes"));
        assert_eq!(map.get("dither"), Some(&"error-diffusion"));
        assert_eq!(map.get("cache"), Some(&"yes"));
        assert_eq!(map.get("demuxer-max-back-bytes"), Some(&"50MiB"));
        assert_eq!(map.get("sub-ass-override"), Some(&"yes"));
        assert_eq!(map.get("audio-normalize-downmix"), Some(&"yes"));
        assert_eq!(map.get("cache-pause-initial"), Some(&"yes"));
        assert!(map.contains_key("hwdec"), "hwdec must be set on every platform");

        // Per-platform decode + output.
        #[cfg(target_os = "macos")]
        {
            assert_eq!(map.get("vo"), Some(&"libmpv")); // render API mandate
            assert_eq!(map.get("hwdec"), Some(&"videotoolbox")); // zero-copy VT
            assert_eq!(map.get("ao"), Some(&"coreaudio"));
        }
        #[cfg(target_os = "linux")]
        {
            assert_eq!(map.get("vo"), Some(&"gpu")); // wid-embed native vo
            assert_eq!(map.get("gpu-context"), Some(&"auto"));
            assert_eq!(map.get("hwdec"), Some(&"auto-copy"));
        }
        #[cfg(target_os = "windows")]
        {
            assert_eq!(map.get("vo"), Some(&"gpu-next")); // wid-embed native
            assert_eq!(map.get("hwdec"), Some(&"d3d11va"));
            assert_eq!(map.get("gpu-api"), Some(&"d3d11"));
        }
    }
}
