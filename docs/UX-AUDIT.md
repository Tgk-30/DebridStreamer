# UI/UX Audit: DebridStreamer

Date: 2026-07-17. Branch: `ux/audit`. Scope: SwiftUI macOS app (`Sources/DebridStreamer`) and web app (`web/`, React 18 + Vite + Tauri/PWA). The `poc-tauri` player proof-of-concept has no meaningful UI surface beyond native `<video controls>` and is excluded.

Totals: **215 findings enumerated** (127 native, 88 web).

**Verification note (added after review).** Every finding was checked against the code. Result: 202 accurate, 10 partially accurate, 3 corrected or withdrawn (native `6.5` reframed, `11.5` and `12.5` withdrawn; see those entries). The original headline of "207 (118 native, 89 web)" undercounted the enumerated findings and has been corrected above.

**Two scoping caveats.** (1) The native macOS app is currently unshipped; the shipping product is the web app (`web/` via `v*-web` release tags). The 88 web findings are the shipping-relevant ones. (2) This audit was written against commit `7196875` (the `ux/audit` line). The web findings in Part 2 have been **re-verified against the shipping `main` line (`61c07b9`)** and their file/line references updated to that tree; findings already resolved on `main` were moved to "Resolved on `main` since the audit" at the end of Part 2. The native references in Part 1 remain as-of `7196875` and were not re-mapped.

Top cross-app themes:

1. Accessibility is the largest gap on both platforms (39 combined findings).
2. Destructive actions lack confirmation/undo (library remove, debrid deletes, Trakt disconnect, indexer remove).
3. Error handling architecture: single-slot modal alert on native, silent fixture fallback on web, no toast system on either.
4. Player UX gaps: no volume control on native, duplicate seek bars on web, missing Escape/focus handling on both.
5. Dead or fake affordances: hero Play that doesn't play, Resume that doesn't resume, dead auto-play-next setting, cast cards that do nothing, Assistant results that are dead ends.
6. No localization infrastructure anywhere.
7. Unbounded eager lists (stream results, browse grids, debrid table) hurt perceived performance.

---

# Part 1: Native macOS app (SwiftUI)

## 1. Accessibility (19)

- 1.1 [high] Cards open details via `.onTapGesture` on a non-Button view; unreachable by keyboard/VoiceOver. `DiscoverView.swift:492-494`, `ContinueWatchingCard.swift:35`. Wrap in `Button` with `.buttonStyle(.plain)`, combine children into one accessibility element.
- 1.2 [high] `MediaCard` has zero accessibility modifiers; VoiceOver reads poster/title/year/star as separate unlabeled elements. `MediaCard.swift:10-71`. Add `.accessibilityElement(children: .combine)` + label + `.isButton` trait.
- 1.3 [high] Only 3 accessibility modifiers exist app-wide. Systematic pass needed.
- 1.4 [high] Player transport buttons are icon-only with no `.help` or labels. `PlayerView.swift:166-187`.
- 1.5 [med] Detail sheet close button is an unlabeled "xmark". `DetailView.swift:74-85`; identical copy in `PersonView.swift:184-197`.
- 1.6 [med] Discover feedback ellipsis menu has no label. `DiscoverView.swift:373-384`.
- 1.7 [med] Library card trash button is icon-only, no tooltip/label. `LibraryView.swift:500-508`.
- 1.8 [med] Indexer source toggle uses `.labelsHidden()` with no replacement label. `SettingsView.swift:363-367`.
- 1.9 [med] Indexer reorder chevrons are icon-only. `SettingsView.swift:392-406`.
- 1.10 [low] Search clear buttons lack labels. `SearchView.swift:138-146`, `NavRail.swift:106-115`.
- 1.11 [med] Nav rail labels render at 9 pt, fixed width, no Dynamic Type. `NavRail.swift:35,55`. Raise to 10-11 pt minimum, adopt `@ScaledMetric`.
- 1.12 [med] No Dynamic Type support anywhere: fixed point sizes and frames. `MediaCard.swift:7-8`, `AIAssistantView.swift:41`.
- 1.13 [med] Seeder health conveyed by color alone. `StreamListView.swift:303`, `AppTheme.swift:150-154`. Add text/icon differentiator.
- 1.14 [low-med] Quality badge contrast unverified (720p indigo in light mode); badges lack labels. `StreamListView.swift:337-345`, `AppTheme.swift:141-148`.
- 1.15 [med] No Reduce Motion support: staggered rails, hover springs, boot video. `DiscoverView.swift:624-630`, `MediaCard.swift:67-69`, `BootView.swift:74-95`.
- 1.16 [low] BootView decorative video not `.accessibilityHidden`. `BootView.swift:41-68`.
- 1.17 [low] Rating sliders lack accessibility values; Like/Dislike picker ungrouped. `RatingFeedbackSheet.swift:33-66`.
- 1.18 [low] Player status pills read runtime jargon verbatim. `PlayerView.swift:132-159`. Combine with plain-language label.
- 1.19 [med] glyphBadge failure state only via red icon + hover tooltip. `DiscoverView.swift:353-355`. Surface failure as text.

## 2. Keyboard & shortcuts (5)

- 2.1 [high] Only one shortcut in the app (fullscreen). Missing space/arrows/volume/mute in player. `PlayerView.swift:206`.
- 2.2 [high] No app-level commands: no Cmd+1...7 nav, no Cmd+F/Cmd+K search focus. `DebridStreamerApp.swift:60-76`, `NavRail.swift:87-128`.
- 2.3 [high] Sheets don't respond to Esc. `DetailView.swift:51-118`, `PersonView.swift:27-52`, `RatingFeedbackSheet.swift:71-76`, import wizard `SettingsView.swift:740-790`. Add `.onExitCommand`/`.keyboardShortcut(.cancelAction)`.
- 2.4 [med] Esc in player closes window outright when not fullscreen. `PlayerView.swift:55-62`.
- 2.5 [low] Settings tab bar has no keyboard navigation. `SettingsView.swift:188-219`.

