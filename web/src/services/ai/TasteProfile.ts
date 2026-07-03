// TasteProfile — assembles a short plain-text "taste profile" from the user's
// own local signals (recent taste events incl. like/dislike, watch history, and
// watchlist), to personalize the "Would I Like This?" analysis.
//
// Ported from VPStudio's AssistantContextAssembler (the context-notes half): it
// applies a ~90-day linear recency decay (floored at 0.1) so recent signals
// dominate, then emits a compact, plain-text context the AI prompt prefixes onto
// the title being analyzed. When there is no signal at all it returns "" — the
// caller still works (the analysis is then non-personalized).
//
// Where VPStudio reads a denormalized UserTasteProfile (liked/disliked genres),
// the web data model doesn't carry genre ids on MediaPreview, so liked/disliked
// genres are derived from the genre names stamped into like/dislike taste-event
// metadata (DetailHero records the MediaItem's genres when the user thumbs a
// title), with the media cache used to label recently-watched/liked/disliked
// titles. The result is capped under ~1500 chars and cached for 24h in the
// settings KV table so repeated Detail visits don't re-walk history every time.

import type { Store } from "../../storage/types";
import type { TasteEventRecord } from "../../storage/models";

/** Recency-decay window (days) — signals older than this floor at the minimum
 * weight. Mirrors VPStudio's `recencyWindowDays`. */
const RECENCY_WINDOW_DAYS = 90;
/** The minimum recency weight, so old signals still count a little. Mirrors
 * VPStudio's `recencyFloor`. */
const RECENCY_FLOOR = 0.1;

/** Hard cap on the emitted context length (chars). */
const MAX_CONTEXT_CHARS = 1500;

/** Settings KV key the assembled context is cached under (value is a JSON
 * `{ context, builtAt }` envelope). */
const CACHE_KEY = "tasteContextCache";
/** Cache TTL — 24h. */
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

/** A cached taste-context envelope persisted in the settings KV table. */
interface CachedTasteContext {
  context: string;
  /** ISO-8601 of when it was assembled. */
  builtAt: string;
}

/** Linear recency weight over a 90-day window, floored at 0.1. Mirrors
 * VPStudio's `recencyDecay`. */
export function recencyDecay(createdAt: string, now = Date.now()): number {
  const ms = now - new Date(createdAt).getTime();
  if (!Number.isFinite(ms)) return RECENCY_FLOOR;
  const days = ms / 86_400_000;
  // Clamp to [RECENCY_FLOOR, 1]: a future-dated createdAt (clock skew / NTP
  // correction) makes `days` negative, which would otherwise inflate the weight
  // above 1.0 and over-contribute to the genre tallies.
  return Math.min(1, Math.max(RECENCY_FLOOR, 1 - days / RECENCY_WINDOW_DAYS));
}

/** Genre names stamped into a like/dislike taste event's metadata. DetailHero
 * writes the current MediaItem's genres as a comma-joined string under
 * `genres`; older events without it simply contribute no genre signal. */
function genresFromEvent(event: TasteEventRecord): string[] {
  const raw = event.metadata?.genres;
  if (typeof raw !== "string" || raw.trim().length === 0) return [];
  return raw
    .split(",")
    .map((g) => g.trim())
    .filter((g) => g.length > 0);
}

/** The display title stamped into a taste event's metadata (DetailHero writes
 * `title`), or null when absent. */
function titleFromEvent(event: TasteEventRecord): string | null {
  const raw = event.metadata?.title;
  return typeof raw === "string" && raw.trim().length > 0 ? raw.trim() : null;
}

/** Push a unique (case-insensitive) value, preserving order and a cap. */
function pushUnique(list: string[], value: string, seen: Set<string>, cap: number): void {
  const key = value.toLowerCase();
  if (seen.has(key) || list.length >= cap) return;
  seen.add(key);
  list.push(value);
}

/**
 * Build a short plain-text taste-profile context for the current user, reading
 * recent taste events / history / watchlist from the Store. Returns "" when
 * there is no usable signal. Caches the result for 24h in the settings KV.
 */
