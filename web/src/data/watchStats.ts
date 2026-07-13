// Watch-stats aggregation - pure functions over the durable history + taste
// events, powering the opt-in insights card on the History screen.
//
// History records (WatchHistoryRecord, from getStore().listHistory()) carry the
// duration + timestamp needed for time-watched / completion / streak. Genres are
// NOT on the preview, so "favorite genres" are derived from `liked` taste events,
// which stamp a comma-joined `genres` string into their metadata (see Detail's
// recordTasteSignal). All day math is done in LOCAL time so a late-evening watch
// isn't bucketed into the wrong calendar day (mirrors the calendar fix).

import type {
  TasteEventRecord,
  WatchHistoryRecord,
} from "../storage/models";

interface GenreCount {
  genre: string;
  count: number;
}

export interface WatchStats {
  /** Approximate seconds watched: full duration for completed items, else the
   *  resume position. */
  totalSeconds: number;
  /** Distinct history rows counted (movies + episodes). */
  titles: number;
  /** How many are marked completed. */
  completed: number;
  /** completed / titles, 0 when there's no history. */
  completionRate: number;
  /** Consecutive local days ending today (or yesterday) with a watch. */
  streakDays: number;
  /** Whether the streak includes today. */
  streakOngoing: boolean;
  /** Distinct local days with any watch. */
  activeDays: number;
  /** Top genres from `liked` taste events, most-liked first. */
  favoriteGenres: GenreCount[];
}

/** Seconds credited for one record: a completed title counts its full runtime,
 * an in-progress one counts the resume position. */
function watchedSeconds(r: WatchHistoryRecord): number {
  if (r.completed && r.durationSeconds != null && r.durationSeconds > 0) {
    return r.durationSeconds;
  }
  return Math.max(0, r.progressSeconds);
}

/** A local-time day bucket key, or null for an unparseable timestamp. */
function localDayKey(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function parsedLocalDayKey(iso: string): string | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return localDayKey(d);
}

/** Genres from a single taste event's metadata (comma-joined string). */
function genresFromEvent(event: TasteEventRecord): string[] {
  const raw = event.metadata?.genres;
  if (typeof raw !== "string") return [];
  return raw
    .split(",")
    .map((g) => g.trim())
    .filter((g) => g.length > 0);
}

/** Top genres from `liked` taste events, tallied by occurrence. */
function favoriteGenres(events: TasteEventRecord[], limit = 5): GenreCount[] {
  const counts = new Map<string, number>();
  for (const e of events) {
    if (e.eventType !== "liked") continue;
    for (const g of genresFromEvent(e)) {
      counts.set(g, (counts.get(g) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([genre, count]) => ({ genre, count }))
    // Most-liked first; ties broken alphabetically for a stable order.
    .sort((a, b) => b.count - a.count || a.genre.localeCompare(b.genre))
    .slice(0, limit);
}

/** Current daily streak (local time): the run of consecutive days ending today,
 * or ending yesterday if nothing has been watched yet today. */
function currentStreak(
  dayKeys: Set<string>,
  now: Date,
): { streakDays: number; streakOngoing: boolean } {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const todayKey = localDayKey(today);
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);

  // Anchor on the most recent watched day within reach (today, else yesterday).
  let cursor: Date | null = dayKeys.has(todayKey)
    ? today
    : dayKeys.has(localDayKey(yesterday))
      ? yesterday
      : null;

  let streakDays = 0;
  while (cursor != null && dayKeys.has(localDayKey(cursor))) {
    streakDays += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return { streakDays, streakOngoing: dayKeys.has(todayKey) };
}

/** Aggregate a WatchStats snapshot. `now` is injectable for deterministic tests;
 * the app calls it with the real clock. */
export function computeWatchStats(
  records: WatchHistoryRecord[],
  tasteEvents: TasteEventRecord[],
  now: Date = new Date(),
): WatchStats {
  let totalSeconds = 0;
  let completed = 0;
  const dayKeys = new Set<string>();
  for (const r of records) {
    totalSeconds += watchedSeconds(r);
    if (r.completed) completed += 1;
    const key = parsedLocalDayKey(r.lastWatched);
    if (key != null) dayKeys.add(key);
  }
  const titles = records.length;
  const { streakDays, streakOngoing } = currentStreak(dayKeys, now);
  return {
    totalSeconds,
    titles,
    completed,
    completionRate: titles > 0 ? completed / titles : 0,
    streakDays,
    streakOngoing,
    activeDays: dayKeys.size,
    favoriteGenres: favoriteGenres(tasteEvents),
  };
}

/** Whether there's enough signal to be worth rendering the card. */
export function hasWatchStats(stats: WatchStats): boolean {
  return stats.titles > 0;
}

/** "3h 42m" / "42m" / "0m" from a second count. */
export function formatWatchTime(totalSeconds: number): string {
  const mins = Math.floor(totalSeconds / 60);
  const hours = Math.floor(mins / 60);
  const remMins = mins % 60;
  if (hours > 0) return `${hours}h ${remMins}m`;
  return `${remMins}m`;
}