## 3. Player controls & playback UX (9)

- 3.1 [high] No volume control or mute anywhere in the player UI. `PlayerView.swift:161-253`.
- 3.2 [high] "Auto-play next episode" setting is persisted but has no consumer. `SettingsView.swift:507`. Implement up-next or caption as coming soon.
- 3.3 [high] Hero "Play" button does not play; identical to "Details". `DiscoverView.swift:109-114`.
- 3.4 [high] Continue Watching "Resume" opens the detail sheet instead of resuming. `DiscoverView.swift:196-198`, `ContinueWatchingCard.swift:35-38`.
- 3.5 [med] Quality switcher shows only the quality label; no size/codec/cache info. `PlayerView.swift:255-269`.
- 3.6 [med] Developer jargon in user-facing diagnostics ("Playing with VLC.", "Fullscreen transition already in progress."). `PlayerViewModel.swift:466,253`, `PlayerView.swift:243-248`.
- 3.7 [med] Playback error overlay offers only "Retry"; no switch-quality or external-player fallback. `PlayerView.swift:405-429`.
- 3.8 [low] No buffered-range indicator, no elapsed/remaining toggle. `PlayerView.swift:211-241,574-584`.
- 3.9 [low] Player window opens fixed 1180x760; doesn't remember frame, no aspect lock. `PlayerWindowController.swift:78-93`.

## 4. Loading states (9)

- 4.1 [high] AI generating shows the idle empty state instead of a generating indicator. `AIAssistantView.swift:7-9,300-327`.
- 4.2 [med] Search replaces results with full-pane spinner on every search; results flash. `SearchView.swift:52-60`. Keep stale results dimmed.
- 4.3 [med] Library/Watchlist reload swaps entire grid for a spinner. `LibraryView.swift:371-373`.
- 4.4 [med] Settings save buttons show no progress; only one disables. `SettingsView.swift:234-241,264`.
- 4.5 [low] Trakt auth buttons lack spinners. `SettingsView.swift:594-598`.
- 4.6 [med] `CachedAsyncImage` failure is terminal: a transient load error sets `.failure` with no retry and only re-runs on a URL change. `ImageLoader.swift:118-128`, `LibraryView.swift:567-580`. Add retry. (Corrected on verification: the original "memory-only cache, add disk cache" half was wrong. A disk-backed `URLCache` already exists, see the withdrawn 12.5; only the decoded-image `NSCache` is memory-only.)
- 4.7 [low] Discover skeleton is static, always 3 generic rails. `DiscoverView.swift:499-525`.
- 4.8 [low] PersonView filmography has no skeleton. `PersonView.swift:98-102,149-180`.
- 4.9 [med] BootView has no skip; up to 8.5 s blocking. `BootView.swift:86-94`. Allow click/Esc to finish early.

## 5. Empty states (8)

- 5.1 [med] Watchlist/Library empty states lack CTA buttons. `LibraryView.swift:374-381`.
- 5.2 [med] History has no per-row removal, no clear-all, no date grouping. `LibraryView.swift:15-118`.
- 5.3 [low] "No streams found" gives no path to indexer settings. `StreamListView.swift:155-168`.
- 5.4 [low] "No sources configured yet." has no guidance/CTA. `SettingsView.swift:296-299`.
- 5.5 [low] Failed search offers no recovery action. `SearchView.swift:61-66`.
- 5.6 [med] AI Curated never shows error state when `lastError` is set. `DiscoverView.swift:259-269`, `DiscoverAICurationStore.swift:44-51`.
- 5.7 [med] DetailView load failure has no Retry. `DetailView.swift:62-72`.
- 5.8 [low] "No folders yet." lacks hint to use the + button. `LibraryView.swift:249-252`.

## 6. Error handling (11)

- 6.1 [high] All errors funnel into one `AppState.errorMessage` modal with only "OK"; a second error overwrites the first. `ContentView.swift:60-67`, `AppState.swift:12`. Move to a toast queue with severity and actions.
- 6.2 [high] Debounced search failures pop the global modal, interrupting typing. `SearchView.swift:272-275`, `SearchViewModel.swift:161-167`. Show inline error instead.
- 6.3 [med] CSV export errors swallowed. `SettingsView.swift:133-138`.
- 6.4 [med] Success/failure coloring string-matched on "Error". `SettingsView.swift:243-252`, `SetupView.swift:151-156`. Use typed status enum.
- 6.5 [med] `loadSettings()` writes a single shared `statusMessage` (`SettingsView.swift:884-886`) that is not scoped to its originating tab, so a load error persists and re-renders on every Settings tab as the user switches rather than clearing. `SettingsView.swift:243-252`. Scope status to its tab or clear on tab change. (Reframed on verification: the original "invisible on non-whitelisted tabs" claim was inverted. All 7 tabs whitelist themselves, so the real defect is the opposite, a cross-tab status leak.)
- 6.6 [med] Failed `initialize()` leaves broken state, no retry. `ContentView.swift:47-59`.
- 6.7 [med] Trakt device auth: no expiry handling, URL not clickable/copyable. `SettingsView.swift:599-605,1020-1034`.
- 6.8 [med] `episodeCount ?? 20` guesses episodes, allowing searches for nonexistent ones. `DetailView.swift:517-518`.
- 6.9 [low] resolveTorrent errors persist as red caption with no dismiss. `StreamListView.swift:88-96,235-250`.
- 6.10 [low] Multi-line indexer diagnostics dumped into a caption. `DetailView.swift:914-921`. Use disclosure rows.
- 6.11 [med] `openRecommendationDetail` fails silently on no match. `DiscoverView.swift:562-577`.

## 7. Feedback, confirmation & undo (7)

