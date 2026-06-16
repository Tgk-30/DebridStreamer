# DebridStreamer — Consolidated Review & Action Plan

Sources for this plan:
- **MiniMax-M3 (vision)** adversarial layout review — 5 screens, 2026-06-17.
- **Self cross-check** (Claude, vision) — same 5 screens, second perspective.
- **GLM-5.1 / Kimi-K2.6 (vision) pass — PENDING:** the OpenCode Zen key is valid but the
  workspace has **no balance** (both paid and "free-promotion-ended" models return a
  CreditsError). Add credits at the OpenCode billing page and this pass can run with the
  scripts already staged. (Note: Zen publishes `glm-5.1`/`kimi-k2.6`, not 5.2/2.7.)
- **Backend audit** (12-mapper + 16-verifier workflow, 2026-06-16/17).

Status legend: ✅ done · ⬜ open · 🟡 debatable. Source: M3 / self / both.

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
| L16 | Cross-screen | Action-row patterns differ per screen (card buttons / modal mixed controls / assistant trio / settings centered) | Define one shared action-bar component + button hierarchy and reuse it | M | both |

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

## C. Pending external pass

- **GLM-5.1 / Kimi-K2.6 vision review** — blocked on OpenCode Zen credits. Scripts staged; will run on credit top-up and its findings get merged into Section A (with a `glm`/`kimi` source tag), confirming or challenging the M3/self items above.

---

## Suggested execution order
1. P0 layout (L1–L6) — fast, objective, high visual payoff.
2. L10–L11 (Detail modal polish) + L7–L8 (reclaim dead space).
3. L12/L16 (card feedback control + shared action bar) — bigger, more design judgment.
4. B1 (OMDB) and B5 (frontend QA) when convenient.
5. Re-run the GLM/Kimi pass once credits are added; reconcile.
