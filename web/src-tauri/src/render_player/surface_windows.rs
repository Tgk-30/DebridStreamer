// Windows video surface: mpv wid-embedding.
//
// We hand mpv the Tauri window's own HWND as `wid` (an init-only option - set in
// surface_pre_init, applied inside Mpv::with_initializer). mpv then creates its
// own render child window inside it and renders NATIVELY (vo=gpu-next +
// gpu-context=d3d11 + hwdec=d3d11va - see core::best_in_class_options). This is
// the proven tauri-plugin-libmpv Windows approach and needs no `windows` crate:
// raw-window-handle (already a dependency) yields the HWND value.
//
// COMPOSITING CAVEAT (verify at runtime on Windows): Wry uses WebView2 *windowed*
// hosting, so a transparent WebView2 does NOT reveal video behind it (airspace
// rule). The web UI FRAMES the video region rather than glassing over full-frame
// video. True video-behind-glass would require WebView2 composition hosting +
// DirectComposition (forking Wry) - out of scope for v0.6.

use std::sync::Arc;

use libmpv2::Mpv;
use raw_window_handle::{HasWindowHandle, RawWindowHandle};
use tauri::{AppHandle, Manager, Runtime};

use super::core::{rp_log, PreInit, VideoSurface};

/// WebView2 uses a different surface/compositor model. The measured transparent
/// WKWebView tax and its opacity controls are macOS-only.
pub(crate) fn set_initial_webview_opaque<R: Runtime>(_app: &AppHandle<R>) -> Result<(), String> {
    Ok(())
}

/// Read the Tauri window's HWND (as an i64) to use as mpv's `wid`.
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
        RawWindowHandle::Win32(h) => Ok(h.hwnd.get() as i64),
        _ => Err("expected a Win32 window handle".into()),
    }
}

/// Windows: contribute `wid` = the window's HWND before mpv_initialize. mpv makes
/// + owns the render child window itself, so there is no post-init surface to bind.
pub fn surface_pre_init<R: Runtime>(app: &AppHandle<R>) -> Result<PreInit, String> {
    let wid = window_wid(app)?;
    rp_log(&format!("surface_pre_init(windows): wid={wid}"));
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
    Ok(Arc::new(WindowsSurface { _wid: handle }))
}

struct WindowsSurface {
    _wid: usize,
}

// mpv owns the native window; the surface holds only an integer handle.
unsafe impl Send for WindowsSurface {}

impl VideoSurface for WindowsSurface {
    fn set_rect(&self, _x: i32, _y: i32, _w: i32, _h: i32) {
        // mpv fills the wid window with its render child. DOM-rect-driven sizing
        // (SetWindowPos of a dedicated child) is a later refinement once the
        // compositing model is confirmed on real Windows hardware.
    }

    fn detach(&self) {
        // mpv destroys its own render child when the shared Arc<Mpv> drops
        // (Player::shutdown stops the event thread first, then mpv drops). Unlike
        // the render-API surfaces there is no render context to free before mpv.
    }
}