- 7.1 [high] Library remove executes immediately, no confirmation or undo. `LibraryView.swift:388-395,499-509`, `LibraryViewModel.swift:173-181`.
- 7.2 [med] "Not interested" hides permanently with no undo. `DiscoverFeedbackViewModel.swift:88-110`, `DiscoverView.swift:363-372`.
- 7.3 [med] Trakt "Disconnect" destructive with no confirmation. `SettingsView.swift:586-589`.
- 7.4 [med] Indexer "Remove" + staged-save model is implicit; leaving the tab discards silently. `SettingsView.swift:414,1104-1133`. Add unsaved-changes indicator.
- 7.5 [med] Status chips never auto-dismiss. `DiscoverView.swift:80-89`, `LibraryView.swift:85-94,217-226`, `DetailView.swift:350-354`. Auto-clear after ~4 s.
- 7.6 [low] No haptic/visual confirmation for positive actions. Consider `NSHapticFeedback`.
- 7.7 [low] Rating sheet pre-fills optimistic defaults (Like, 8/10), biasing data. `RatingFeedbackSheet.swift:33-66`. Require explicit choice.

## 8. Visual design & consistency (12)

- 8.1 [med] Hardcoded `.orange`/`.red` instead of theme tokens. `DetailView.swift:66,566,569,607`.
- 8.2 [low] White-stroke circular badge recipe copy-pasted in 4 places. `DiscoverView.swift:379,395`, `LibraryView.swift:517`, `ContinueWatchingCard.swift:96`. Extract shared `GlyphBadge`.
- 8.3 [med] Page headers inconsistent: `PageHeader` vs title2 vs one-off 28 pt vs breadcrumb. `AppTheme.swift:369-393`, `SearchView.swift:122-124`, `AIAssistantView.swift:40-41`, `LibraryView.swift:405-438`.
- 8.4 [med] History uses stock inset `List` with plain rows while the rest is glass cards. `LibraryView.swift:40-74`.
- 8.5 [low] Settings status presentation has three divergent patterns. `SettingsView.swift:243-252,346-350,565-575`.
- 8.6 [low] Button title casing inconsistent ("Add Watchlist" vs "Mark watched"). `DetailView.swift:271,276,335`.
- 8.7 [low] AI Curated rail uses non-lazy `HStack`; all other rails use `LazyHStack`. `DiscoverView.swift:249`.
- 8.8 [low] Tabs "AI & Sync" and "Imports & Sync" both claim sync. `SettingsView.swift:166-167`.
- 8.9 [low] Discover subtitle "Trending picks, AI-curated for you" renders in no-API-key state. `DiscoverView.swift:19`.
- 8.10 [low] Error color mapping mixes `.red`, `danger`, `warning` for same severity. `StreamListView.swift:88-96`, `DetailView.swift:563-571`.
- 8.11 [low] Rating star reuses `AppTheme.warning` as brand color. `DetailView.swift:164`, `MediaCard.swift:55`, `LibraryView.swift:538`. Add `AppTheme.rating`.
- 8.12 [low] Duplicated close-button implementation. `DetailView.swift:74-85`, `PersonView.swift:184-197`.

## 9. Responsiveness & layout (7)

- 9.1 [med] Fixed non-adjustable panes: nav rail 78 pt, search field 184 pt, AI pane 300 pt, folder sidebar 280 pt. `NavRail.swift:35,102`, `SearchView.swift:18`, `LibraryView.swift:280`. Use resizable/collapsible layouts.
- 9.2 [low] Floating global search overlays content and collides at narrow widths. `ContentView.swift:29-35`.
- 9.3 [low] Season/Episode pickers hard-capped at 160 pt; truncation. `DetailView.swift:510,522`.
- 9.4 [low] `MediaCard` fixed 158 pt even in 180 pt adaptive grids. `MediaCard.swift:7`, `MoodDiscoveryView.swift:29-31`, `PersonView.swift:23-25`.
- 9.5 [low] History rows show both absolute date and relative time. `LibraryView.swift:61-68`.
- 9.6 [med] Cmd+, Settings scene duplicates the in-window SettingsView, double state/loads. `DebridStreamerApp.swift:72-75`, `ContentView.swift:94-95`.
- 9.7 [low] Detail sheets stack recursively; nested 880 pt sheets overflow small screens. `DetailView.swift:94-101`, `PersonView.swift:48-51`.

## 10. Discoverability (11)

- 10.1 [med] Folder management exists only in a right-click menu. `LibraryView.swift:335-351`. Add visible "..." button.
- 10.2 [med] AI provider chips list unconfigured providers that silently fall back. `AIAssistantView.swift:106-121`, `AIAssistantViewModel.swift:89`.
- 10.3 [med] "Suggest Similar To Selected" enabled with nothing selected. `SearchView.swift:221-229`.
- 10.4 [low] Disabled audio/subtitle menus give no reason. `PlayerView.swift:298-326,331-371`.
- 10.5 [med] Only 13 `.help` tooltips app-wide; most icon buttons have none.
- 10.6 [med] Feedback failure glyph communicates error only via tooltip. `DiscoverView.swift:353-355`.
- 10.7 [low] No About/version/diagnostics surface in Settings. `SettingsView.swift:254-268`.
- 10.8 [low-med] No data-management affordances (clear image cache, history, taste profile).
- 10.9 [low] Global search: no Enter hint, keeps stale text, no recents. `NavRail.swift:87-128`.
- 10.10 [low] Personalization alert appears without context. `DiscoverView.swift:61-71`.
- 10.11 [low-med] Subtitle preference is a hardcoded 5-language picker with unclear scope. `SettingsView.swift:509-517`.

## 11. Onboarding (6)

- 11.1 [med] SetupView has no step progress indicator. `SetupView.swift:46-57`.
- 11.2 [med] No indexer/stream-source step; users hit config hints piecemeal. `DetailView.swift:604-608`.
- 11.3 [low] Completion step lacks next-steps pointers. `SetupView.swift:249-271`.
- 11.4 [low] Force-unwrapped URLs in onboarding links. `SetupView.swift:89,145`.
- 11.5 [withdrawn] ~~Setup completion + personalization alert stack back to back.~~ Withdrawn on verification: `saveTasteAndContinue()` sets `setOnboardingTastePromptShown(true)` before advancing to the completion step, and `shouldShowPersonalizationPrompt()` (`AppState.swift:160-161`) returns false once that flag is set, so the two prompts cannot stack.
- 11.6 [low] TMDB validation proceeds even if persisting the key failed. `SetupView.swift:286-294`.

