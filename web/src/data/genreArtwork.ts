// Live artwork for the "Browse categories" tiles. For each genre/category tile
// it pulls the most popular title's 16:9 backdrop from TMDB and caches it, so a
// tile shows a real, representative still behind its gradient scrim instead of
// just a flat colour. Purely decorative: if TMDB isn't configured or a lookup
// fails, the tile falls back to the gradient and nothing breaks.

import { useEffect, useState } from "react";
import type { MediaType } from "../models/media";
import type { MetadataProvider } from "../services/metadata/types";
import { makeDiscoverFilters, SortOption } from "../services/metadata/types";
import { catalogTilesFor, tileGenreId, type GenreCatalogTile } from "./genreCatalog";

const TMDB_IMAGE_BASE = "https://image.tmdb.org/t/p";

// Caches are scoped PER provider instance (a new TMDB key rebuilds the service,
// so a swapped credential naturally gets a fresh cache and stale artwork/nulls
// don't leak across it). Inner maps are keyed by `${type}:${tileId}`.
const caches = new WeakMap<MetadataProvider, Map<string, string | null>>();
const inflights = new WeakMap<MetadataProvider, Map<string, Promise<string | null>>>();

function cacheFor(tmdb: MetadataProvider): Map<string, string | null> {
  let m = caches.get(tmdb);
  if (m == null) {
    m = new Map();
    caches.set(tmdb, m);
  }
  return m;
}
function inflightFor(tmdb: MetadataProvider): Map<string, Promise<string | null>> {
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

/** Fetch (once) the representative backdrop URL for a single tile. */
async function loadTileBackdrop(
  tmdb: MetadataProvider,
  type: MediaType,
  tile: GenreCatalogTile,
): Promise<string | null> {
  const key = keyFor(type, tile.id);
  const cache = cacheFor(tmdb);
  const inflight = inflightFor(tmdb);
  const cached = cache.get(key);
  if (cached !== undefined) return cached;
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
      const path =
        result?.items?.find((it) => it.backdropPath != null)?.backdropPath ?? null;
      const url = path != null ? `${TMDB_IMAGE_BASE}/w780${path}` : null;
      // A successful-but-empty lookup IS cached (null) — the genre genuinely has
      // no usable backdrop, so don't keep re-asking. A THROWN error is not
      // cached, so a transient failure or a just-fixed key recovers on remount.
      cache.set(key, url);
      return url;
    } catch {
      return null;
    } finally {
      inflight.delete(key);
    }
  })();
  inflight.set(key, run);
  return run;
}

/** Backdrop URLs for every tile of a media type, keyed by tile id. Missing keys
 * (or null values) mean "no artwork — use the gradient". Fetches lazily and
 * fills in as results arrive. The map is type-scoped: after a movie↔series
 * switch it returns empty until this type's artwork resolves, so a shared genre
 * id (e.g. "action") never briefly shows the other type's backdrop. */
export function useGenreArtwork(
  type: MediaType,
  tmdb: MetadataProvider | null,
): Map<string, string> {
  const [state, setState] = useState<{ type: MediaType; art: Map<string, string> }>(
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
    const seed = new Map<string, string>();
    for (const tile of tiles) {
      const cached = cache.get(keyFor(type, tile.id));
      if (typeof cached === "string") seed.set(tile.id, cached);
    }
    setState({ type, art: seed });

    for (const tile of tiles) {
      if (typeof cache.get(keyFor(type, tile.id)) === "string") continue;
      void loadTileBackdrop(tmdb, type, tile).then((url) => {
        if (cancelled || url == null) return;
        setState((prev) => {
          if (prev.type !== type || prev.art.get(tile.id) === url) return prev;
          const next = new Map(prev.art);
          next.set(tile.id, url);
          return { type, art: next };
        });
      });
    }

    return () => {
      cancelled = true;
    };
  }, [type, tmdb]);

  // Guard against the one render between a prop change and the effect running.
  return state.type === type ? state.art : EMPTY;
}

const EMPTY: Map<string, string> = new Map();
