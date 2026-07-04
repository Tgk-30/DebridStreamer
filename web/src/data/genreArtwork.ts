// Live artwork for the "Browse categories" tiles. For each genre/category tile
// it pulls several of the most popular titles' 16:9 backdrops from TMDB and
// caches them, so a tile shows a real, representative still behind its gradient
// scrim — and the grid rotates gently through them so the tiles refresh over
// time. Purely decorative: if TMDB isn't configured or a lookup fails, the tile
// falls back to the gradient and nothing breaks.

import { useEffect, useState } from "react";
import type { MediaType } from "../models/media";
import type { MetadataProvider } from "../services/metadata/types";
import { makeDiscoverFilters, SortOption } from "../services/metadata/types";
import { catalogTilesFor, tileGenreId, type GenreCatalogTile } from "./genreCatalog";

const TMDB_IMAGE_BASE = "https://image.tmdb.org/t/p";
// Cache entries live 30 min, so artwork refreshes within a long session (and a
// cached null — a genre with no usable backdrop — stops blocking a later retry).
const ARTWORK_TTL_MS = 30 * 60 * 1000;
// Cap parallel TMDB lookups so opening Search doesn't fire ~15 requests at once
// (which can trip the free-tier rate limit and blank every tile).
const MAX_CONCURRENT = 4;
// How many representative backdrops to keep per tile. The grid rotates through
// them (cross-fade) so a tile's banner refreshes over a session.
const MAX_BACKDROPS = 6;

interface CacheEntry {
  /** Representative backdrop URLs, most-popular first. Empty = no usable art. */
  urls: string[];
  expiresAt: number;
}

// Caches are scoped PER provider instance (a new TMDB key rebuilds the service,
// so a swapped credential naturally gets a fresh cache and stale artwork/nulls
// don't leak across it). Inner maps are keyed by `${type}:${tileId}`.
const caches = new WeakMap<MetadataProvider, Map<string, CacheEntry>>();
const inflights = new WeakMap<MetadataProvider, Map<string, Promise<string[]>>>();

function cacheFor(tmdb: MetadataProvider): Map<string, CacheEntry> {
  let m = caches.get(tmdb);
  if (m == null) {
    m = new Map();
    caches.set(tmdb, m);
  }
  return m;
}
function inflightFor(tmdb: MetadataProvider): Map<string, Promise<string[]>> {
  let m = inflights.get(tmdb);
  if (m == null) {
    m = new Map();
    inflights.set(tmdb, m);
  }
  return m;
}

function keyFor(type: MediaType, tileId: string): string {
  return `${type}:${tileId}`;
}

/** The cached entry if present AND unexpired, else undefined (miss / stale). */
function fresh(cache: Map<string, CacheEntry>, key: string): CacheEntry | undefined {
  const e = cache.get(key);
  if (e == null || e.expiresAt <= Date.now()) return undefined;
  return e;
}

/** Fetch (once) up to MAX_BACKDROPS representative backdrop URLs for a tile. */
async function loadTileBackdrops(
  tmdb: MetadataProvider,
  type: MediaType,
  tile: GenreCatalogTile,
): Promise<string[]> {
  const key = keyFor(type, tile.id);
  const cache = cacheFor(tmdb);
  const inflight = inflightFor(tmdb);
  const hit = fresh(cache, key);
  if (hit !== undefined) return hit.urls;
  const pending = inflight.get(key);
  if (pending != null) return pending;

  const run = (async () => {
    try {
      const result =
        tile.category != null
          ? await tmdb.getCategory(tile.category, type)
          : await (async () => {
              const gid = tileGenreId(tile, type);
              if (gid == null) return null;
              return tmdb.discover(
                type,
                makeDiscoverFilters({
                  genreId: gid,
                  sortBy: SortOption.popularityDesc,
                }),
              );
            })();
      const urls = (result?.items ?? [])
        .map((it) => it.backdropPath)
        .filter((p): p is string => p != null)
        .slice(0, MAX_BACKDROPS)
        .map((p) => `${TMDB_IMAGE_BASE}/w780${p}`);
      // A successful lookup (even an empty one → []) is cached with a TTL, so it
      // stops re-asking for a while but recovers after the entry expires. A
      // THROWN error is NOT cached, so a transient failure retries on remount.
      cache.set(key, { urls, expiresAt: Date.now() + ARTWORK_TTL_MS });
      return urls;
    } catch {
      return [];
    } finally {
      inflight.delete(key);
    }
  })();
  inflight.set(key, run);
  return run;
}

/** Run `task` over `items` with at most `limit` in flight at once. Stops pulling
 * new work once `stopped()` returns true. */
async function runPool<T>(
  items: T[],
  limit: number,
  stopped: () => boolean,
  task: (item: T) => Promise<void>,
): Promise<void> {
  let cursor = 0;
  const worker = async () => {
    while (cursor < items.length) {
      if (stopped()) return;
      const item = items[cursor++];
      await task(item);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => worker()),
  );
}

/** Backdrop URL lists for every tile of a media type, keyed by tile id. Missing
 * keys (or empty lists) mean "no artwork — use the gradient". Fetches lazily and
 * fills in as results arrive. The map is type-scoped: after a movie↔series
 * switch it returns empty until this type's artwork resolves, so a shared genre
 * id (e.g. "action") never briefly shows the other type's backdrop. */
export function useGenreArtwork(
  type: MediaType,
  tmdb: MetadataProvider | null,
): Map<string, string[]> {
  const [state, setState] = useState<{ type: MediaType; art: Map<string, string[]> }>(
    () => ({ type, art: new Map() }),
  );

  useEffect(() => {
    if (tmdb == null) {
      setState({ type, art: new Map() });
      return;
    }
    let cancelled = false;
    const tiles = catalogTilesFor(type);
    const cache = cacheFor(tmdb);

    // Seed synchronously from cache so cached tiles paint on the first frame and
    // the map is immediately tagged with the CURRENT type.
    const seed = new Map<string, string[]>();
    for (const tile of tiles) {
      const hit = fresh(cache, keyFor(type, tile.id));
      if (hit != null && hit.urls.length > 0) seed.set(tile.id, hit.urls);
    }
    setState({ type, art: seed });

    // Fetch only the misses, capped to MAX_CONCURRENT in flight.
    const misses = tiles.filter((t) => fresh(cache, keyFor(type, t.id)) === undefined);
    void runPool(misses, MAX_CONCURRENT, () => cancelled, async (tile) => {
      const urls = await loadTileBackdrops(tmdb, type, tile);
      if (cancelled || urls.length === 0) return;
      setState((prev) => {
        if (prev.type !== type) return prev;
        const existing = prev.art.get(tile.id);
        if (existing != null && existing[0] === urls[0] && existing.length === urls.length) {
          return prev;
        }
        const next = new Map(prev.art);
        next.set(tile.id, urls);
        return { type, art: next };
      });
    });

    return () => {
      cancelled = true;
    };
  }, [type, tmdb]);

  // Guard against the one render between a prop change and the effect running.
  return state.type === type ? state.art : EMPTY;
}

const EMPTY: Map<string, string[]> = new Map();
