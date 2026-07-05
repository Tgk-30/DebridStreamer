// DebridStreamer — Tauri player POC.
//
// Proves the two-backend player plan from COMPETITION_AND_ARCHITECTURE.md:
//   1. In-webview playback (hls.js / native <video>) for HLS/MP4 — the browser path.
//   2. Desktop hand-off to a native player (VLC/mpv) for MKV/HEVC the webview can't decode.
// This command is the desktop direct-play seam: hand a Real-Debrid direct link to a
// native player. On macOS we try VLC, then mpv/IINA as fallbacks.

use std::process::Command;

// Bundled-mpv player (Phase 3 P1): spawns the mpv sidecar and drives it over
// JSON IPC. See player.rs for the `--wid` in-window-embedding caveat (macOS).
mod player;

// In-window mpv render-API player (v0.5): drives mpv's render API into our own
// NSOpenGLView composited behind the transparent webview. The real "beyond IINA"
// in-window path — see render_player.rs (macOS) + RENDER_PLAYER_PLAN.md.
mod render_player;

// OS-keychain SecretStore backend (keychain_get / keychain_set / keychain_delete).
mod keychain;

// Desktop Host Mode: supervises the bundled/self-built Server Mode process so a
// desktop app can host the PWA/API for other devices.
mod server_host;

// The external players we can detect + hand a stream to, in default-preference
// order. macOS entries are .app names (opened via LaunchServices); "mpv" is also
// probed on PATH for a CLI/Homebrew install with no .app.
#[cfg(target_os = "macos")]
const MACOS_PLAYERS: &[&str] = &["IINA", "VLC", "mpv", "QuickTime Player", "Infuse"];

#[cfg(target_os = "macos")]
fn macos_app_installed(app: &str) -> bool {
    // `open -Ra <app>` exits 0 iff the app is registered with LaunchServices.
    Command::new("open")
        .args(["-Ra", app])
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
}

fn cli_on_path(bin: &str) -> bool {
    Command::new(bin)
        .arg("--version")
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
}

/// The external media players actually installed on this machine, so the UI can
/// offer only real choices (and pick a sensible default).
#[tauri::command]
fn list_external_players() -> Vec<String> {
    #[cfg(target_os = "macos")]
    {
        let mut found: Vec<String> = MACOS_PLAYERS
            .iter()
            .filter(|app| **app == "mpv" || macos_app_installed(app))
            .map(|s| s.to_string())
            .collect();
        // mpv is often a CLI-only Homebrew install (no .app) — keep it only if
        // actually present.
        found.retain(|p| p != "mpv" || cli_on_path("mpv"));
        found
    }
    #[cfg(not(target_os = "macos"))]
    {
        ["mpv", "vlc", "mpc-hc64", "mpc-hc", "PotPlayerMini64"]
            .iter()
            .filter(|b| cli_on_path(b))
            .map(|s| s.to_string())
            .collect()
    }
}

/// Hand `url` to an external player. `preferred` (a value from
/// `list_external_players`) is tried first; otherwise the default order is used.
#[tauri::command]
fn open_in_external_player(url: String, preferred: Option<String>) -> Result<String, String> {
    #[cfg(target_os = "macos")]
    {
        // Preferred first (when still installed), then the default order.
        let mut order: Vec<String> = Vec::new();
        if let Some(p) = preferred.as_deref() {
            if !p.is_empty() {
                order.push(p.to_string());
            }
        }
        for app in MACOS_PLAYERS {
            if !order.iter().any(|o| o == app) {
                order.push(app.to_string());
            }
        }
        for app in &order {
            let opened = if app == "mpv" {
                // CLI mpv: spawn directly (no .app).
                Command::new("mpv").arg(&url).spawn().is_ok()
            } else {
                Command::new("open")
                    .args(["-a", app, &url])
                    .status()
                    .map(|s| s.success())
                    .unwrap_or(false)
            };
            if opened {
                return Ok(format!("Opened in {app}"));
            }
        }
        Command::new("open")
            .arg(&url)
            .spawn()
            .map_err(|e| e.to_string())?;
        return Ok("Opened with the system default handler".into());
    }

    #[cfg(not(target_os = "macos"))]
    {
        let mut order: Vec<String> = Vec::new();
        if let Some(p) = preferred {
            if !p.is_empty() {
                order.push(p);
            }
        }
        for bin in ["mpv", "vlc"] {
            if !order.iter().any(|o| o == bin) {
                order.push(bin.to_string());
            }
        }
        for bin in &order {
            if Command::new(bin).arg(&url).spawn().is_ok() {
                return Ok(format!("Opened in {bin}"));
            }
        }
        Err("No external player (mpv/vlc) found on PATH".into())
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        // Native HTTP client used by the webview (`@tauri-apps/plugin-http`) to
        // reach indexer/debrid/addon hosts without the browser CORS policy.
        .plugin(tauri_plugin_http::init())
        // Shell plugin: used from Rust to spawn the bundled mpv sidecar (P1).
        .plugin(tauri_plugin_shell::init())
        // Process plugin: lets the webview `relaunch()` the app after the
        // auto-updater downloads + installs a new version (see updater.ts).
        .plugin(tauri_plugin_process::init())
        // At-most-one mpv instance, shared across the mpv_* commands.
        .manage(player::MpvState::default())
        // At-most-one in-window render-API player (v0.5).
        .manage(render_player::PlayerState::default())
        // At-most-one local DebridStreamer server process.
        .manage(server_host::ServerState::default());

    // Auto-updater is desktop-only. The JS side (web/src/lib/updater.ts) calls
    // the plugin's `check()` once on launch; releases are signed with the
    // updater keypair and published as `latest.json` on GitHub Releases.
    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_updater::Builder::new().build());
    }

    builder
        .invoke_handler(tauri::generate_handler![
            open_in_external_player,
            list_external_players,
            player::mpv_play,
            player::mpv_pause,
            player::mpv_resume,
            player::mpv_seek,
            player::mpv_get_position,
            player::mpv_stop,
            render_player::player_init,
            render_player::player_load,
            render_player::player_command,
            render_player::player_set_property,
            render_player::player_get_property,
            render_player::player_set_video_margin,
            render_player::player_set_rect,
            render_player::player_destroy,
            keychain::keychain_get,
            keychain::keychain_set,
            keychain::keychain_delete,
            server_host::desktop_server_status,
            server_host::desktop_server_start,
            server_host::desktop_server_stop,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
