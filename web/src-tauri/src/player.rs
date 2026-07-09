// Bundled-mpv player (Phase 3 P1).
//
// Spawns an mpv *sidecar* (via `app.shell().sidecar("mpv")`) and drives it over
// mpv's JSON IPC (a unix domain socket via `--input-ipc-server`). This is the
// lossless / non-Real-Debrid MKV path: instead of handing the URL to a user-
// installed VLC, we control mpv ourselves (play / pause / seek / position / stop).
//
// NOTE: the `externalBin` entry that would bundle the mpv binary was removed so
// the cross-platform release matrix can package without the (gitignored,
// un-provisioned) per-triple binaries - `sidecar("mpv")` therefore returns a
// clean "not bundled" error at runtime until provisioning + the shell capability
// + `--wid` embedding are verified end-to-end (a tracked deferred item). The
// in-webview HLS player remains the reliable cross-platform path regardless.
//
// === In-window embedding (`--wid`) - the known-risky part, READ THIS ===
//
// We ATTEMPT true in-window embedding by passing mpv `--wid=<NSView pointer>`
// obtained from the Tauri window via `raw-window-handle` (the `AppKitWindowHandle`
// `ns_view`). On macOS this is unreliable: mpv's macOS video backends
// (libmpv/cocoa-cb) historically do not honor `--wid` the way the X11/Windows
// backends do, and tend to spawn mpv's *own* window regardless. We therefore:
//   1. Try `--wid` when we can read the NSView pointer (best-effort embedding), but
//   2. ALWAYS pass `--force-window=yes` so that if `--wid` is ignored, mpv still
//      opens its own window and plays - fully app-controlled over IPC.
// The caller is told which path was taken via the returned `embedded` flag, and
// this is documented honestly in the handoff: on macOS, expect mpv's own window.
//
// We cannot runtime-test actual video here (no display control in this env); the
// goal for P1 is COMPILING + WIRED. See the task report for verified-vs-unverified.

use std::path::PathBuf;
use std::sync::Mutex;

use serde_json::Value;
use tauri::{AppHandle, Manager, Runtime, State, Window};
use tauri_plugin_shell::process::CommandChild;
use tauri_plugin_shell::ShellExt;

/// A running mpv instance plus the IPC socket used to control it.
pub struct MpvInstance {
    /// The spawned sidecar child. Killed on `stop` / replace.
    child: CommandChild,
    /// Path to the `--input-ipc-server` unix socket.
    ipc_path: PathBuf,
    /// Whether we asked mpv to embed in the app window (`--wid`). On macOS this
    /// is best-effort and usually falls back to mpv's own window (see module doc).
    /// Retained on the instance for state/debugging; the live flag returned to the
    /// frontend is `MpvPlayResult.embedded` at spawn time.
    #[allow(dead_code)]
    embedded: bool,
}

/// Tauri-managed player state: at most one mpv at a time.
#[derive(Default)]
pub struct MpvState(pub Mutex<Option<MpvInstance>>);

/// What `mpv_play` reports back to the frontend.
#[derive(serde::Serialize)]
pub struct MpvPlayResult {
    /// True iff we passed `--wid` to attempt in-window embedding. On macOS this
    /// does NOT guarantee the video actually rendered inside the app window - 
    /// mpv may still use its own window. The frontend should treat mpv playback
    /// as "handled" either way and not show the in-webview <video>.
    pub embedded: bool,
    /// Human-readable status for display/logging.
    pub status: String,
}

impl MpvState {
    /// Kill any current mpv and clear the slot.
    fn kill_current(&self) {
        if let Ok(mut guard) = self.0.lock() {
            if let Some(inst) = guard.take() {
                let _ = inst.child.kill();
                let _ = std::fs::remove_file(&inst.ipc_path);
            }
        }
    }
}

