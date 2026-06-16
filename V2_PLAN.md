# DebridStreamer V2 — Performance, Cleanup & Redesign

V2 is a major-change PR (branch `v2-perf-redesign`, off the V1 `glassmorphism-redesign-and-backend-audit`
branch / [PR #1](https://github.com/Tgk-30/DebridStreamer/pull/1)). Goal: **optimize for efficiency
and performance, clean the backend + frontend, add tests for everything, and redesign the
navigation + Discover** to a sleek, simple, feature-packed glassmorphism that doesn't fight the app.

Grounded in a 9-subsystem mapping pass (sidebar, Discover, Detail+TMDB, feedback/action-bars,
services-perf, state+DB-perf, tests, build, VPStudio inspiration) — see the run transcript.

## Design decision (locked by user)

**Navigation = Hybrid.** Slim left **glass icon rail** (icon + tiny label, accent-ring selection,
no system `List`, no loud blue pill) holding the primary destinations — Discover, Library,
Watchlist, History, AI Assistant — with the **Settings gear pinned at the bottom of the rail**.
**Search moves to a floating glass search field in the top-right corner** (routes to the Search
screen with the query). This is the "icons in different places, Netflix-style, not a big contrasting
bar" direction. Design language borrowed from VPStudio (Obsidian Glass): 3 elevation tiers,
accent-as-glow-only, one specular stroke, restrained background, retain-content-while-refreshing.

## Phases (dependency-ordered; build stays green after each)

### P1 — Foundation
- AppTheme: 3 coordinated elevation tiers (rest/raised/hero) driving material+tint+stroke+shadow
  together; accent reserved as glow/selection (primary CTA = solid, not heroGradient); tone down
  auroraGlow (3 orbs @0.18–0.35 → 2 @~0.06) for foreground legibility.
- Image layer: actor-backed poster cache w/ in-flight coalescing + `URLCache.shared` sizing;
  a shared tuned `URLSession` injected at the service-wiring layer (separate image vs API cache).
- Model surface: `MediaPreview.backdropPath` (+ populate in `toMediaPreview`); transient
  `cast`/`related` carriers for Detail; OMDB response models.

### P2 — Hybrid nav shell
- New `NavRail` (slim glass, icon+label, accent-ring selection, Settings at bottom) + `GlobalSearchField`
  (top-right) + `AppShell` replacing `NavigationSplitView` in `ContentView`. Keep `selectedSidebarItem`
  binding intact (deep-links from Search/Detail/Discover/Setup still work). Clear traffic lights.
  Closes L21 (quiet selection) + the "contrasting rail" complaint.

### P3 — Discover overhaul
- Cinematic hero/spotlight (needs `MediaPreview.backdropPath`), staggered rail reveals,
  retain-content-while-refreshing (no blank ProgressView flash), real Continue-Watching
  (resume bar + progress, 16:9 card), genre rails + Now-Playing/Upcoming/Airing (TMDB
  `discover`/`getGenres`/categories already implemented but unused), L13 (reserved 2-line title
  height), L12 (single lighter feedback control, recommender signal preserved), AI-rail L1 fade.

### P4 — Detail: L23 + B1
- Decode the TMDB `credits` already being fetched (cast row); add `getRecommendations` ("More Like
  This"); technical-details grid; fill the empty lower modal. B1: new `OMDBService` wired from the
  saved key → real IMDb/RT ratings merged into `MediaItem.rtRating` (DB column already exists).

### P5 — Performance + cleanup
- Kill 3 N+1 DB loops (Library/Continue-Watching/History → bulk `fetchMedia(ids:)`).
- Remove duplicate TMDB detail fetch (`getSeasons` re-fetches `/tv/{id}`) + drop the wasted
  `credits` append once decoded path is in; TMDB response memoization (TTL; genres long).
- Bound RD `findExistingTorrent` list; backoff on status polling; reuse `JSONDecoder`/formatters;
  concurrent `validateAll`; AI model-catalog TTL cache.
- DB: gate `ensureSystemLibraryFolders` write-amplification behind a startup flag; convert
  read-shaped methods off `dbPool.write`; harden FTS join; add `watch_history(mediaId,episodeId)` index.
- Split monolithic `AppState` (services / nav+UI / player coordinator) carefully, build-verified.

### P6 — Shared components / remaining layout
- One `ActionBar` component (L16) adopted by Discover/Detail/Assistant/Search; even-width
  quick-prompt chips (L9).

### P7 — Tests for everything
- New: RealDebrid/AllDebrid/Premiumize parse+error tests, DiscoverAICuration, IndexerManager
  dedup/sort, AppState logic (resolveModelID, player-window request-ID), taste/folder/feedback
  models, OMDBService, image cache, TMDB memoization. Fix the temp-DB teardown leak.

### P8 — Verify + ship
- Build + sign + on-screen vision QA of every screen; adversarial code review (workflow);
  fix; commit in logical chunks; push; open V2 PR.

Status is tracked by commits on `v2-perf-redesign`.
