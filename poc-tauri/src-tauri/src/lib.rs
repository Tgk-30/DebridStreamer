// DebridStreamer - Tauri player POC.
//
// Proves the two-backend player plan from COMPETITION_AND_ARCHITECTURE.md:
//   1. In-webview playback (hls.js / native <video>) for HLS/MP4 - the browser path.
//   2. Desktop hand-off to a native player (VLC/mpv) for MKV/HEVC the webview can't decode.
// This command is the desktop direct-play seam: hand a Real-Debrid direct link to a
// native player. On macOS we try VLC, then mpv/IINA as fallbacks.

use std::process::Command;

#[tauri::command]
fn open_in_external_player(url: String) -> Result<String, String> {
    // The URL comes from the webview; only ever hand a remote-stream URL to an OS
    // process launcher. Allowlist http/https so a compromised/unexpected webview
    // can't pass file:, javascript:, or an app-scheme URL through to `open`.
    if !(url.starts_with("http://") || url.starts_with("https://")) {
        return Err("Only http(s) stream URLs can be opened in an external player.".into());
    }

    // Preference order: VLC (installed here, matches the current VLCKit player), then mpv, then IINA.
    #[cfg(target_os = "macos")]
    {
        let candidates = ["VLC", "mpv", "IINA"];
        for app in candidates {
            let status = Command::new("open")
                .args(["-a", app, &url])
                .status();
            if let Ok(s) = status {
                if s.success() {
                    return Ok(format!("Opened in {app}"));
                }
            }
        }
        // Last resort: hand the URL to the OS default handler.
        Command::new("open")
            .arg(&url)
            .spawn()
            .map_err(|e| e.to_string())?;
        return Ok("Opened with the system default handler".into());
    }

    #[cfg(not(target_os = "macos"))]
    {
        // Cross-platform: try mpv on PATH, else VLC.
        for bin in ["mpv", "vlc"] {
            if Command::new(bin).arg(&url).spawn().is_ok() {
                return Ok(format!("Opened in {bin}"));
            }
        }
        Err("No external player (mpv/vlc) found on PATH".into())
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![open_in_external_player])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
