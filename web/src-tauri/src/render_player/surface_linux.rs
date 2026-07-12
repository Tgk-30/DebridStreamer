// Linux video surface: mpv X11 wid-embedding.
//
// We hand mpv the Tauri window's X11 window id as `wid` (an init-only option - set
// in surface_pre_init, applied inside Mpv::with_initializer). mpv then creates its
// own render child window inside it and renders NATIVELY (vo=gpu + gpu-context=auto
// picks x11egl/x11, hwdec=auto-copy engages vaapi/nvdec copy - see
// core::best_in_class_options). This mirrors the Windows wid-embed and is the
// battle-tested way mpv embeds into GTK/Qt hosts; it needs no `gtk`/`x11` crate:
// raw-window-handle (already a dependency) yields the XID.
//
// SESSION CAVEAT (verified by a human on real hardware): mpv `wid` embedding is an
// X11 mechanism. Under a native Wayland session Tauri hands back a Wayland handle,
// not an XID - so surface_pre_init returns an error and the app falls back to the
// external player. Running the app under XWayland (GDK_BACKEND=x11) makes the
// in-window player available on Wayland desktops too.
//
// COMPOSITING CAVEAT (same as Windows): WebKitGTK hosts its web content in its own
// native surface, so a transparent WebKitGTK does not reveal video behind it
// (X11 airspace rule). The web UI FRAMES the video region rather than glassing over
// full-frame video. True video-behind-glass would need a GtkGLArea render-API
// surface sharing WebKitGTK's GL context - a later refinement (v0.6 Phase 3b).

use std::sync::Arc;

use libmpv2::Mpv;
use raw_window_handle::{HasWindowHandle, RawWindowHandle};
use tauri::{AppHandle, Manager, Runtime};

use super::core::{rp_log, PreInit, VideoSurface};

/// Read the Tauri window's X11 window id (as an i64) to use as mpv's `wid`.
/// Returns a clear error under a native Wayland session (no XID available).
fn window_wid<R: Runtime>(app: &AppHandle<R>) -> Result<i64, String> {
    let window = app
        .webview_windows()
        .into_values()
        .next()
        .ok_or("no app window for the video surface")?;
    let handle = window
        .window_handle()
        .map_err(|e| format!("window handle: {e}"))?;
    match handle.as_raw() {
        RawWindowHandle::Xlib(h) => Ok(h.window as i64),
        RawWindowHandle::Xcb(h) => Ok(h.window.get() as i64),
        RawWindowHandle::Wayland(_) => Err(
            "the in-window player needs an X11 session; run under XWayland \
             (GDK_BACKEND=x11) or use the external player on Wayland"
                .into(),
        ),
        other => Err(format!("unsupported Linux window handle: {other:?}")),
    }
}

/// Linux: contribute `wid` = the window's X11 XID before mpv_initialize. mpv makes
/// + owns the render child window itself, so there is no post-init surface to bind.
pub fn surface_pre_init<R: Runtime>(app: &AppHandle<R>) -> Result<PreInit, String> {
    let wid = window_wid(app)?;
    rp_log(&format!("surface_pre_init(linux): wid={wid}"));
    Ok(PreInit {
        options: vec![("wid".to_string(), wid.to_string())],
        handle: wid as usize,
    })
}

pub fn surface_attach<R: Runtime>(
    _app: &AppHandle<R>,
    _mpv: Arc<Mpv>,
    handle: usize,
) -> Result<Arc<dyn VideoSurface>, String> {
    // mpv owns the rendering into its own child of the wid window; nothing to bind.
    Ok(Arc::new(LinuxSurface { _wid: handle }))
}

struct LinuxSurface {
    _wid: usize,
}

// mpv owns the native window; the surface holds only an integer handle.
unsafe impl Send for LinuxSurface {}

impl VideoSurface for LinuxSurface {
    fn set_rect(&self, _x: i32, _y: i32, _w: i32, _h: i32) {
        // mpv fills the wid window with its render child. DOM-rect-driven sizing
        // (an XConfigureWindow / dedicated child window) is a later refinement,
        // shared with the Windows surface, once the compositing model is confirmed
        // on real Linux hardware.
    }

    fn detach(&self) {
        // mpv destroys its own render child when the shared Arc<Mpv> drops
        // (Player::shutdown stops the event thread first, then mpv drops). Unlike
        // the render-API surfaces there is no render context to free before mpv.
    }
}
