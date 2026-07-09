# DebridStreamer - Tauri player POC (Phase 0 de-risk)

Proves the single make-or-break risk of the web/desktop pivot from
`../DebridStreamer/COMPETITION_AND_ARCHITECTURE.md`:
**can we play Real-Debrid streams in a lightweight web/desktop shell, with a fallback for
the formats browsers can't decode?**

## Result - proven (2026-06-17)

- **Tauri v2 (Rust + system WebView) builds and runs on macOS** - dev (`npm run tauri dev`) and
  release (`npm run tauri build -- --bundles app` -> a distributable `ds-tauri-poc.app`). This is the
  "lightweight + easy to package/distribute" path (no bundled Chromium).
- **In-webview HLS playback works via hls.js** - the player streams a `.m3u8` (stand-in for
  Real-Debrid's direct / `/streaming/transcode` HLS) at 1080p, fed through MSE. Verified live:
  `paused: false`, `readyState: 4`, `videoWidth: 1920`. MP4 plays via native `<video>` too.
- **Desktop hand-off for MKV/HEVC** - a Rust `#[tauri::command] open_in_external_player` hands the
  direct link to VLC (then mpv/IINA) for lossless direct play of formats the WebView can't decode.
  This is the "two-backend player" from the strategy doc, minus the embedded-libmpv step (Phase 3).

## What this means for the pivot

The biggest unknown (the player) is cleared. The two-backend plan is real:
**Vidstack/hls.js in the webview for HLS/MP4 + a native-player hand-off (-> embedded libmpv later)
for MKV/HEVC.** Real-Debrid returns CORS-friendly HTTPS, so - unlike movie-web/P-Stream - no scraper
or CORS-proxy machinery is needed.

## Stack
React + Vite + TypeScript + hls.js, wrapped in Tauri v2. The eventual app adds Vidstack (over hls.js),
TanStack Query, Zustand, Tailwind, and the ported service layer (see the migration plan in the strategy doc).

## Run
```
npm install
npm run tauri dev                    # dev window
npm run tauri build -- --bundles app # -> src-tauri/target/release/bundle/macos/ds-tauri-poc.app
```
