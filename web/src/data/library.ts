// Watchlist + History persistence — backed by the storage port (Dexie/IndexedDB).
//
// The native app stores these in GRDB. The storage port replaces the old
// localStorage stopgap with the typed cross-platform `Store` (IndexedDB via
// Dexie), which works in a plain browser AND the Tauri webview. The screens
// render from an in-memory `MediaPreview[]` held by the AppStore; these helpers
// read/write the durable Store and return the refreshed list so the AppStore can
// update its state. `isInWatchlist` stays a pure check over the in-memory array.

import type { MediaPreview } from "../models/media";
import { getStore } from "../storage";
import type { WatchHistoryRecord } from "../storage/models";

/** Whether an item is in the (in-memory) watchlist array. Pure — no I/O. */
export function isInWatchlist(items: MediaPreview[], id: string): boolean {
  return items.some((i) => i.id === id);
}

/** Load the watchlist from the Store, most-recently-added first. */
export async function loadWatchlist(): Promise<MediaPreview[]> {
  const rows = await getStore().listWatchlist();
  return rows.map((r) => r.preview);
}

/** Load the watch history from the Store, most-recently-watched first. */
export async function loadHistory(): Promise<MediaPreview[]> {
  const rows = await getStore().listHistory();
  return rows.map((r) => r.preview);
}

/** Load the "continue watching" rows (incomplete, with resume positions). */
export async function loadContinueWatching(): Promise<WatchHistoryRecord[]> {
  return getStore().continueWatching();
}

/** Toggle an item in the watchlist; returns the refreshed list. */
export async function toggleWatchlist(
  item: MediaPreview,
): Promise<MediaPreview[]> {
  const store = getStore();
  if (await store.isInWatchlist(item.id)) {
    await store.removeFromWatchlist(item.id);
  } else {
    await store.addToWatchlist(item);
  }
  return loadWatchlist();
}

/** Remove an item from the watchlist; returns the refreshed list. */
export async function removeFromWatchlist(
  id: string,
): Promise<MediaPreview[]> {
  const store = getStore();
  await store.removeFromWatchlist(id);
  return loadWatchlist();
}

/** Record a viewed/played item into watch history (one row per (media,episode),
 * newest wins). Returns the refreshed history list. Optional resume fields let
 * playback record a real resume position; opening a Detail records a view with
 * default zero progress. */
export async function recordHistory(
  item: MediaPreview,
  opts?: {
    progressSeconds?: number;
    durationSeconds?: number | null;
    completed?: boolean;
    streamQuality?: string | null;
    episodeId?: string | null;
  },
): Promise<MediaPreview[]> {
  const store = getStore();
  await store.recordHistory({
    mediaId: item.id,
    episodeId: opts?.episodeId ?? null,
    progressSeconds: opts?.progressSeconds ?? 0,
    durationSeconds: opts?.durationSeconds ?? null,
    completed: opts?.completed ?? false,
    streamQuality: opts?.streamQuality ?? null,
    preview: item,
  });
  return loadHistory();
}