## 12. Performance perception (8)

- 12.1 [high] Stream results render via eager `ForEach` in a `ScrollView`, unbounded. `StreamListView.swift:71-84`, `DetailView.swift:583-593`. Use `LazyVStack` + cap/paginate.
- 12.2 [med] No sort/filter controls on stream results beyond cached-only. `StreamListView.swift:190-211`.
- 12.3 [med] Library grids load full folders at once, no pagination. `LibraryViewModel.swift:264-293,307`.
- 12.4 [low] `allDiscoverPreviews` recomputed on every sync pass. `DiscoverView.swift:591-616`.
- 12.5 [withdrawn] ~~Memory-only image cache; cold launch re-downloads all posters.~~ Withdrawn on verification: `ImageLoader.init()` configures its `URLSession` with a disk-backed `URLCache` (16 MB memory / 256 MB disk) and `.returnCacheDataElseLoad` (`ImageLoader.swift:24-31`), so poster bytes persist across launches. Only the decoded-`NSImage` `NSCache` is memory-only, which costs a re-decode (not a re-download) on cold launch.
- 12.6 [med] Boot blocks up to 8.5 s regardless of init completion. `BootView.swift:86-94`, `ContentView.swift:41-45`.
- 12.7 [low] Overlay status chip covers rail content. `DiscoverView.swift:80-89`.
- 12.8 [low] AIAssistantView animates whole two-pane layout on first result. `AIAssistantView.swift:16-22`.

## 13. Dark mode / appearance (2)

- 13.1 [low] `Color.adaptive` uses unnamed dynamic `NSColor`; can mis-resolve. `AppTheme.swift:11-16`.
- 13.2 [low] No user-selectable appearance override. `SettingsView.swift:254-268`.

## 14. Localization (6)

- 14.1 [high] No localization infrastructure at all; every string hardcoded English. `Package.swift:4-8`.
- 14.2 [low] `"Imported \(added) item(s)"` parenthesized pluralization. `SettingsView.swift:1096-1098`.
- 14.3 [low] `String(format:)` ignores locale decimal separators. `MediaItem.swift:46`, `SettingsView.swift:647`.
- 14.4 [low] Hand-built duration strings instead of `DateComponentsFormatter`. `MediaItem.swift:49-57`, `WatchHistory.swift:37-46`.
- 14.5 [low] AI prompt scaffolding embeds English display strings. `SearchViewModel.swift:170-197`.
- 14.6 [low] Hardcoded English subtitle-language names. `SettingsView.swift:510-517`.

## 15. Copy, style & rule compliance (7)

- 15.1 [low] Em dashes in user-facing tooltips violate project rule. `StreamListView.swift:374,392`.
- 15.2 [low] ~30 em dashes in code comments across the app.
- 15.3 [low] Copy references "Settings > Debrid Services" but the tab is named "Debrid". `StreamListView.swift:145,216,221`.
- 15.4 [low] Arrow glyphs in user copy. `LibraryView.swift:379`.
- 15.5 [low] Exclamation marks in validation copy. `SetupView.swift:97,328`.
- 15.6 [low] "Cinematic Search" vs nav item "Search". `SearchView.swift:122`, `AppState.swift:394`.
- 15.7 [low] Misleading step comment. `SetupView.swift:247`.

## Native top 10

1. 1.1/1.2: operable, labeled cards.
2. 2.1/2.3: player keys + Esc in sheets.
3. 3.1: volume control.
4. 3.2: dead auto-play setting.
5. 3.3/3.4: fake Play/Resume.
6. 4.1: AI generating state.
7. 6.1/6.2: error alert architecture.
8. 7.1: unconfirmed destructive remove.
9. 12.1: unbounded eager stream list.
10. 14.1: no localization.

---

# Part 2: Web app (`web/`) - re-verified against shipping `main` (61c07b9)

79 findings still apply to the shipping web app (66 valid, 13 changed and reworded); 9 were already resolved on `main` and are listed at the end. All file:line references below point at the current shipping tree.

## 1. Accessibility (19)