/// Read the macOS `NSView` pointer for a Tauri window, for mpv `--wid`.
/// Returns `Some(addr)` on macOS when the AppKit handle is available, else None
/// (non-macOS, or the handle isn't an AppKit one). The address is mpv's expected
/// `--wid` value (the NSView object pointer as an integer).
#[cfg(target_os = "macos")]
fn ns_view_wid<R: Runtime>(window: &Window<R>) -> Option<usize> {
    use raw_window_handle::{HasWindowHandle, RawWindowHandle};
    let handle = window.window_handle().ok()?;
    match handle.as_raw() {
        RawWindowHandle::AppKit(h) => Some(h.ns_view.as_ptr() as usize),
        _ => None,
    }
}

#[cfg(not(target_os = "macos"))]
fn ns_view_wid<R: Runtime>(_window: &Window<R>) -> Option<usize> {
    None
}

/// Build the IPC socket path under the OS temp dir, unique per launch.
fn ipc_socket_path<R: Runtime>(app: &AppHandle<R>) -> PathBuf {
    // Prefer the app's temp dir; fall back to std::env::temp_dir.
    let base = app
        .path()
        .temp_dir()
        .unwrap_or_else(|_| std::env::temp_dir());
    let pid = std::process::id();
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    base.join(format!("debridstreamer-mpv-{pid}-{nanos}.sock"))
}

/// Spawn the bundled mpv sidecar for `url`, controlled over a fresh IPC socket.
///
/// Attempts in-window embedding via `--wid` (best-effort on macOS); always passes
/// `--force-window=yes` so mpv plays even if `--wid` is ignored. Replaces any
/// previously-playing mpv. Returns whether embedding was attempted + a status.
#[tauri::command]
pub fn mpv_play<R: Runtime>(
    app: AppHandle<R>,
    window: Window<R>,
    state: State<'_, MpvState>,
    url: String,
) -> Result<MpvPlayResult, String> {
    // One mpv at a time: tear down any previous instance first.
    state.kill_current();

    let ipc_path = ipc_socket_path(&app);
    // Stale socket from a crashed run would block bind; remove proactively.
    let _ = std::fs::remove_file(&ipc_path);

    let wid = ns_view_wid(&window);
    let embedded = wid.is_some();

    let sidecar = app
        .shell()
        .sidecar("mpv")
        .map_err(|e| format!("mpv sidecar not bundled: {e}"))?;

    let mut args: Vec<String> = vec![
        "--no-terminal".into(),
        // Play even if --wid is ignored (the macOS fallback to mpv's own window).
        "--force-window=yes".into(),
        // Keep the window up after EOF so the user can re-seek; closed via stop.
        "--idle=yes".into(),
        "--keep-open=yes".into(),
        format!("--input-ipc-server={}", ipc_path.display()),
    ];
    if let Some(w) = wid {
        // Best-effort in-window embedding. On macOS mpv may ignore this and use
        // its own window - that's the documented fallback, not an error.
        args.push(format!("--wid={w}"));
    }
    // The stream URL last (positional).
    args.push(url);

    let (_rx, child) = sidecar
        .args(args)
        .spawn()
        .map_err(|e| format!("failed to spawn mpv: {e}"))?;

    let status = if embedded {
        "mpv launched (attempted in-window embedding via --wid)".to_string()
    } else {
        "mpv launched in its own window".to_string()
    };

    if let Ok(mut guard) = state.0.lock() {
        *guard = Some(MpvInstance {
            child,
            ipc_path,
            embedded,
        });
    }

    Ok(MpvPlayResult { embedded, status })
}

