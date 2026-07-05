// Shared, PLATFORM-AGNOSTIC core of the in-window mpv player.
//
// Everything here is free of `#[cfg]` and identical on every OS: the mpv handle,
// the event loop that forwards property changes to the webview, property/command
// marshalling, the Tauri command surface, and the `VideoSurface` trait that is the
// ONLY platform-specific seam. Each OS provides a `surface_*.rs` that implements
// `VideoSurface` + an `attach_surface()` constructor; `mod.rs` selects one by cfg.
//
// The mpv lifecycle logic was lifted verbatim from the original macOS-only
// `render_player.rs` — see `surface_macos.rs` for the macOS render surface.

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
pub(crate) fn rp_log(msg: &str) {
    use std::io::Write;
    static ON: OnceLock<bool> = OnceLock::new();
    if !*ON.get_or_init(|| std::env::var_os("DS_MPV_DEBUG").is_some()) {
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
/// (macOS: CAOpenGLLayer render API; Linux: GtkGLArea render API; Windows: a
/// wid-embedded child HWND) and composites it with the app window. The mpv handle
/// is shared; a render-API surface binds an `mpv_render_context` to it, while a
/// wid surface just hands mpv a native window handle.
///
/// Object-safe (no `attach` here); construction is the cfg-selected free function
/// `attach_surface()`, so `Player` can hold a `Box<dyn VideoSurface>`.
pub trait VideoSurface: Send {
    /// Keep the video rect synced to the app layout, in BACKING pixels. A no-op
    /// where the OS autoresizes the surface with the window (macOS/Linux fill the
    /// window); used by Windows to `SetWindowPos` the child HWND to the DOM rect.
    fn set_rect(&self, x: i32, y: i32, w: i32, h: i32);

    /// ORDERED teardown — the single most bug-prone invariant. Each surface MUST:
    /// stop its redraws, free any `mpv_render_context` (or DestroyWindow) BEFORE
    /// the shared `Arc<Mpv>` drops and destroys mpv (freeing a render context after
    /// mpv is destroyed is a use-after-free = the historical "back button crash"),
    /// and detach the native view on the UI thread. Must be idempotent.
    fn detach(&self);
}

/// A live in-window player: shared mpv + a platform surface + the event thread.
pub struct Player {
    pub(crate) mpv: Arc<Mpv>,
    surface: Box<dyn VideoSurface>,
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
    observed: Vec<ObserveSpec>,
    stop: Arc<AtomicBool>,
) -> JoinHandle<()> {
    std::thread::spawn(move || {
        let client = match mpv.create_client(Some("dsevents")) {
            Ok(c) => c,
            Err(e) => {
                rp_log(&format!("event thread: create_client failed: {e}"));
                return;
            }
        };
        for (i, spec) in observed.iter().enumerate() {
            let fmt = match spec.format.as_str() {
                "flag" => Format::Flag,
                "double" => Format::Double,
                "int64" => Format::Int64,
                _ => Format::String,
            };
            let _ = client.observe_property(&spec.name, fmt, i as u64);
        }
        let ctx = client.ctx.as_ptr();
        while !stop.load(Ordering::Acquire) {
            let ev = unsafe { &*libmpv2_sys::mpv_wait_event(ctx, 0.25) };
            match ev.event_id {
                libmpv2_sys::mpv_event_id_MPV_EVENT_NONE => {}
                libmpv2_sys::mpv_event_id_MPV_EVENT_SHUTDOWN => break,
                libmpv2_sys::mpv_event_id_MPV_EVENT_END_FILE => {
                    let ef = unsafe { &*(ev.data as *mut libmpv2_sys::mpv_event_end_file) };
                    rp_log(&format!(
                        "event thread: END_FILE reason={} error={}",
                        ef.reason, ef.error
                    ));
                }
                libmpv2_sys::mpv_event_id_MPV_EVENT_PROPERTY_CHANGE => {
                    let prop = unsafe { &*(ev.data as *mut libmpv2_sys::mpv_event_property) };
                    let name = unsafe { CStr::from_ptr(prop.name) }
                        .to_string_lossy()
                        .into_owned();
                    let data = unsafe { prop_data_to_json(prop.format, prop.data) };
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

/// Best-in-class mpv options applied to EVERY player before user overrides —
/// the same engine mpv/IINA use, tuned for high-quality scaling, debanding,
/// hardware decode, and streaming-cache "debrid feel". Per-platform decode +
/// output are selected by `cfg!(target_os)`:
///   * macOS/Linux use the OpenGL render API → `vo=libmpv` is MANDATORY; the
///     quality options below still tune the gpu renderer the render API drives.
///     (gpu-next-as-a-vo does not apply under the render API — see the memory.)
///   * Windows wid-embeds mpv → it owns a native `vo=gpu-next` + d3d11.
/// hwdec is `auto-safe` on render-API platforms: it uses hardware decode when it
/// works and falls back to software automatically, so it can't break playback.
pub(crate) fn best_in_class_options() -> Vec<(&'static str, &'static str)> {
    let mut o = vec![
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
        // Streaming cache — the debrid-feel levers (instant seek both directions).
        ("cache", "yes"),
        ("demuxer-max-bytes", "150MiB"),
        ("demuxer-max-back-bytes", "50MiB"),
        ("cache-secs", "60"),
        ("demuxer-readahead-secs", "20"),
        ("hls-bitrate", "max"),
        // Subtitles (libass; per-style props are driven live by the app UI).
        ("sub-auto", "fuzzy"),
        ("sub-ass-override", "force"),
        // Audio.
        ("gapless-audio", "weak"),
    ];
    #[cfg(target_os = "macos")]
    {
        o.push(("vo", "libmpv")); // render API requires vo=libmpv
        o.push(("hwdec", "auto-safe")); // videotoolbox w/ safe SW fallback
        o.push(("ao", "coreaudio"));
    }
    #[cfg(target_os = "linux")]
    {
        o.push(("vo", "libmpv")); // render API (GtkGLArea)
        o.push(("hwdec", "auto-safe")); // vaapi/nvdec w/ safe SW fallback
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

// ---- Player creation (mpv + surface + event thread; NO loadfile) ---------
pub fn create_player<R: Runtime>(
    app: AppHandle<R>,
    options: HashMap<String, String>,
    observed: Vec<ObserveSpec>,
) -> Result<(), String> {
    let state = app.state::<PlayerState>();
    {
        let mut guard = state.0.lock().map_err(|_| "player state poisoned")?;
        if let Some(mut old) = guard.take() {
            old.shutdown();
        }
    }

    let mpv = Mpv::with_initializer(|init| {
        // Best-in-class defaults first, then user options override them — except
        // `vo` on the render-API platforms (macOS/Linux), which MUST stay libmpv
        // or the render context can't bind to mpv.
        for (k, v) in best_in_class_options() {
            if let Err(e) = init.set_option(k, v) {
                rp_log(&format!("create_player: default {k}={v} ERR {e}"));
            }
        }
        for (k, v) in &options {
            #[cfg(any(target_os = "macos", target_os = "linux"))]
            if k == "vo" {
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

    // Platform surface: creates the native video surface + binds it to mpv. The
    // cfg-selected `attach_surface` lives in the active `surface_*.rs`.
    let surface = super::attach_surface(&app, mpv.clone())?;

    let event_stop = Arc::new(AtomicBool::new(false));
    let event_thread = Some(spawn_event_thread(
        app.clone(),
        mpv.clone(),
        observed,
        event_stop.clone(),
    ));

    let mut guard = state.0.lock().map_err(|_| "player state poisoned")?;
    *guard = Some(Player {
        mpv,
        surface,
        event_stop,
        event_thread,
    });
    rp_log("create_player: ready");
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
/// surface is built on the main thread (via GCD). A SYNC Tauri command runs ON the
/// main thread, which would deadlock. Async commands run off the main thread.
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
        let r = p
            .mpv
            .command(name, &rest_refs)
            .map_err(|e| format!("mpv command failed: {e}"));
        rp_log(&format!("cmd {name} {rest:?} -> {r:?}"));
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
    use std::collections::HashMap;

    /// The best-in-class defaults are stable + platform-correct. Pure/headless —
    /// no GPU, no mpv instance — so it runs on every CI runner.
    #[test]
    fn best_in_class_options_are_quality_and_platform_correct() {
        let opts = best_in_class_options();
        let map: HashMap<&str, &str> = opts.iter().cloned().collect();
        // No duplicate keys (a later override would silently win).
        assert_eq!(map.len(), opts.len(), "duplicate option keys: {opts:?}");

        // Cross-platform quality baseline.
        assert_eq!(map.get("scale"), Some(&"ewa_lanczossharp"));
        assert_eq!(map.get("cscale"), Some(&"ewa_lanczossharp"));
        assert_eq!(map.get("deband"), Some(&"yes"));
        assert_eq!(map.get("dither"), Some(&"error-diffusion"));
        assert_eq!(map.get("cache"), Some(&"yes"));
        assert_eq!(map.get("demuxer-max-back-bytes"), Some(&"50MiB"));
        assert_eq!(map.get("sub-ass-override"), Some(&"force"));
        assert!(map.contains_key("hwdec"), "hwdec must be set on every platform");

        // Per-platform decode + output.
        #[cfg(target_os = "macos")]
        {
            assert_eq!(map.get("vo"), Some(&"libmpv")); // render API mandate
            assert_eq!(map.get("hwdec"), Some(&"auto-safe"));
            assert_eq!(map.get("ao"), Some(&"coreaudio"));
        }
        #[cfg(target_os = "linux")]
        {
            assert_eq!(map.get("vo"), Some(&"libmpv")); // render API mandate
            assert_eq!(map.get("hwdec"), Some(&"auto-safe"));
        }
        #[cfg(target_os = "windows")]
        {
            assert_eq!(map.get("vo"), Some(&"gpu-next")); // wid-embed native
            assert_eq!(map.get("hwdec"), Some(&"d3d11va"));
            assert_eq!(map.get("gpu-api"), Some(&"d3d11"));
        }
    }
}
