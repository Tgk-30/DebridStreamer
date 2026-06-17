// Stream-picker data layer.
//
// For a title (IMDb id + type), searches all configured indexers
// (IndexerManager.searchAll), then checks which of those torrents are instantly
// available on a debrid service (DebridManager.checkCacheAll over the infoHashes).
// Each result is annotated with its cache state (which service has it / "will
// cache") so the UI can render the green "Instant · RD" vs grey "Will cache"
// badge and a cached-first sort. Imports the ported services READ-ONLY.

import { useCallback, useEffect, useState } from "react";
import type { MediaType } from "../models/media";
import type { DebridManager } from "../services/debrid/DebridManager";
import type { DebridServiceType } from "../services/debrid/models";
import { CacheStatus } from "../services/debrid/models";
import type { IndexerManager } from "../services/indexers/IndexerManager";
import type { TorrentResult } from "../services/indexers/models";

/** A torrent result plus its resolved cache state. */
export interface StreamRow {
  result: TorrentResult;
  /** Which debrid service has it cached (null when not cached / no debrid). */
  cachedOn: DebridServiceType | null;
}

export interface StreamsState {
  rows: StreamRow[];
  loading: boolean;
  error: string | null;
  /** Whether any indexer is configured (drives the empty state copy). */
  hasIndexers: boolean;
  /** Whether any debrid service is configured (drives the cache badges). */
  hasDebrid: boolean;
}

const EMPTY: StreamsState = {
  rows: [],
  loading: false,
  error: null,
  hasIndexers: false,
  hasDebrid: false,
};

async function resolveStreams(
  imdbId: string,
  type: MediaType,
  indexers: IndexerManager,
  debrid: DebridManager | null,
): Promise<StreamRow[]> {
  const results = await indexers.searchAll(imdbId, type);
  if (results.length === 0) return [];

  // Check cache across all configured debrid services for every infoHash.
  let cacheByHash: Record<string, DebridServiceType> = {};
  if (debrid != null && debrid.hasServices) {
    const hashes = results.map((r) => r.infoHash);
    try {
      const merged = await debrid.checkCacheAll(hashes);
      cacheByHash = Object.fromEntries(
        Object.entries(merged)
          .filter(([, entry]) => CacheStatus.isCached(entry.status))
          .map(([hash, entry]) => [hash, entry.service]),
      );
    } catch {
      cacheByHash = {};
    }
  }

  return results.map((result) => ({
    result,
    cachedOn: cacheByHash[result.infoHash] ?? null,
  }));
}

/** Resolve stream rows for a title. Returns an empty/idle state until both an
 * imdb id and at least one indexer are available. */
export function useStreams(
  imdbId: string | null,
  type: MediaType,
  indexers: IndexerManager,
  debrid: DebridManager | null,
): StreamsState {
  const hasIndexers = indexers.activeIndexers.length > 0;
  const hasDebrid = debrid != null && debrid.hasServices;

  const [state, setState] = useState<StreamsState>({
    ...EMPTY,
    hasIndexers,
    hasDebrid,
    loading: imdbId != null && hasIndexers,
  });

  const run = useCallback(
    async (signal: { cancelled: boolean }) => {
      if (imdbId == null || !hasIndexers) {
        setState({ ...EMPTY, hasIndexers, hasDebrid, loading: false });
        return;
      }
      setState((s) => ({ ...s, loading: true, error: null, hasIndexers, hasDebrid }));
      try {
        const rows = await resolveStreams(imdbId, type, indexers, debrid);
        if (!signal.cancelled) {
          setState({ rows, loading: false, error: null, hasIndexers, hasDebrid });
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (!signal.cancelled) {
          setState({ rows: [], loading: false, error: message, hasIndexers, hasDebrid });
        }
      }
    },
    [imdbId, type, indexers, debrid, hasIndexers, hasDebrid],
  );

  useEffect(() => {
    const signal = { cancelled: false };
    void run(signal);
    return () => {
      signal.cancelled = true;
    };
  }, [run]);

  return state;
}
