# DebridStreamer — Competition analysis + web/desktop architecture (2026-06-17)

Synthesis of a 6-agent research pass: Stremio/debrid frontends, TMDB discovery/request apps
(Overseerr/Jellyseerr), media servers (Jellyfin/Plex/Emby), open-source web streaming apps
(movie-web/P-Stream/Cineby), the web/desktop packaging question, and a codebase-tied migration
assessment. Full run: see workflow `v2-competition-and-arch`.

DebridStreamer is essentially a **native macOS take on the Stremio category** (TMDB metadata +
AI recs + Real-Debrid/AD/PM/TorBox + indexers + built-in player). The category's defining
interaction is the **cached-on-debrid stream picker**.

---

## A. Ideas to borrow (prioritized — most are architecture-agnostic)

### Tier 1 — the category-defining differentiators (do these regardless of pivot)
1. **Stream picker with a cached-on-debrid badge** (Torrentio/MediaFusion convention): each row =
   quality chip (4K/1080p · source) + a prominent **green `RD+`/instant vs grey `cache`/will-download**
   badge + glyph row (👤 seeders · 💾 size · ⚙️ indexer) + a parsed second line (codec·HDR·audio·lang·group),
   with a **"cached only"** toggle and sort presets (cached-first → quality → size/seeders). *[M]*
2. **Batch instant-availability checking** (DMM pattern): check many infoHashes per request against the
   active debrid, cache hash→state in GRDB, reuse across the session → drives the badge everywhere a
   stream/poster appears. *[M]*
3. **Continue Watching + Next Up** rails on Home, backed by RD + GRDB resume positions; Next Up surfaces
   the next unwatched episode for in-progress shows. The single most universal pattern across every app. *[M]*

### Tier 2 — discovery + detail (Overseerr/Jellyseerr/Stremio)
4. **Board / Discover / Library / Calendar IA** (Stremio): Board = home (Continue Watching + new-episode
   row + AI/TMDB shelves); Calendar = upcoming episode air-dates for followed series. *[L]*
5. **Slider-stack Discover**: reorderable/toggleable stack of TMDB carousels — Trending, Popular,
   Upcoming, Genre, **Studio/Network/Streaming-provider**, **keyword/"mood"** rows, Watchlist — each header
   deep-links into a Browse grid. *[M]*
6. **TMDB advanced-filter Browse slideover**: genres, keywords, studios/networks, year range, vote avg/count,
   runtime, original language, watch-provider/region + sort. *[M]*
7. **AI ↔ discovery**: the assistant generates custom keyword/mood sliders and translates NL ("cozy fall
   mysteries") → TMDB `/discover` filter params. A clear differentiator over the whole cluster. *[M]*
8. **Person/Cast pages**: tap any cast/crew → filmography grid, each title streamable; global search matches
   people too. *[M]*
9. **Watchlist with auto-resolve**: a watchlist that pre-resolves titles into ready-to-play RD links in the
   background (DebridStreamer's analogue to Overseerr's Plex-watchlist auto-request). *[L]*

### Tier 3 — player (Jellyfin/Plex/Emby)
10. **Player OSD upgrade**: audio/subtitle-track switchers, subtitle styling, playback speed, PiP,
    next/prev episode, **scrub-bar thumbnail previews** (Trickplay). *[M]*
11. **Skip-Intro / Skip-Credits** via a Media-Segments timestamp model with three modes
    (ignore / auto / prompt), Emby-style. *[L]*
12. **In-player subtitle search + delay + AI translation** (subsrt-ts + OpenSubtitles-style search;
    wire the existing AI assistant for on-the-fly translation). *[M]*

### Tier 4 — ecosystem / power-user
13. **Addon-like source registry**: config-driven sources (Torrentio/Comet/MediaFusion-compatible URLs,
    Jackett/Prowlarr) behind one "resolve streams for {id}" interface — unlocks the Stremio addon ecosystem. *[L]*
14. **Trakt two-way sync** (scrobble + watchlist/history/collection catalogs). *[M]*
15. **Hash-list import/share** (DMM/Comet): import a shared collection and bulk-add cached items; let the
    AI emit a curated collection the user one-clicks into their debrid account. *[M]*
16. **Debrid library-management surface** (DMM): unified RD/AD table with search, availability, dedup, delete. *[L]*

---

## B. Architecture — the web/desktop pivot

> The user asked for "an Electron-type app that works in the browser, lightweight, built-in player, easy
> to package/distribute." **Tauri v2 is the lightweight version of exactly that idea** (web UI in a desktop
> shell) and is the recommended wrapper — **not Electron**.

