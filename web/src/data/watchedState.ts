// Watched-state derivation - a pure mapping from a stored watch record to one of
// three display states used by the poster check badge + the Detail indicator:
//   watched    - finished (the player marks a row completed at >= 95%, or an
//                explicit completed flag from a "mark watched" toggle)
//   inProgress - a real resume point (>2% and <95%, the same window the Continue
//                Watching rail uses via hasResumePoint)
//   unwatched  - no record, or barely-started / zeroed progress
//
// The 0.95 completion threshold matches what the player persists (see
// AppStore.recordResume: completed = progress/duration >= 0.95) and the upper
// bound hasResumePoint treats as "finished". Kept pure + dependency-free so it is
// trivially testable and reusable across surfaces.

import {
  hasResumePoint,
  watchProgressPercent,
  type WatchHistoryRecord,
} from "../storage/models";

export type WatchedState = "watched" | "inProgress" | "unwatched";

/** Progress fraction at/above which a title counts as watched. Mirrors the
 * completion cutoff in AppStore.recordResume and hasResumePoint's upper bound. */
export const WATCHED_THRESHOLD = 0.95;

/** Map a single watch-history record to its display state. A null/absent record
 * is unwatched. */
export function watchedStateForRecord(
  record: WatchHistoryRecord | null | undefined,
): WatchedState {
  if (record == null) return "unwatched";
  if (record.completed || watchProgressPercent(record) >= WATCHED_THRESHOLD) {
    return "watched";
  }
  if (hasResumePoint(record)) return "inProgress";
  return "unwatched";
}

/** Aggregate many records (movie rows + per-episode series rows) into one state
 * per media id. Precedence is inProgress > watched > unwatched: something you can
 * resume shows the progress bar rather than a "finished" check, and a title with
 * at least one completed play (and nothing paused) reads as watched. */
export function watchedStatesByMedia(
  records: readonly WatchHistoryRecord[],
): Record<string, WatchedState> {
  const out: Record<string, WatchedState> = {};
  for (const r of records) {
    const state = watchedStateForRecord(r);
    if (state === "inProgress") {
      out[r.mediaId] = "inProgress"; // highest precedence, always wins
    } else if (state === "watched") {
      if (out[r.mediaId] !== "inProgress") out[r.mediaId] = "watched";
    } else if (out[r.mediaId] == null) {
      out[r.mediaId] = "unwatched";
    }
  }
  return out;
}

/** The set of media ids that read as fully watched (a completed play and nothing
 * resumable pending). Convenience for surfaces that only need the check badge. */
export function watchedMediaIds(
  records: readonly WatchHistoryRecord[],
): Set<string> {
  const states = watchedStatesByMedia(records);
  const ids = new Set<string>();
  for (const id in states) {
    if (states[id] === "watched") ids.add(id);
  }
  return ids;
}