- A1 [high] No focus trap in any modal; `useModalA11y` moves/restores focus and closes on Escape but never traps Tab, while consumers declare `aria-modal="true"`. `src/components/useModalA11y.ts:37-49`. Add a Tab-cycle trap or `inert` on the rest of the app root.
- A2 [high] Detail overlay added focus move/restore but still lacks dialog semantics (`role="dialog"`/`aria-modal`) and Escape-to-close on the main overlay, and the covered screen behind it is not inerted (only animations paused). `src/screens/Detail.tsx:1211`. Add `role="dialog"`, Escape close, and inert the covered tree.
- A3 [high] Browse overlay still has no dialog semantics, Escape handling, or focus management. `src/screens/Browse.tsx:136`. Reuse `useModalA11y` and add `role="dialog"`.
- A4 [high] Video player added a keymap but still has no Escape-to-close (Escape only dismisses the info panel) and no focus management/restore on the player container. `src/components/VideoPlayer.tsx:943-1022,514`.
- A5 [med] FilterSlideover still stays keyboard-focusable while closed: `aria-hidden={!open}` on the scrim but no `inert`, and the panel keeps `display:flex` (hidden only by opacity/transform). `src/components/FilterSlideover.tsx:131`. Add `inert` on the panel when closed.
- A6 [med] Command palette gained listbox/option roles but the input still lacks combobox linkage (`role="combobox"`, `aria-controls`, `aria-activedescendant`) so active options aren't announced, and it never restores focus to the trigger on close. `src/components/CommandPalette.tsx:198,55-61`.
- A7 [med] Mobile "More" nav sheet still has no dialog role, Escape, or focus trap (only the trigger gained `aria-expanded`/`aria-controls`). `src/components/NavRail.tsx:352-353`.
- A9 [med] Settings tab bar is still chips, not tabs: no `tablist`/`tab`/`tabpanel` roles, no `aria-selected`, no arrow-key nav. `src/screens/Settings.tsx:838-850`.
- A10 [med] Error announcement is partial: `role="alert"` reached several dialogs, but core screen-level error notices still aren't announced. `src/screens/Search.tsx:377`, `src/screens/Assistant.tsx:129`, `src/components/StreamPicker.tsx:265`, `src/screens/DebridLibrary.tsx:250-251`. Create a shared `<ErrorNote role="alert">` and use it at these sites.
- A11 [med] Up-next countdown announces every second via `aria-live="polite"` on the ticking `Playing in {remaining}s` span. `src/components/VideoPlayer.tsx:1193`. Announce once, or use `aria-live="off"` and expose remaining time on demand.
- A12 [low] Update banner live region (`role="status"` aria-live) re-announces on every install percent because the wrapped title text is `Installing… ${pct}%`. `src/components/UpdateBanner.tsx:124-144`. Keep the percent out of the polite live region.
- A13 [med] Captions OpenSubtitles search input has only a placeholder, no accessible name. `src/components/player/CaptionsMenu.tsx:286-296`. Add an `aria-label` or associated `<label>`.
- A14 [low] Color swatches labelled with raw hex and no pressed/selected state exposed to AT. `src/components/ProfilePicker.tsx:949-957`, `src/components/player/CaptionsMenu.tsx:202-213`. Use human names and `aria-pressed`/radio semantics.
- A15 [low] Radiogroups (accent color, subtitle color, privacy mode) lack roving tabindex/arrow-key navigation; every `role="radio"` button is tab-stoppable. `src/screens/Settings.tsx:4448-4468,4542`, also `1347-1363`. Add roving tabindex + arrow-key handling.
- A16 [low] `aria-label` on role-less divs is ignored by AT. `src/screens/Settings.tsx:1792,4156,4963`, `src/screens/Browse.tsx:178`, `src/components/OmdbRatings.tsx:74`. Add an appropriate role (e.g. group/region) or move the label onto a semantic element.
- A17 [low] Hero carousel dots now expose the active slide via tablist/tab `aria-selected`, but labels remain generic (`Featured N of M`) and don't name the title. `src/components/HeroSpotlight.tsx:289-300`. Include the title in each tab's label.
- A18 [low] Search type-filter chips (movie/tv/all) expose no pressed state to AT. `src/screens/Search.tsx:353-362`. Add `aria-pressed` like the sort chips already have.
- A19 [low] Watchlist toggle button missing `aria-pressed`; toggle state conveyed only via class + label. `src/components/DetailHero.tsx:205-212`. Add `aria-pressed={inWatchlist}`.
- A20 [low] SetupNudge wraps interactive buttons in a `role="status"` live region. `src/components/SetupNudge.tsx:22`. Drop the status role (use a plain container/region) so the buttons aren't inside a live region.

## 2. Keyboard support (5)

- K1 [med-high] Escape is now handled in the player and Detail's streams sub-page, but the mobile 'More' nav drawer still closes only via scrim click (no Escape/keydown handler). `web/src/components/NavRail.tsx:274-281`. Give the drawer an Escape-to-close so keyboard users can dismiss the topmost overlay.
- K2 [med] Auto-rotating hero pauses on hover only (`onMouseEnter/onMouseLeave`), with no keyboard-reachable pause/stop control. `web/src/components/HeroSpotlight.tsx:208-209` (interval `139-143`). WCAG 2.2.2 - add a pause toggle and/or pause on focus-within.
- K3 [low] No `/` or Cmd+F shortcut to focus the search pill; only Cmd+K opens the palette. `web/src/components/GlobalSearch.tsx:26-35`, `web/src/App.tsx:333-340`.
- K4 [low] GlobalSearch Escape doesn't clear or blur; the input's `onKeyDown` handles only Enter. `web/src/components/GlobalSearch.tsx:31-33`.
- K5 [med] Only the resolving row is disabled; other stream rows stay clickable, so concurrent resolves of different rows both fire `onPlay`. `web/src/components/StreamPicker.tsx:178,187,534`. Guard on any in-flight resolve (disable all rows / ignore new selects while one resolves).

## 3. Navigation & routing (5)

- N1 [high] No URL/history integration: navigation is pure React state, so refresh lands on Discover, there are no deep links, and browser Back exits the app instead of closing the topmost overlay. `src/store/AppStore.tsx:509-514`. Sync route/detail/browse state to `history.pushState` and handle `popstate`.
- N2 [med] Scroll position persists across screens: the scroll container `.app-content` is the persistent parent of the per-route keyed frame, so navigating leaves the previous screen's scrollTop. `src/App.css:22-31`, `src/App.tsx:594,611`. Reset the scroller's scrollTop on navigate.
- N3 [high] Mobile users cannot switch profiles: the switch button is `data-mobile="false"` (hidden by `display:none` in the mobile query) and is absent from the More drawer, which only lists nav screens. `src/components/NavRail.tsx:296-297,352-394`, `NavRail.css:355-357`. Add the profile switcher to the More sheet on mobile.
- N5 [med] Assistant recommendations are dead ends: result cards render as static divs (title/year/score/reason) with no way to open Detail, add to watchlist, or play. `src/screens/Assistant.tsx:136-153`. Resolve each rec via TMDB and make the card open Detail, as the Search mood flow already does.
- N7 [low] `document.title` never changes per screen: the static `<title>DebridStreamer - Discover</title>` is never updated, so every screen reads as "Discover" in the tab/history. `index.html:17`. Set document.title from the active route.

## 4. Error handling (6)