/// Send a JSON-IPC command to the current mpv and (optionally) return its reply.
/// Connects to the unix socket fresh each call (mpv accepts many connections),
/// retrying briefly because the socket appears slightly after spawn.
///
/// mpv's `--input-ipc-server` is a unix domain socket on macOS/Linux and a named
/// pipe on Windows; only the unix-socket path is implemented. The Unix-specific
/// imports live INSIDE this `#[cfg(unix)]` body so the crate still compiles for
/// `windows-latest` in the release matrix - see the non-unix stub below.
#[cfg(unix)]
fn ipc_request(ipc_path: &PathBuf, command: &Value) -> Result<Value, String> {
    use std::io::{Read, Write};
    use std::os::unix::net::UnixStream;
    use std::time::{Duration, Instant};

    let deadline = Instant::now() + Duration::from_millis(2000);
    let mut stream = loop {
        match UnixStream::connect(ipc_path) {
            Ok(s) => break s,
            Err(e) => {
                if Instant::now() >= deadline {
                    return Err(format!("mpv IPC not reachable: {e}"));
                }
                std::thread::sleep(Duration::from_millis(50));
            }
        }
    };
    stream
        .set_read_timeout(Some(Duration::from_millis(1000)))
        .ok();

    let mut line = serde_json::to_vec(command).map_err(|e| e.to_string())?;
    line.push(b'\n');
    stream.write_all(&line).map_err(|e| e.to_string())?;
    stream.flush().map_err(|e| e.to_string())?;

    // Read one reply line. mpv replies with `{"error":"success","data":...}`.
    let mut buf = Vec::new();
    let mut byte = [0u8; 1];
    loop {
        match stream.read(&mut byte) {
            Ok(0) => break,
            Ok(_) => {
                if byte[0] == b'\n' {
                    break;
                }
                buf.push(byte[0]);
            }
            Err(_) => break,
        }
    }
    if buf.is_empty() {
        // Fire-and-forget commands (e.g. set_property) may not need a reply.
        return Ok(Value::Null);
    }
    serde_json::from_slice(&buf).map_err(|e| format!("bad mpv reply: {e}"))
}

/// Non-unix stub: mpv IPC uses a Windows named pipe rather than a unix socket,
/// which isn't implemented. The crate compiles + bundles on Windows; the bundled
/// mpv control path is simply unavailable there (the in-webview HLS player is the
/// cross-platform path). Implementing the named-pipe transport is a deferred item.
#[cfg(not(unix))]
fn ipc_request(_ipc_path: &PathBuf, _command: &Value) -> Result<Value, String> {
    Err("mpv IPC control is only supported on macOS and Linux".to_string())
}

/// Run an IPC command against the current instance, if any.
fn with_ipc(state: &State<'_, MpvState>, command: Value) -> Result<Value, String> {
    let guard = state.0.lock().map_err(|_| "player state poisoned")?;
    let inst = guard.as_ref().ok_or("no mpv instance running")?;
    let path = inst.ipc_path.clone();
    drop(guard);
    ipc_request(&path, &command)
}

/// Pause playback (`set_property pause true`).
#[tauri::command]
pub fn mpv_pause(state: State<'_, MpvState>) -> Result<(), String> {
    with_ipc(
        &state,
        serde_json::json!({ "command": ["set_property", "pause", true] }),
    )
    .map(|_| ())
}

/// Resume playback (`set_property pause false`).
#[tauri::command]
pub fn mpv_resume(state: State<'_, MpvState>) -> Result<(), String> {
    with_ipc(
        &state,
        serde_json::json!({ "command": ["set_property", "pause", false] }),
    )
    .map(|_| ())
}

/// Seek to an absolute position (seconds).
#[tauri::command]
pub fn mpv_seek(state: State<'_, MpvState>, seconds: f64) -> Result<(), String> {
    with_ipc(
        &state,
        serde_json::json!({ "command": ["seek", seconds, "absolute"] }),
    )
    .map(|_| ())
}

/// Get the current playback position in seconds (`get_property time-pos`).
/// Returns 0.0 if mpv hasn't reported a position yet.
#[tauri::command]
pub fn mpv_get_position(state: State<'_, MpvState>) -> Result<f64, String> {
    let reply = with_ipc(
        &state,
        serde_json::json!({ "command": ["get_property", "time-pos"] }),
    )?;
    Ok(reply
        .get("data")
        .and_then(|d| d.as_f64())
        .unwrap_or(0.0))
}

/// Stop playback and kill the mpv process.
#[tauri::command]
pub fn mpv_stop(state: State<'_, MpvState>) -> Result<(), String> {
    // Best-effort graceful quit over IPC, then ensure the process is gone.
    let _ = with_ipc(&state, serde_json::json!({ "command": ["quit"] }));
    state.kill_current();
    Ok(())
}
