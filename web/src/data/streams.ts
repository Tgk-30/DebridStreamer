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
import { VideoQuality, type TorrentResult } from "../services/indexers/models";
import type { AppSettings, StreamMaxQuality } from "./settings";
import { fetchServerStreams } from "../lib/serverApi";
import { configuredServerURL } from "../lib/serverMode";

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

function maxQualityOrder(maxQuality: StreamMaxQuality): number | null {
  return maxQuality === "any" ? null : VideoQuality.sortOrder(maxQuality);
}

/** The bandwidth-friendly ceiling the master Data Saver toggle clamps to. */
export const DATA_SAVER_MAX_QUALITY: StreamMaxQuality = "720p";
export const DATA_SAVER_MAX_SIZE_GB = 5;

/** Effective stream caps for a profile, applying the master Data Saver clamp.
 *
 * Data Saver only ever TIGHTENS (a `min` over quality + size) — it never loosens
 * a stricter explicit cap, so a user who already set 480p / 2 GB keeps those. The
 * cached-only constraint is left to its own explicit toggle. Off → the raw three
 * fields, so existing behavior is unchanged when Data Saver is off. */
export function effectiveDataSaver(settings: AppSettings): {
  cachedOnly: boolean;
  maxQuality: StreamMaxQuality;
  maxSizeGB: number;
} {
  if (!settings.dataSaver) {
    return {
      cachedOnly: settings.streamCachedOnly,
      maxQuality: settings.streamMaxQuality,
      maxSizeGB: settings.streamMaxSizeGB,
    };
  }
  const currentOrder = maxQualityOrder(settings.streamMaxQuality); // null = "any" (uncapped)
  const saverOrder = maxQualityOrder(DATA_SAVER_MAX_QUALITY) ?? 0; // "720p" is never "any"
  const maxQuality =
    currentOrder == null || currentOrder > saverOrder
      ? DATA_SAVER_MAX_QUALITY
      : settings.streamMaxQuality;
  // 0 means "no size cap", so treat it as larger than the Data Saver ceiling.
  const currentSize = settings.streamMaxSizeGB > 0 ? settings.streamMaxSizeGB : Infinity;
  const maxSizeGB = Math.min(currentSize, DATA_SAVER_MAX_SIZE_GB);
  return { cachedOnly: settings.streamCachedOnly, maxQuality, maxSizeGB };
}

export function streamMatchesDataSaver(row: StreamRow, settings: AppSettings): boolean {
  const caps = effectiveDataSaver(settings);
  if (caps.cachedOnly && row.cachedOn == null) return false;

  const maxOrder = maxQualityOrder(caps.maxQuality);
  if (
    maxOrder != null &&
    row.result.quality !== VideoQuality.unknown &&
    VideoQuality.sortOrder(row.result.quality) > maxOrder
  ) {
    return false;
  }

  const maxBytes = caps.maxSizeGB > 0 ? caps.maxSizeGB * 1024 * 1024 * 1024 : 0;
  if (maxBytes > 0 && row.result.sizeBytes > maxBytes) return false;

  return true;
}

export function filterStreamRows(rows: StreamRow[], settings: AppSettings): StreamRow[] {
  return rows.filter((row) => streamMatchesDataSaver(row, settings));
}

/** Collapse cross-indexer duplicates: the SAME torrent (infoHash) is often
 * returned by several indexers, swamping the stream list with identical entries.
 * Keep one row per infoHash — the most useful variant (prefer a cached copy,
 * then more seeders) — preserving each release's first-seen slot. Pure +
 * automatic (no information is lost: it's the same torrent). */
export function dedupeStreamRows(rows: StreamRow[]): StreamRow[] {
  const byHash = new Map<string, StreamRow>();
  const order: string[] = [];
  for (const row of rows) {
    const key = row.result.infoHash.toLowerCase();
    const existing = byHash.get(key);
    if (existing == null) {
      byHash.set(key, row);
      order.push(key);
    } else {
      byHash.set(key, betterDuplicate(existing, row));
    }
  }
  return order.map((k) => byHash.get(k)!);
}

/** Pick the more useful of two rows for the same torrent: a cached copy beats an
 * uncached one; otherwise the one with more seeders. */
function betterDuplicate(a: StreamRow, b: StreamRow): StreamRow {
  if ((a.cachedOn != null) !== (b.cachedOn != null)) {
    return a.cachedOn != null ? a : b;
  }
  return b.result.seeders > a.result.seeders ? b : a;
}

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

  return dedupeStreamRows(
    results.map((result) => ({
      result,
      cachedOn: cacheByHash[result.infoHash] ?? null,
    })),
  );
}

/** Resolve stream rows for a title. Returns an empty/idle state until both an
 * imdb id and at least one indexer are available. */
export function useStreams(
  imdbId: string | null,
  type: MediaType,
  indexers: IndexerManager,
  debrid: DebridManager | null,
): StreamsState {
  const serverURL = configuredServerURL();
  const serverMode = serverURL != null;
  const hasIndexers = serverMode ? true : indexers.activeIndexers.length > 0;
  const hasDebrid = serverMode ? true : debrid != null && debrid.hasServices;

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
        if (serverMode) {
          const remote = await fetchServerStreams({ imdbId, type });
          if (!signal.cancelled) {
            setState({
              rows: dedupeStreamRows(remote.rows),
              loading: false,
              error: null,
              hasIndexers: remote.hasIndexers,
              hasDebrid: remote.hasDebrid,
            });
          }
          return;
        }
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
    [imdbId, type, indexers, debrid, hasIndexers, hasDebrid, serverMode],
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