- E1 [high] Discover still shows fixture data on live failure with no on-screen indication. The hook now tracks `source`/`error` (`src/data/discover.ts:156-222`) but `Discover.tsx:34` consumes only `{data, loading, railsLoading}` and never surfaces them. Add a dismissible banner + Retry driven by the hook's `source==='fixtures'`/`error`.
- E2 [high] Browse only surfaces the fixture fallback for the no-key genre case (`src/screens/Browse.tsx:170-175`); live-failure fallbacks (`src/data/browse.ts:533-542`) stay silent for category/discover/search contexts and `state.error` is never rendered with a Retry. Show the error + Retry for any `source==='fixtures'` caused by a live failure.
- E3 [high] Debrid deletes (single + bulk) still hit the real account with no confirmation or undo. `src/screens/DebridLibrary.tsx:97-124` (deleteRows), fired directly from onClick at `:242` and `:397`. Reuse ProfilePicker's two-step arm pattern or add an undo window.
- E4 [med] Leaving Settings still discards unsaved changes with no warning. `navigate()` has no dirty guard (`src/store/AppStore.tsx:509-514`) and the local `draft` is dropped on unmount; a `hasUnsavedChanges` indicator exists (`src/screens/Settings.tsx:776`) but nothing blocks navigation. Prompt on navigate when dirty (and add a `beforeunload` guard).
- E6 [low] "Remove source" still deletes an indexer + its key in one click with no confirmation (`src/screens/Settings.tsx:5425-5427`, button `:5578-5579`); the removal is now staged in the unsaved draft (reverts if you leave without saving) rather than persisted immediately. Add an inline confirm on the Remove button.
- E7 [low] Library error state still has no Retry. `src/screens/Library.tsx:364-370` renders an EmptyState with no `actions` (subtitle says "Try reopening the app"), despite a reusable `load()` at `:54`. Add a Retry action calling load().

## 5. Loading states (3)

- L2 [med] Player still has no buffering indicator (no `onWaiting`/`onPlaying`/`stalled` handling anywhere in the file, no spinner in the render) and autoplay rejection is silently swallowed. `src/components/VideoPlayer.tsx:1035-1052` (video uses `autoPlay` + native `controls`); `play()` calls at `:729` and `:1027` use empty `.catch(() => {})`. Add `waiting`/`playing` state + surface a play affordance on rejection.
- L3 [low] Assistant loading is still only the button text (`loading ? "Thinking…" : "Recommend"`) + disabled state for a 5-30 s call; the results area shows nothing until the call returns. `src/screens/Assistant.tsx:103-110`. Add a skeleton/spinner in the results region.
- L4 [low] Skeleton a11y still inconsistent: `DiscoverSkeleton` (`src/screens/Discover.tsx:162-181`) and `BrowseSkeleton` (`src/screens/Browse.tsx:361-369`) render redacted grids with no `role="status"`/`aria-busy`; the progressive `RailSkeleton` only sets `aria-hidden`. Add `role="status"`/`aria-busy` for screen-reader parity.

## 6. Feedback & empty states (4)

- F1 [med] Still no general toast/notification system; async actions give inline-only or zero confirmation. The only "toast" is the update-specific `UpdateBanner` (`src/components/UpdateBanner.tsx`). Add a shared toast host (`role="status"`, auto-dismiss).
- F2 [low] Successful debrid deletes still give no confirmation: `deleteRows` (`src/screens/DebridLibrary.tsx:97-124`) clears selection and reloads on success; only failures set `actionError` (:116-120). No success toast/inline confirmation. (Blocked on F1.)
- F3 [low] Watchlist removal still has no undo: the per-card remove button calls `removeFromWatchlist(item.id)` directly on click with no confirmation or undo affordance. `src/screens/Watchlist.tsx:525-533`.
- F4 [low] Still no way to clear watch history: `History` (`src/screens/History.tsx:56-112`) only renders the history grid + Continue Watching; there is no clear-all or per-item removal control.

## 7. Visual design & consistency (5)

- V1 [med] ServerModeGate uses a bespoke theme-ignoring palette (hardcoded `#080b12`, `#f8fafc`, `#e5f0ff`, `#08111f`, `#fecaca`). `src/components/ServerModeGate.css:11-12,70-71,83`.
- V2 [low] Scattered hardcoded colors bypass tokens. `MediaCard.css:79-82,236-237,288`, `NavRail.css:143,163,408-421`, `HeroSpotlight.css:100-141`, `Settings.css:469-470,868,1990,2243`, `VideoPlayer.css:26,188`.
- V3 [med] Player shows two competing seek bars (native `<video controls>` + custom WebviewScrubber/ScrubBar). `src/components/VideoPlayer.tsx:1038,1078`. Drop one.
- V5 [low] Search overrides card reveal with `!important`. `src/screens/Search.css:114,125-126`. Use a `variant` prop.
- V6 [low] Five+ hand-rolled skeleton implementations (DiscoverSkeleton, RailSkeleton, BrowseSkeleton, SearchSkeleton, StreamPicker). `src/screens/Discover.tsx:145,162`, `src/screens/Browse.tsx:361`, `src/screens/Search.tsx:86`, `src/components/StreamPicker.tsx:323`. Consolidate into `<SkeletonGrid>`.

## 8. Responsiveness & mobile (4)

- R1 [med] DebridLibrary table: no media queries, no table semantics, 7 fixed columns squeeze below ~700 px. `src/screens/DebridLibrary.css:79`, `DebridLibrary.tsx:327-361`. Add breakpoints + table roles.
- R3 [low] Scrub thumbnail tooltip overflows player edges (hoverX unclamped, translateX(-50%) on a 168px thumb). `src/components/player/ScrubBar.tsx:143`, `src/components/VideoPlayer.css:329-345`. Clamp left to the bar bounds.
- R4 [low] Chip touch targets are 32 px (36 px under 860 px), below 44 px guidance. `src/theme/theme.css:824,844-848`.
- R5 [low] Player OSD control strip still has no small-screen handling: fixed 24px padding, non-wrapping chip row, no size breakpoints (only reduced-motion). `src/components/VideoPlayer.css:203-224`. (Captions menu + up-next card now clamp to vw.)

## 9. Forms & validation (6)

