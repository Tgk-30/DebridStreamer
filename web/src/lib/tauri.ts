// Thin bridge to the Tauri desktop shell.
//
// The app runs BOTH as a plain web app (in a browser, `npm run dev`) and inside
// the Tauri webview (the desktop build). This module detects which environment
// we're in and exposes the one native command the player needs:
// `open_in_external_player` (defined in src-tauri/src/lib.rs), used to hand an
// MKV/HEVC direct link to a native player (VLC/mpv/IINA) the webview can't decode.
//
// In a plain browser there is no Tauri runtime, so `isTauri()` is false and the
// player falls back to an "open externally" note instead of invoking.

/** True when running inside the Tauri webview. Tauri v2 injects
 * `__TAURI_INTERNALS__` on the window; we also tolerate the older flag. */
export function isTauri(): boolean {
  if (typeof window === "undefined") return false;
  const w = window as unknown as Record<string, unknown>;
  return "__TAURI_INTERNALS__" in w || "__TAURI__" in w;
}

/** Open a direct stream URL in a native external player via the Rust command.
 * Resolves to the command's status string. Throws if not running under Tauri
 * (callers should gate on `isTauri()` first) or if the command fails. */
export async function openInExternalPlayer(url: string): Promise<string> {
  if (!isTauri()) {
    throw new Error("Not running under Tauri — no native player available.");
  }
  // Imported dynamically so the browser bundle never tries to resolve the Tauri
  // runtime at module-eval time (it's only present in the desktop webview).
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<string>("open_in_external_player", { url });
}

/** Result of {@link playWithMpv}: whether mpv attempted in-window embedding and
 * a human-readable status. On macOS `embedded` being true does NOT guarantee the
 * video rendered inside the app window — mpv often falls back to its own window
 * (the `--wid` embedding caveat, documented in src-tauri/src/player.rs). */
export interface MpvPlayResult {
  embedded: boolean;
  status: string;
}

/** Play a direct stream URL with the bundled mpv sidecar (Phase 3 P1).
 *
 * This is the primary lossless / non-Real-Debrid MKV path: mpv is shipped with
 * the app and fully controlled over IPC (pause/seek/position/stop), unlike the
 * raw VLC hand-off (which relies on a user-installed VLC). Throws if not under
 * Tauri or if the sidecar isn't bundled / fails to spawn — callers should fall
 * back to {@link openInExternalPlayer} (VLC) in that case. */
export async function playWithMpv(url: string): Promise<MpvPlayResult> {
  if (!isTauri()) {
    throw new Error("Not running under Tauri — no bundled mpv available.");
  }
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<MpvPlayResult>("mpv_play", { url });
}

/** Pause the bundled-mpv playback. */
export async function mpvPause(): Promise<void> {
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("mpv_pause");
}

/** Resume the bundled-mpv playback. */
export async function mpvResume(): Promise<void> {
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("mpv_resume");
}

/** Seek the bundled-mpv playback to an absolute position (seconds). */
export async function mpvSeek(seconds: number): Promise<void> {
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("mpv_seek", { seconds });
}

/** Current bundled-mpv playback position in seconds (0 if not yet known). */
export async function mpvGetPosition(): Promise<number> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<number>("mpv_get_position");
}

/** Stop bundled-mpv playback and kill the process. */
export async function mpvStop(): Promise<void> {
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("mpv_stop");
}

export interface DesktopServerStatus {
  available: boolean;
  running: boolean;
  url: string | null;
  urls: string[];
  lan_urls: string[];
  share_url: string | null;
  setup_url: string | null;
  setup_token: string | null;
  port: number;
  detail: string;
  server_entry: string | null;
  web_dist: string | null;
}

export async function desktopServerStatus(): Promise<DesktopServerStatus> {
  if (!isTauri()) {
    throw new Error("Not running under Tauri — no desktop server supervisor.");
  }
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<DesktopServerStatus>("desktop_server_status");
}

export async function startDesktopServer(): Promise<DesktopServerStatus> {
  if (!isTauri()) {
    throw new Error("Not running under Tauri — no desktop server supervisor.");
  }
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<DesktopServerStatus>("desktop_server_start");
}

export async function stopDesktopServer(): Promise<DesktopServerStatus> {
  if (!isTauri()) {
    throw new Error("Not running under Tauri — no desktop server supervisor.");
  }
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<DesktopServerStatus>("desktop_server_stop");
}

export async function openExternalURL(url: string): Promise<void> {
  if (isTauri()) {
    const { openUrl } = await import("@tauri-apps/plugin-opener");
    await openUrl(url);
    return;
  }
  window.open(url, "_blank", "noopener,noreferrer");
}
