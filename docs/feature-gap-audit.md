# DebridStreamer feature-gap audit

Date: 2026-07-17 (against v0.9.3). Method: three parallel passes - a code inventory of what ships today, live web research on comparable apps (Stremio, Plex/Jellyfin, Infuse/VidHub, the debrid-native tool ecosystem), and a jobs-to-be-done gap analysis across four personas. This is a product document, not a work order: nothing here is committed to a release.

## The headline: you have built more than you ship

The single most valuable finding is not a missing feature - it is **finished code that no screen can reach**. These are the cheapest wins in the whole audit because the hard part is already done and tested.

- **Trakt sync is fully implemented and wired to nothing.** `web/src/services/sync/TraktSyncService.ts` has OAuth device-flow auth and watchlist push/pull with a passing test suite, and it is imported by zero screens, store, or lib code (Watchlist.tsx literally calls it "the documented follow-up"). Portable, source-agnostic Trakt sync is the #1 power-user must-have in the research, and it is one wiring task away.
- **IMDb two-way sync** (`IMDbCSVSyncService.ts`) is in the same state: the one-shot CSV import is reachable, the ongoing sync orchestration is not.
- **Subtitle appearance** (font scale, text color, caption-background opacity) is persisted and applied to `::cue`, but there is **no Settings control to change it** - the plumbing exists, the knob does not.

If the goal is maximum user-visible improvement per hour of work, wire these three up first.

## What the app already does well (so we do not re-invent it)

The inventory came back large and mostly "solid": a cinematic Discover with hero/rails/calendar; real Search + Browse with filters; rich Detail with cast, trailers, season/episode pickers and three-state watched tracking; a genuine stream picker (dual imdb+title search, cross-service cache check, dedupe, pack-aware ranking); four debrid providers behind one abstraction; a debrid-library manager; a full download queue with optimized transcode; OpenSubtitles + AI subtitle translation; local multi-profile and a server mode with roles; a privacy/network-mode system; auto-advance/up-next; background auto-resolve pre-caching; nav customization and a deep appearance system. The foundation is strong. The gaps below are about reach and polish, not missing fundamentals.

## Gaps that matter, grouped by theme and ranked

### 1. Reach the living room and the phone (the biggest strategic gap)
Every competitor - Stremio, Plex, Jellyfin, Infuse - has a TV app and real mobile apps. DebridStreamer is desktop + PWA + server only. For the **household** persona this is a dealbreaker: the primary scenario is couch viewing with a remote, and there is no path to it. Two partial mitigations that do not require a native TV codebase:
- **Casting** (Chromecast / AirPlay / DLNA) from the existing app - lets a desktop or phone throw a stream to the TV. Nothing casting-related exists today.
- Hardening the **PWA for tablet/phone** as the interim mobile story (downloads and optimized transcode are currently Tauri-desktop-only, so mobile users are streaming-only).

This is also the most predictable inbound support request, so it is a developer-operator burden, not just a user gap.

### 2. Make remote access "just work" for non-technical households
Server mode's remote access is entirely manual today (port-forward / DNS / VPN, all documented). Plex Relay set the expectation that it works away from home with zero setup. An **in-app tunnel helper (Tailscale or Cloudflare Tunnel) or a relay** would convert the single hardest household-onboarding step - and its recurring support tickets - into a one-click flow. Rated a dealbreaker for the household persona and a friction sink for the operator.

### 3. Trust the player on the formats debrid actually returns
The in-window native mpv player is still marked **EXPERIMENTAL** and defaults on only for macOS, with a documented "fall back to webview HLS" recovery. For a "just watch" user whose whole promise is "it plays," an experimental core on exactly the files debrid serves (remuxed MKV/HEVC/AV1) is the highest-risk surface in the app. Infuse's "play everything" is the bar. Adjacent quality gaps for the enthusiast: **HDR/Dolby Vision** correctness (feasible only in the desktop engine, DV effectively out of reach), **lossless/object audio passthrough** (Atmos/TrueHD - no evidence it is wired), and **chapter markers** in the player (the files often carry them). Graduating the player from experimental to trusted is the most important reliability investment.