- Fo1 [low-med] Search fields aren't `type="search"`, no `enterKeyHint`, GlobalSearch still has no submit button. `src/components/GlobalSearch.tsx:26-35`, `src/screens/Search.tsx:319-333`.
- Fo2 [low] Debrid filter still updates with no debounce (in-memory filter, low impact). `src/screens/DebridLibrary.tsx:217,64-74`. (Catalog search now has 300ms debounced live-search: `Search.tsx:251-254`.)
- Fo3 [med] Custom indexer URL still has no test-connection / Torznab caps probe and no inline validation feedback; input is now `type="url"` (browser-native only). `src/screens/Settings.tsx:5614-5622`. Add a caps test + explicit validation.
- Fo4 [low] Auth forms lack a show/hide password toggle (pattern exists in Settings). `src/components/ServerModeGate.tsx:409-419`.
- Fo5 [low] Login still enforces `minLength={8}`, blocking legacy shorter passwords. `src/components/ServerModeGate.tsx:417`.
- Fo6 [low] Year filter inputs give no inline feedback before the plausibility clamp silently drops invalid values. `src/components/FilterSlideover.tsx:212-234,370-375`.

## 10. Discoverability (4)

- D1 [med] Cmd+K palette still has no persistent visible entry point: the GlobalSearch pill shows no ⌘K keycap and the rail has no palette button; only the one-time WelcomeGuide tour mentions it. `web/src/components/GlobalSearch.tsx:23-47`. Add a ⌘K kbd hint in the pill / a rail button.
- D2 [low] The player now has its own in-context '?' shortcuts overlay, but the GLOBAL keyboard-shortcuts reference sheet is still reachable only via the ⌘K palette (`web/src/components/CommandPalette.tsx:120-125` → `App.tsx:437-441`) with no link from Settings. Add a Settings entry point for the global sheet.
- D3 [low] Save bar still vanishes on the Install & setup tab with no explanation. `web/src/screens/Settings.tsx:796` (`tab !== "install"` gate). Show a note that this tab has no saveable settings, or keep the bar in a disabled/informational state.
- D4 [low] Debrid table still has no sort controls: column headers are static `<span>`s. `web/src/screens/DebridLibrary.tsx:352-357`. Make Name/Size/Status/Added/Host headers clickable sortable columns with `aria-sort`.

## 11. Theming & dark mode (3)

- T1 [low-med] Still no 'follow system' theme option; THEMES is a fixed list (aurora/light/midnight/sunset) and nothing reads `prefers-color-scheme`. `web/src/theme/themes.ts:35-68`. Add a system-following option via `matchMedia`.
- T2 [low] Boot-time theme script duplicates the valid-theme list (`web/index.html:26`) so new themes won't boot-apply, and its default-removal is stale: it strips data-theme for `aurora` while applyTheme's default is now `midnight` (`web/src/theme/themes.ts:84,117`), causing a FOUC for Aurora users (real `[data-theme="aurora"]` block at `theme.css:224`). `web/index.html:24-39`. Derive the list/default from a shared source.
- T3 [low] `theme-color` meta is still a static `#111827` (`web/index.html:6`) and no code updates it per theme (no `theme-color` writers in src). Sync it to the active theme's background in applyTheme.

## 12. Reduced motion (3)

- M1 [low] Ambient background videos now respect reduced-motion (hidden via `prefers-reduced-motion` in `AmbientVideo.css:16-20`), but still ignore data saver / Save-Data: the loop autoplays and preloads unconditionally. `src/components/AmbientVideo.tsx:19-33`. Gate autoplay/preload on `navigator.connection.saveData`.
- M2 [med] Hero auto-rotation ignores reduced motion: the rotate interval (`src/components/HeroSpotlight.tsx:139-143`) and the Ken Burns zoom (`HeroSpotlight.css:37-39`) both keep running under `prefers-reduced-motion`. Gate the interval with the existing `prefersReducedMotion()` (`src/lib/reducedMotion.ts`) and disable the keyframe in a reduced-motion media query.
- M3 [low] JS `scrollIntoView({behavior:"smooth"})` ignores reduced-motion. `src/screens/Detail.tsx:469,1278`. Pass `behavior: prefersReducedMotion() ? "auto" : "smooth"` using `src/lib/reducedMotion.ts`.

## 13. Images & fallbacks (3)

- I2 [low-med] Hero backdrop has no runtime error fallback: only a null-URL gradient branch exists, so a poster URL that 404s shows the broken-image glyph. `src/components/HeroSpotlight.tsx:230-244`. Add `onError` to fall back to `hero-gradient` (as DetailHero.tsx:94 already does for its backdrop).
- I3 [low] Detail poster lacks `onError` fallback (the backdrop got one, the poster did not). `src/components/DetailHero.tsx:119-126`. Add `onError` to swap in a placeholder tile.
- I4 [low] Cast photos, calendar posters/thumbs, and episode stills still lack load-error handling (placeholder shown only when the URL is absent, not on 404). `src/components/CastRail.tsx:36-42`, `src/screens/Calendar.tsx:121,283-289`, `src/components/EpisodePicker.tsx:306-312`. Add a shared `<ImgWithFallback>` (still absent).

## 14. Perceived performance (2)

- P1 [low] DebridLibrary table renders all rows eagerly with no windowing; other large grids (Browse/Watchlist/History/Library) were fixed via VirtualMediaGrid but the debrid table was not. `web/src/screens/DebridLibrary.tsx:358`. Window the table rows.
- P3 [low] Hero still fetches each backdrop twice on first view: the displayed `<img>` is non-CORS while the accent probe forces `crossOrigin="anonymous"`, so they don't share the browser cache. `web/src/components/HeroSpotlight.tsx:179-191` (probe) vs `:231` (display). An accentCache now avoids re-probing on repeats, but the first-view double download remains.

## 15. Localization (2)

- Lo1 [med-low] No i18n infrastructure; all strings hardcoded English, no language setting in AppSettings. `web/src/data/settings.ts:191`.
- Lo2 [low] Locale-aware dates mixed with hardcoded English bucket/relative labels. `web/src/data/calendar.ts:107-109`, `web/src/screens/Calendar.tsx:40-63`.

## 16. Meta / SEO (2)