export async function buildTasteContext(
  store: Store,
  options: { now?: number; useCache?: boolean } = {},
): Promise<string> {
  const now = options.now ?? Date.now();
  const useCache = options.useCache ?? true;

  if (useCache) {
    const cached = await readCache(store, now);
    if (cached != null) return cached;
  }

  const context = await assembleTasteContext(store, now);

  if (useCache) {
    await writeCache(store, context, now);
  }
  return context;
}

/** Force a fresh assembly, bypassing (and refreshing) the 24h cache. */
export async function rebuildTasteContext(store: Store, now = Date.now()): Promise<string> {
  const context = await assembleTasteContext(store, now);
  await writeCache(store, context, now);
  return context;
}

async function readCache(store: Store, now: number): Promise<string | null> {
  const raw = await store.getSetting(CACHE_KEY);
  if (raw == null) return null;
  try {
    const parsed = JSON.parse(raw) as CachedTasteContext;
    if (typeof parsed.context !== "string" || typeof parsed.builtAt !== "string") {
      return null;
    }
    const age = now - new Date(parsed.builtAt).getTime();
    if (!Number.isFinite(age) || age < 0 || age > CACHE_TTL_MS) return null;
    return parsed.context;
  } catch {
    return null;
  }
}

async function writeCache(store: Store, context: string, now: number): Promise<void> {
  const envelope: CachedTasteContext = {
    context,
    builtAt: new Date(now).toISOString(),
  };
  await store.setSetting(CACHE_KEY, JSON.stringify(envelope));
}

