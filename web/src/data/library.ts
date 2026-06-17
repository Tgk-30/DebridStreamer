// Watchlist + History persistence (localStorage stopgap).
//
// The native app stores these in GRDB; that storage layer isn't ported yet, so
// this phase keeps the watchlist and "recently viewed" history in localStorage.
// Both are arrays of MediaPreview (the display type the catalog already uses),
// most-recent-first. Real persistence / sync arrives with the storage port.

import type { MediaPreview } from "../models/media";

const WATCHLIST_KEY = "debridstreamer.watchlist.v1";
const HISTORY_KEY = "debridstreamer.history.v1";
const HISTORY_LIMIT = 60;

function read(key: string): MediaPreview[] {
  try {
    const raw = globalThis.localStorage?.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as MediaPreview[]) : [];
  } catch {
    return [];
  }
}

function write(key: string, items: MediaPreview[]): void {
  try {
    globalThis.localStorage?.setItem(key, JSON.stringify(items));
  } catch {
    // Ignore.
  }
}

export function loadWatchlist(): MediaPreview[] {
  return read(WATCHLIST_KEY);
}

export function loadHistory(): MediaPreview[] {
  return read(HISTORY_KEY);
}

export function isInWatchlist(items: MediaPreview[], id: string): boolean {
  return items.some((i) => i.id === id);
}

/** Toggle an item in the watchlist; returns the new list (most-recent-first). */
export function toggleWatchlist(item: MediaPreview): MediaPreview[] {
  const current = loadWatchlist();
  const exists = current.some((i) => i.id === item.id);
  const next = exists
    ? current.filter((i) => i.id !== item.id)
    : [item, ...current];
  write(WATCHLIST_KEY, next);
  return next;
}

export function removeFromWatchlist(id: string): MediaPreview[] {
  const next = loadWatchlist().filter((i) => i.id !== id);
  write(WATCHLIST_KEY, next);
  return next;
}

/** Record a viewed item at the front of history (dedup, capped). Returns the
 * new list. */
export function recordHistory(item: MediaPreview): MediaPreview[] {
  const current = loadHistory().filter((i) => i.id !== item.id);
  const next = [item, ...current].slice(0, HISTORY_LIMIT);
  write(HISTORY_KEY, next);
  return next;
}

export function clearHistory(): MediaPreview[] {
  write(HISTORY_KEY, []);
  return [];
}