- S1 [low] No meta description or Open Graph tags. `web/index.html:3-17`.
- S2 [low] Static `<title>` never updated per screen; no runtime `document.title` writes. `web/index.html:17`.

## 17. Onboarding (3)

- O1 [med] TierOnboarding declares `role="dialog" aria-modal="true"` but has no keyboard support (no Escape handler) and no focus management (nothing moves focus into the card, no focus trap). `src/components/TierOnboarding.tsx:74`.
- O2 [med] WelcomeGuide declares an `aria-modal` dialog and now handles keys (Esc/arrows/Enter, lines 89-102) but still never moves focus into the card and has no focus trap. `src/components/WelcomeGuide.tsx:104-110`.
- O3 [low] First-run wizards lack dialog semantics (no `role="dialog"`/`aria-modal` on the root) and don't move focus to the step on change - only scattered per-input `autoFocus`, no container focus. `src/components/FirstRunWizard.tsx:297`, `src/components/ServerSetupWizard.tsx:101`.

## Resolved on `main` since the audit (9)

These findings from the original audit are already fixed on the shipping line and need no action:

- ~~A8~~ The genre tile is now a plain native button: `src/components/GenreCatalogGrid.tsx:131` renders `<button type="button" ... aria-label={...}>` with no `role` override. The `role="listitem"` that erased button semantics is gone (grep for role="listitem" in the file returns nothing).
- ~~E5~~ updateSettings now reports the outcome: it returns `{ok:false}` when saveSettingsToStore rejects instead of throwing (AppStore.tsx:582-603). Settings' save handler checks `result.ok` and on failure sets `setSaved(false)` + a visible saveError "Could not save to this device. Your changes apply for now, but will be lost when the app restarts." (Settings.tsx:699-711), rendered as saveNote at Settings.tsx:782-783, and the save label no longer claims "Saved" on a failed persist. The console-only-then-"Saved" behavior is gone.
- ~~I1~~ MediaCard now renders a designed fallback on load failure: `const [failed, setFailed] = useState(false)` (MediaCard.tsx:68), `const showFallback = poster == null || failed` (line 69), the fallback tile is rendered when `showFallback` (line 96), and the poster `<img onError={() => { ...; setFailed(true); }}` (lines 121-123) swaps it in instead of the broken-image glyph.
- ~~L1~~ The first-run gate no longer returns a blank/opaque screen. src/App.tsx:245-259 now renders a boot splash while async checks resolve: a full-height themed container (background var(--bg-1,#0a0b16)) with aria-busy="true" and <Spinner label="Starting DebridStreamer" />. The block comment at src/App.tsx:148 explicitly states it "Renders boot chrome while async checks resolve, avoiding a blank opaque" screen. This is exactly the boot splash the finding asked for.
- ~~N4~~ CastRail now only renders a `<button>` when an `onSelect` handler is passed; without it (CastRail.tsx:56-70) each card is a plain non-focusable `<div>` with no pointer cursor, hover lift, or tab stop. Detail renders `<CastRail cast={detail.data.cast} />` (Detail.tsx:1566) with no onSelect, so the cards no longer look tappable. The fake affordance is gone.
- ~~N6~~ The mood rail moved off Discover to the Search screen (Discover.tsx:6-7 comment; every Discover "See all" now opens a proper category Browse context). On Search, the no-AI fallback maps the vibe to TMDB genre/year filters via moodBrowseFilters() (Search.tsx:31-60) and opens `openBrowse({kind:"discover", ... filters})` (Search.tsx:201); the AI path resolves recommendations through TMDB search (resolveRecommendation, Search.tsx:145-171). The raw-vibe-string-as-title-query behavior the finding called out no longer exists.
- ~~P2~~ MediaCard no longer runs spring physics. MediaCard.tsx has no framer-motion / useSpring import; it renders a plain `<button>` (line 83) and the header comment (lines 4-6) states "Hover and reveal effects are CSS-only so large grids do not instantiate animation controllers per card." Hover lift/scale and the reveal layer are pure CSS (.media-card-reveal, line 158). No per-card animation controller remains.
- ~~R2~~ GlobalSearch.css now has a dedicated breakpoint for the exact cited band: `@media (min-width:700px) and (max-width:1199px){ .global-search{ width: min(520px, calc(100% - 48px)); } }` (GlobalSearch.css:54-58), plus a `<700px` rule that makes the pill sticky/in-flow (GlobalSearch.css:43-52). The pill width is clamped so it no longer overhangs content in the 700-1100px range.
- ~~V4~~ VideoPlayer.css no longer references any of the nonexistent tokens `--radius-lg`, `--glass-rest`, or `--border` (grep returns zero matches). The file was rewritten to use the real design tokens: `--r-lg`/`--r-md`/`--r-sm`/`--r-pill` for radius (e.g. lines 334,347,368,479) and `--glass-tint-control`/`--glass-border` for surfaces (e.g. lines 398-399,477-478).

---

# Cross-platform improvement themes (dedup view)

| Theme | Native | Web |
|---|---|---|
| Missing accessibility labels/semantics on controls | 1.1-1.10 | A1-A9, A13-A20 |
| Escape/keyboard inconsistency in overlays | 2.3, 2.4 | K1, A2-A4 |
| Destructive actions without confirmation | 7.1-7.4 | E3, E6 |
| No toast/status notification system | 6.1 | F1 |
| Errors swallowed or misreported | 6.2-6.5 | E1, E2 |
| Player UX gaps | 3.1-3.9 | V3, L2, K5, A11 |
| Fake/dead affordances | 3.3, 3.4, 3.2, 10.3 | N5 |
| Unbounded eager lists | 12.1, 12.3 | P1 |
| Image fallback/caching gaps | 4.6 | I2-I4 |
| No localization | 14.1 | Lo1 |
| Reduced motion ignored | 1.15 | M1-M3 |
| Onboarding lacks progress/focus handling | 11.1-11.3 | O1-O3 |
| Settings state hazards (unsaved changes, duplicated scenes) | 7.4, 9.6 | E4 |