/** The actual assembly: weighted genre signals + a handful of titles. */
async function assembleTasteContext(store: Store, now: number): Promise<string> {
  const [events, history, watchlist] = await Promise.all([
    store.recentTasteEvents(200).catch(() => [] as TasteEventRecord[]),
    store.listHistory(40).catch(() => []),
    store.listWatchlist().catch(() => []),
  ]);

  // Weighted genre tallies from explicit like/dislike signals. A recently-liked
  // sci-fi title pushes "Science Fiction" up the liked list (and the reverse for
  // dislikes), with the 90-day decay so stale signals fade.
  const likedGenreScore = new Map<string, number>();
  const dislikedGenreScore = new Map<string, number>();
  const likedTitles: string[] = [];
  const dislikedTitles: string[] = [];
  const likedSeen = new Set<string>();
  const dislikedSeen = new Set<string>();
  // Numeric ratings (1–10 / 0–100), collected with their normalized /10 score.
  const ratedHigh: string[] = [];
  const ratedLow: string[] = [];
  const ratedHighSeen = new Set<string>();
  const ratedLowSeen = new Set<string>();
  // Only the newest rating per title counts (events arrive newest-first), so a
  // re-rate supersedes the old score instead of stacking or contradicting it.
  const ratedSeen = new Set<string>();

  for (const event of events) {
    const weight = recencyDecay(event.createdAt, now);

    if (event.eventType === "liked" || event.eventType === "disliked") {
      const target = event.eventType === "liked" ? likedGenreScore : dislikedGenreScore;
      for (const genre of genresFromEvent(event)) {
        target.set(genre, (target.get(genre) ?? 0) + weight);
      }
      const title = titleFromEvent(event);
      if (title != null) {
        if (event.eventType === "liked") pushUnique(likedTitles, title, likedSeen, 8);
        else pushUnique(dislikedTitles, title, dislikedSeen, 8);
      }
      continue;
    }

    if (event.eventType === "rated") {
      const title = titleFromEvent(event);
      // Dedupe by the stable media id (falling back to title) so two different
      // titles that happen to share a name don't collide, and a re-rate of the
      // SAME media is superseded by its newest event. The seen-check comes FIRST
      // (before reading norm) so a newest "cleared" rating — one with no norm —
      // still suppresses an older score for that media instead of letting it leak.
      const key =
        event.mediaId != null && event.mediaId.length > 0
          ? `id:${event.mediaId}`
          : title != null
            ? `t:${title.toLowerCase()}`
            : null;
      if (key != null) {
        if (ratedSeen.has(key)) continue; // older duplicate — newest already decided
        ratedSeen.add(key);
      }
      // metadata.norm is the rating on a [0,1] scale, so it feeds the profile the
      // same way regardless of whether the user rates out of 10 or 100. A cleared
      // rating has no norm → NaN → contributes nothing (media already marked seen).
      const norm = Number(event.metadata?.norm);
      if (!Number.isFinite(norm)) continue;
      const clamped = Math.min(1, Math.max(0, norm));
      // Scale the genre signal by distance from neutral (5/10): a 10/10 counts
      // like a full like, a 7/10 as a partial one, a 5/10 as nothing.
      const magnitude = Math.abs(clamped * 2 - 1);
      const scoreOutOf10 = Math.round(clamped * 10);
      if (clamped >= 0.7) {
        for (const genre of genresFromEvent(event)) {
          likedGenreScore.set(genre, (likedGenreScore.get(genre) ?? 0) + weight * magnitude);
        }
        if (title != null) {
          pushUnique(ratedHigh, `${title} (${scoreOutOf10}/10)`, ratedHighSeen, 8);
        }
      } else if (clamped <= 0.4) {
        for (const genre of genresFromEvent(event)) {
          dislikedGenreScore.set(genre, (dislikedGenreScore.get(genre) ?? 0) + weight * magnitude);
        }
        if (title != null) {
          pushUnique(ratedLow, `${title} (${scoreOutOf10}/10)`, ratedLowSeen, 8);
        }
      }
      continue;
    }
  }

  // Recently-watched titles (newest first) — already recency-ordered by the
  // Store, so just take the display titles off the previews.
  const recentlyWatched: string[] = [];
  const watchedSeen = new Set<string>();
  for (const row of history) {
    pushUnique(recentlyWatched, row.preview.title, watchedSeen, 10);
  }

  // Watchlist titles (most-recently-added first).
  const watchlistTitles: string[] = [];
  const wlSeen = new Set<string>();
  for (const row of watchlist) {
    pushUnique(watchlistTitles, row.preview.title, wlSeen, 10);
  }

  const likedGenres = topGenres(likedGenreScore, 6);
  const dislikedGenres = topGenres(dislikedGenreScore, 6);

  const notes: string[] = [];
  if (likedGenres.length > 0) {
    notes.push(`Liked genres: ${likedGenres.join(", ")}`);
  }
  if (dislikedGenres.length > 0) {
    notes.push(`Disliked genres: ${dislikedGenres.join(", ")}`);
  }
  if (likedTitles.length > 0) {
    notes.push(`Liked titles: ${likedTitles.join(", ")}`);
  }
  if (dislikedTitles.length > 0) {
    notes.push(`Disliked titles: ${dislikedTitles.join(", ")}`);
  }
  if (ratedHigh.length > 0) {
    notes.push(`Rated highly: ${ratedHigh.join(", ")}`);
  }
  if (ratedLow.length > 0) {
    notes.push(`Rated low: ${ratedLow.join(", ")}`);
  }
  if (recentlyWatched.length > 0) {
    notes.push(`Recently watched: ${recentlyWatched.join(", ")}`);
  }
  if (watchlistTitles.length > 0) {
    notes.push(`On my watchlist: ${watchlistTitles.join(", ")}`);
  }

  if (notes.length === 0) return "";

  // Join, then trim to budget on a line boundary so the context stays coherent.
  let context = notes.join("\n");
  if (context.length > MAX_CONTEXT_CHARS) {
    context = context.slice(0, MAX_CONTEXT_CHARS);
    const lastNewline = context.lastIndexOf("\n");
    if (lastNewline > 0) context = context.slice(0, lastNewline);
  }
  return context;
}

/** The top-N genres by descending weighted score (ties broken alphabetically
 * for a stable output). */
function topGenres(scores: Map<string, number>, limit: number): string[] {
  return [...scores.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([genre]) => genre);
}
