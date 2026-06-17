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
