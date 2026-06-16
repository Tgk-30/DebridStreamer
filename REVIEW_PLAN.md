# DebridStreamer — Consolidated Review & Action Plan

Sources for this plan:
- **MiniMax-M3 (vision)** adversarial layout review — 5 screens, 2026-06-17.
- **Self cross-check** (Claude, vision) — same 5 screens, second perspective.
- **MiMo V2.5 (vision, `xiaomi/mimo-v2.5-20260422`, via OpenCode Zen)** — 3rd adversarial pass,
  2026-06-17. Independently corroborated most M3/self P0–P1 items and added new specifics
  (gutter consistency, settings tab placement, modal width, usage-card waste).
- **Kimi K2.7 Code (vision, `kimi-k2.7-code`, Moonshot, via OpenCode *Go* `/zen/go/v1/`)** —
  4th adversarial pass, 2026-06-17. Strongly corroborated the core findings and added L21–L24.
  (The `Insufficient balance` errors earlier were because the key is an **OpenCode Go subscription**,
  whose endpoint is `/zen/go/v1/`, separate from the pay-as-you-go Zen balance at `/zen/v1/`.)
- **DeepSeek-V4-Pro / MiMo-V2.5-Pro** — available on Go but return *no image-input support* (text-only
  there); the vision MiMo pass used the free `mimo-v2.5`. **GLM-5.1** is on Go and could add a 5th pass.
- **Backend audit** (12-mapper + 16-verifier workflow, 2026-06-16/17).

Status legend: ✅ done · ⬜ open · 🟡 debatable. Source: M3 / self / mimo / kimi / both.
4-model convergence on the core issues (L1, L2, L4, L5, L7, L8, L12, L16, L17–L20) — high confidence.

**EXECUTED & verified on-screen (2026-06-17):** ✅ L1, L4, L5, L6, L7, L8, L19, L20, L22; L2 +
L18 partial (Settings panel fills pane + Save right-aligned; inner form top-anchor blocked by
macOS `Form`-in-`TabView` centering — needs a `Form`→custom layout rewrite). The signed
`/Applications/DebridStreamer.app` is rebuilt with all of these.
**Still open (diminishing returns / bigger lifts):**
- L18-full — replace Settings `Form` with a custom top-aligned layout (moderate rewrite).
- L24 — explicit page headers per pane (most screens already have de-facto headers).
- L23 — fill Detail's lower area with cast/related (needs extra metadata).
- L17 gutter (subtle), L9 orphan chip (cosmetic), L21 sidebar selection (system List), L16
  shared action-bar refactor (no visible change), L3 top inset (not really needed — lights are
  over the sidebar), L12🟡 (keep the feedback signal).

---

## A. Layout & visual-design fixes

### P0 — clear wins (objective, low-risk)

| ID | Screen | Problem | Fix | Effort | Source |
|----|--------|---------|-----|--------|--------|
| L1 | Discover | Horizontal rails **clip hard at the right edge** with no scroll affordance — reads as a render bug | Right-edge gradient fade (~40px, →background) over the last card + show a partial "peek" of the next card; optional `chevron.right` button on hover | S | both |
| L2 | Settings | Form is a **tiny island in a void** — content vertically centered, ~150px dead top padding, Save floats centered, tab bar floats | Anchor content to top, `maxWidth ≈ 680`, left-align fields, move Save to a right-aligned/full-width footer, cut the top padding | M | both |
| L3 | All (shell) | **Hidden title bar:** first section header / Settings tab bar sit tight under the traffic-light zone | Add a top safe-area inset (~28–36px) to the detail content and sidebar so nothing crowds the window controls | S | self |
| L4 | Detail | Action row **mixes control types** — pills + a wide "Add To Folder" dropdown fighting for width | Normalize to an equal-width pill group; make folder a pill+chevron that opens a popover, not a `Picker` | S | both |
| L5 | Detail | Metadata `2026  2h 8m  8.6  Movie` runs together | Add `•` separators with consistent spacing | XS | both |
| L6 | Search | **"Scope" label wraps to "Scop/e"**; Scope + Type segmented pickers cramped together | Give the label its own row / enough width; add spacing between the two pickers | XS | self |

### P1 — medium

| ID | Screen | Problem | Fix | Effort | Source |
|----|--------|---------|-----|--------|--------|
| L7 | Search | **~60% dead space** below the hero card when no query | Fill with a "Recent searches / Trending starters" rail reusing `MediaCard`; shrink the empty-state box | M | both |
| L8 | AI Assistant | Right results column is **empty/wasted** until Generate | Collapse the right column until a result exists (or move the empty-state prompts into the left Quick Prompts) | M | both |
| L9 | AI Assistant | Quick-prompt chips have **uneven widths + an orphan row** (2/2/1) | Uniform chip widths in a fixed grid, or a single-column full-width list | S | M3 |
| L10 | Detail | Modal **does not dim/blur** the page behind it (Discover grid fully visible) | Add a dimming scrim behind the sheet | S | both |
| L11 | Detail | Close (X) **anchored to the image**, not the modal; image bleeds past the modal's rounded top | Anchor X to the modal's top-right corner; clip the backdrop to the modal's rounded top | S | both |
| L12 | Discover | Dual **Watched / Not-Watched** buttons under every card eat ~70px/row 🟡 | Replace with a single state control (icon toggle in the poster corner). **Keep the feedback semantics** — both states still feed the recommender; just make it lighter, don't remove the signal | M | M3 (mod. self) |