**Tauri v2 vs Electron:** Tauri ≈ 3–12 MB bundle / ~30–85 MB RAM (system webview + Rust core) vs Electron
≈ 80–180 MB / ~150–450 MB (bundled Chromium). The "lightweight" requirement is decisive → **Tauri**.
(The one factor that would tip back to Electron: needing pixel-identical glass rendering across OSes, since
Tauri uses each OS's webview.)

**The hard part is the player.** Browsers cannot natively play MKV/HEVC/AV1 with multi-track audio/subs —
which is most of what Real-Debrid returns. Solution = **two-backend player** behind one abstraction:
- **Desktop:** a bundled **mpv sidecar** rendering to a native window for lossless direct play (the
  Stremio `stremio-shell-ng` pattern: WebView UI + mpv). Keep the existing external-mpv/IINA hand-off as the
  day-one MVP.
- **Browser/PWA + universal fallback:** **Vidstack (over hls.js)** playing Real-Debrid's own
  `/streaming/transcode/{id}` **HLS** output — so "works in the browser" is real **without** bundling FFmpeg.

**"Works in the browser":** TMDB + AI + MP4/HLS playback work directly in a pure web/PWA build. The
**CORS-blocked / browser-impossible** work (torrent indexers, RD `addMagnet`/`unrestrict`, OS keychain)
must live on the native side (Tauri Rust core or a Node sidecar) exposed as typed commands — or, for a
hosted web deployment, behind a small MediaFlow-proxy-style server.

**Distribution:** `tauri-bundler` + `tauri-updater`, signed update artifacts, GitHub Actions mac/win/linux
matrix; budget for Apple Developer ID notarization (incl. the mpv sidecar) and a Windows EV/Azure Trusted
Signing cert from day one.

**Suggested stack:** React + Vite + TypeScript + Tailwind + Zustand(persist) + TanStack Query + tmdb-ts +
Vidstack + hls.js, packaged with Tauri v2; installable PWA via `vite-plugin-pwa`.

### Migration reality (codebase-tied)
- **Feasible but multi-month**, and **worth it only for cross-platform reach (Windows/Linux/browser)** —
  NOT as an effort-saver, because it trades a *working VLC player* for a hybrid player you must build.
- The codebase is **unusually well-prepared**: ~19K LOC, **~60–70% of the hard logic reusable as design**.
  Every external integration (TMDB/OMDB, all 4 debrid services, all indexers, all 3 AI providers, Trakt/IMDb)
  is pure HTTP+JSON/XML → ports to TS ~1:1; native coupling is contained to ~7 protocol-fronted files; the
  SQLite schema/migrations/FTS5 reuse on Tauri; secrets reuse behind the `SecretStore` contract via an
  OS-keychain plugin; AppTheme tokens translate cleanly to CSS variables + Tailwind.
- **Full rewrites** limited to the SwiftUI UI (~6.8K view + 1.8K VM LOC; VM state shapes + tokens carry over)
  and the player.
- **Top 3 risks:** (1) the player (MKV/HEVC in browser → embed libmpv; the biggest bet); (2) secrets + CORS
  in a browser (keep credentialed calls native; scope any pure-browser mode to read-only/proxied);
  (3) scope/UI-fidelity drift (port services **test-first**, reusing the 54 test files as the spec).

### Recommended phased path (IF pivoting)
- **Phase 0 — POC ✅ DONE (2026-06-17):** Tauri v2 shell builds + runs on macOS (dev + a distributable
  `.app`); **hls.js plays an HLS stream in the WebView at 1080p** (verified live: `paused:false`,
  `readyState:4`, `videoWidth:1920`); a Rust `open_in_external_player` command hands MKV/HEVC off to
  VLC. The biggest risk (the player) is cleared. Code at `poc-tauri/` (see its README).
- **Phase 1:** stand up the SQLite schema/migrations on Tauri; port the **services** layer to TS behind the
  identical protocol shapes, validated against the existing 54 test files.
- **Phase 2:** rebuild the UI in React from the AppTheme tokens, wiring to ported services; player =
  direct-play `<video>` + external-mpv hand-off.
- **Phase 3:** embed **libmpv** for in-window MKV/HEVC and reconnect track-selection; ship updater + signing.

**Bottom line:** If Windows/Linux/browser reach is a goal → pivot to **Tauri v2** via the phased plan (the
codebase is ready). If it is **not** a goal → don't pivot; keep the native app (the hardest part, a real
player, is already solved) and integrate the Tier-1/2 ideas above.