### 4. Close the debrid power-user loop
Research on the debrid-native ecosystem (Debrid Media Manager, zurg, TorBox) surfaced jobs the app is close to but does not finish:
- **Uncached "add and poll to playable"** - when nothing is cached, add the torrent to the debrid account, wait for it to complete server-side, then stream. Today an uncached pick is a dead end.
- **Dead-link re-resolve at play time** - cached files silently expire; a "this link died, finding another" retry keeps playback alive.
- **Ratings on posters (RPDB-style)** in grids/rails - OMDb scores appear only on Detail today, so triaging a large list means opening each title.
- **Duplicate / failed-item cleanup** in the debrid library (partially present as duplicate flagging; bulk dedupe by size/date is the DMM standard).

### 5. Re-engagement and household governance
- **New-episode notifications.** There is a Calendar but no push/in-app alert when a followed show drops. Stremio/Plex actively notify; here re-engagement depends on the user remembering to look.
- **Per-profile PIN.** The sub-profile password hash is stored but **not required to switch profiles** - anyone at the device can enter the owner's or another member's profile. Only a kid maturity-lock exists. Plex Home PINs are the expectation.
- **Enforced (not just recorded) per-profile bandwidth quotas**, and **access schedules / blocked-genre controls** for kids beyond a maturity ceiling.

### 6. Onboarding and operator friction
- **The TMDB key wall.** A real catalog requires the user to independently obtain and paste a TMDB key; without it they silently get a small fixtures set, so the debrid key's value is invisible until a second unrelated key is added. The embedded/broker key mechanism is wired for OMDb only - extending it (or a first-run "get your free TMDB key" deep-link + validator) would cut first-run drop-off.
- **Secrets in plaintext settings.** The web/PWA keychain-backed SecretStore is a documented follow-up; keys currently live in the settings store marked `secret:`.
- **Backup/restore and diagnostics.** No in-app data backup/restore/migrate flow, and no log-export/diagnostics surface for debugging user playback failures (consistent with the telemetry-free stance, but it makes support entirely manual).
- **Dead weight.** The unshipped SwiftUI app in `Sources/`/`Tests/` and some stale comments are ongoing maintenance drift.

### 7. Delight differentiators (cheap, memorable)
- **Skip intro / skip credits** (chapter-based, or manual per-title marks like VidHub) - repetitive friction on every binge episode.
- **Dual subtitles** (two tracks at once) for language learning - VidHub differentiates on exactly this and the renderer would support it cheaply.
- **Smart/auto collections** (TMDB-driven "franchise in order", list-driven groupings) beyond today's manual folders.
- **Watch Together / SyncPlay** for household movie night across devices.

## Suggested sequencing (my read, for discussion)

1. **Wire what exists** - Trakt sync, IMDb two-way, the subtitle-appearance Settings control. Highest value-per-hour; the code is done.
2. **Graduate the player** off EXPERIMENTAL + add chapters and skip-intro. Protects the core promise.
3. **Casting** as the interim living-room answer, before committing to any native TV app.
4. **In-app tunnel helper** for server-mode remote access - kills the worst onboarding step and the biggest support drain.
5. **Ratings-on-posters + new-episode notifications** - low-effort engagement wins.
6. **Per-profile PIN + enforced quotas** - completes the household governance story.

Native TV/mobile apps are the largest strategic gap but also the largest investment for a single developer; casting + a hardened PWA buy most of the value first.

## Applicability notes (things competitors have that intentionally do not fit)
Riven-style virtual-filesystem/symlink libraries feeding Plex, RSS auto-grab (*arr replacement), and Usenet/NZB consumption are all **out of model** - DebridStreamer is its own interactive player with no local library scanner, not an acquisition pipeline. Correctly excluded rather than treated as gaps.