### P2 — polish

| ID | Screen | Problem | Fix | Effort | Source |
|----|--------|---------|-----|--------|--------|
| L13 | Discover | Title wrap (1 vs 2 lines) breaks the metadata row's vertical rhythm across a rail | Reserve 2 lines (fixed height) for titles so year/rating rows align | XS | both |
| L14 | Settings | API-key fields aren't labeled (TMDB vs OMDB) — only helper text distinguishes | Add explicit field labels ("TMDB API Key (required)", "OMDB API Key (optional)") | XS | M3 |
| L15 | Sidebar | Section headers use the same weight as items 🟡 (this is standard macOS sidebar styling — low priority) | Optional: lighten/space section headers | XS | M3 |
| L16 | Cross-screen | Action-row patterns differ per screen (card buttons / modal mixed controls / assistant trio / settings centered) | Define one shared action-bar component + button hierarchy and reuse it | M | both+mimo |

### Added by the MiMo V2.5 pass

| ID | Screen | Problem | Fix | Effort | Source |
|----|--------|---------|-----|--------|--------|
| L17 | Cross-screen | **Inconsistent left gutter** between sidebar and content — large on Discover, smaller on Search (the AI pane eats it) | Tokenize a single left content gutter and apply it on every primary screen | S | mimo |
| L18 | Settings | The **tab bar sits *inside* the content card**, pushing the actual settings (API Keys) too far down and burying them | Move the tabs to a pill rail *above* the card (or a left sub-nav per L2); content starts at the top of the panel | S | mimo |
| L19 | Detail | **Modal is too narrow** — the hero image crops awkwardly and the action row is squeezed | Widen the modal (~820–900) so the backdrop breathes and the action pills space out | S | mimo |
| L20 | AI Assistant | **Session/Lifetime usage cards** consume a full row for trivial values ($0.0000 / 0 tokens) | Condense to a single inline strip (or move into a footer) so the prompt area gets the space | XS | mimo |

### Added by the Kimi K2.7 Code pass

| ID | Screen | Problem | Fix | Effort | Source |
|----|--------|---------|-----|--------|--------|
| L21 | Sidebar | The **selected-item blue pill is too loud** and fights the content for attention | Soften the selection fill (lower opacity / accent-tinted glass) so content leads | XS | kimi |
| L22 | Detail | **Synopsis line length is too long** (~80–90 chars) — uncomfortable to read | Constrain the overview measure to ~60–65 chars (max width) | XS | kimi |
| L23 | Detail | **Bottom half of the modal is empty** after the synopsis/actions (before streams load) | Fill with cast / related titles / technical details, or tighten the modal height | M | kimi |
| L24 | Settings + panes | **No page header/title** — only the sidebar selection tells you where you are | Add a lightweight page header (title) to each detail pane | S | kimi |

---

## B. Backend / robustness — open items (from the audit)

Already applied this effort (✅): Anthropic model-id fix, season-picker bug, VLC deinit race + parse throttle, AllDebrid polling, debrid cache-routing + TorBox/Premiumize polling + RD selectFiles, indexer non-2xx + timeouts + testConnection + Torznab, DB folder-delete/v9/CTE-cycle/cascade, eager keychain sweep + atomic usage + kSecAttrAccessible, AI error-surfacing + bounded cache + context parallelize + balanced-JSON, Trakt refresh + pushWatchlist + typed errors, IMDb slug+batch, MediaType word-boundary, SearchVM/PlayerVM task fixes, dead-code removal. **382 tests pass, 0 assertion failures.**

Still open (⬜):
- **B1** OMDB ratings integration — Settings has the key field but no fetch/merge of OMDB ratings (feature + UI wiring).
- **B2** Indexer base-URL overrides + multi-mirror fallback (resilience when a default host is down).
- **B3** Generic (non-Real-Debrid) resolve: existing-torrent dedup — needs a `findExistingTorrent` on `DebridServiceProtocol`.
- **B4** AllDebrid/Premiumize: stop sending the token in the request body (header-only) to shrink leak surface.
- **B5** Per-screen frontend screenshot QA for the screens not yet individually verified (Library, Player, StreamList, History, Setup).

Deliberately **not** doing (with reason): TMDB Bearer auth (would 401 v3 keys); OpenAI model-id swap (`gpt-4.1-mini` still valid, `gpt-5` unverified).

---

## C. External-model passes

- ✅ **MiniMax-M3** (vision) — done. Primary layout review.
- ✅ **MiMo V2.5** (`mimo-v2.5-free`, vision) — done. Corroborated + extended (L17–L20).
- ✅ **Kimi K2.7 Code** (`kimi-k2.7-code`, via OpenCode **Go** `/zen/go/v1/`) — done. Corroborated
  + extended (L21–L24).
- ❌ **DeepSeek-V4-Pro / MiMo-V2.5-Pro** — no image-input support on the Go endpoint (text-only there).
- ⬜ **GLM-5.1** (on Go) — optional 5th pass available if you want one more cross-check.

---

## Suggested execution order
1. P0 layout (L1–L6) — fast, objective, high visual payoff.
2. L10–L11 (Detail modal polish) + L7–L8 (reclaim dead space).
3. L12/L16 (card feedback control + shared action bar) — bigger, more design judgment.
4. B1 (OMDB) and B5 (frontend QA) when convenient.
5. Re-run the GLM/Kimi pass once credits are added; reconcile.
