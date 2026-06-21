# DebridStreamer V2 — Performance, Cleanup & Redesign

V2 is a major-change PR (branch `v2-perf-redesign`, off the V1 `glassmorphism-redesign-and-backend-audit`
branch / [PR #1](https://github.com/Tgk-30/DebridStreamer/pull/1)). Goal: **optimize for efficiency
and performance, clean the backend + frontend, add tests for everything, and redesign the
navigation + Discover** to a sleek, simple, feature-packed glassmorphism that doesn't fight the app.

Grounded in a 9-subsystem mapping pass: sidebar, Discover, Detail+TMDB, feedback/action-bars,
services-perf, state+DB-perf, tests, build, and VPStudio inspiration.

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

### P5 — Performance + cleanup (DONE: safe high-value subset)
- ✅ Kill the N+1 DB loops (Continue-Watching done in P3; Library + History → bulk
  `fetchMedia(ids:)` + new bulk `fetchWatchHistory(mediaIds:)`).
- ✅ TMDB response memoization (TTL; genres long) — also dedups the `getDetail`+`getSeasons`
  `/tv/{id}` double fetch; drop the now-redundant `credits` append (getCast fetches separately).
- ✅ Bound RD `findExistingTorrent` list; backoff on status polling; reuse `JSONDecoder`/formatters;
  concurrent `validateAll`; AI model-catalog TTL cache; wire services to the shared `AppHTTP.api` session.
- **DEFERRED (correctness-sensitive / not user-visible — documented for a focused follow-up):**
  full `AppState` god-object split; `watch_history(mediaId,episodeId)` UNIQUE-index migration
  (needs dedup-before-constraint); FTS join hardening; read-vs-write `dbPool` split;
  `ensureSystemLibraryFolders` write-amplification gating. Risk of destabilizing the verified app
  outweighs the marginal benefit in this PR.

### P6 — Remaining layout
- ✅ L9: even-width quick-prompt chips (fixed 2-column grid).
- **DEFERRED L16** (shared `ActionBar`): "no visible change" refactor that would churn the
  Discover/Detail files just rewritten in P3/P4 — real regression risk for zero user-facing
  gain. The action rows already read consistently post-redesign. Documented for a later pass.

### P7 — Tests for everything ✅
- 140 new @Test cases across 12 files (parallel-authored): RealDebrid/AllDebrid/Premiumize
  parse+error, DiscoverAICuration, IndexerManager dedup/sort, AppState logic, DebridManager
  fallback, taste/folder/feedback models, OMDBService defensive parsing, TMDB cache +
  getCast/getRecommendations, DiscoverCatalogStore V2, the bulk `fetchWatchHistory(mediaIds:)`.
  Full suite: 0 assertion failures. (Temp-DB teardown leak left as a documented minor item —
  changing the shared helper risks the DB suite; cosmetic temp-file leak only.)

### P8 — Verify + ship ✅
- On-screen QA of nav, Discover (hero + rails), Detail (cast/related), Library, Assistant (L9).
- Adversarial review workflow (find → verify): 2 confirmed bugs fixed — `CachedAsyncImage`
  stale-image-on-url-change (HIGH) and unrendered Airing Today/On The Air rails (LOW).
- Committed in logical chunks; pushed; V2 PR opened.

Status is tracked by commits on `v2-perf-redesign`.
