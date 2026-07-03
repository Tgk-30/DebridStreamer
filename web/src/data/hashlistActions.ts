// Hash-list import/export orchestration.
//
// Import: take a parsed list of {infoHash, name?} and bulk-add each magnet to
// the user's debrid via DebridManager.addMagnet (so the torrents get cached on
// the account), reporting per-item progress + a final result summary.
//
// Export: produce a shareable string (lib/hashlist.encodeHashList) from a set of
// DebridTorrent rows (the whole library or a selection).
//
// AI-emit: ask the AI provider to recommend N titles for a prompt, resolve each
// to a best infoHash via TMDB + IndexerManager (preferring cached/seeded), and
// return both the entries and a shareable string. Gates gracefully on a missing
// AI provider / debrid / indexers. All network is concurrent + fault-tolerant.

import type { DebridManager } from "../services/debrid/DebridManager";
import type { IndexerManager } from "../services/indexers/IndexerManager";
import type { TMDBService } from "../services/metadata/TMDBService";
import type { AIAssistantProvider } from "../services/ai/types";
import type { MediaType } from "../models/media";
import type { DebridTorrent } from "../services/debrid/models";
import {
  encodeHashList,
  type HashListEntry,
} from "../lib/hashlist";

/** Per-item import outcome. */
export interface ImportItemResult {
  infoHash: string;
  name: string | null;
  ok: boolean;
  /** Error message when `ok` is false. */
  error: string | null;
}

/** Final summary of a bulk import. */
export interface ImportSummary {
  total: number;
  succeeded: number;
  failed: number;
  results: ImportItemResult[];
}

/** Bulk-add a hash-list onto the user's debrid. Each magnet is added via the
 * manager (cached-first on the account). Concurrency-bounded + fault-tolerant: a
 * single failure never aborts the batch. `onProgress(done, total)` is invoked as
 * items complete so the dialog can show a progress bar. */
export async function importHashList(
  entries: HashListEntry[],
  debrid: DebridManager,
  onProgress?: (done: number, total: number) => void,
): Promise<ImportSummary> {
  const total = entries.length;
  const results: ImportItemResult[] = new Array(total);
  let done = 0;

  const MAX_CONCURRENCY = 4;
  let cursor = 0;

  async function worker(): Promise<void> {
    while (cursor < entries.length) {
      const index = cursor;
      cursor += 1;
      const entry = entries[index];
      try {
        await debrid.addMagnet(entry.infoHash);
        results[index] = {
          infoHash: entry.infoHash,
          name: entry.name ?? null,
          ok: true,
          error: null,
        };
      } catch (err) {
        results[index] = {
          infoHash: entry.infoHash,
          name: entry.name ?? null,
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
      done += 1;
      onProgress?.(done, total);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(MAX_CONCURRENCY, total) }, () => worker()),
  );

  const succeeded = results.filter((r) => r?.ok).length;
  return {
    total,
    succeeded,
    failed: total - succeeded,
    results,
  };
}

/** Build a shareable hash-list string from debrid torrents (whole library or a
 * selection). Rows without a known infoHash are dropped (can't be shared). */
export function exportHashList(torrents: DebridTorrent[]): string {
  const entries: HashListEntry[] = torrents
    .filter((t) => t.infoHash != null && t.infoHash.length > 0)
    .map((t) => ({ infoHash: t.infoHash as string, name: t.name }));
  return encodeHashList(entries);
}

/** The result of an AI-emit: the resolved entries plus the shareable string. */
export interface AIEmitResult {
  entries: HashListEntry[];
  encoded: string;
  /** Titles the AI suggested that we could NOT resolve to an infoHash. */
  unresolved: string[];
}

/** Dependencies for the AI-emit flow. */
export interface AIEmitDeps {
  ai: AIAssistantProvider | null;
  tmdb: TMDBService | null;
  indexers: IndexerManager;
  debrid: DebridManager | null;
}

/** Ask the AI for N titles for `prompt`, resolve each to a best infoHash
 * (TMDB search -> IndexerManager.searchAll -> prefer cached, else most seeders),
 * and produce a shareable hash-list. Gates gracefully: throws a clear error when
 * the AI provider or indexers are missing. Per-title resolution is concurrent +
 * fault-tolerant (an unresolved title is reported, not fatal). */
export async function aiEmitHashList(
  prompt: string,
  count: number,
  deps: AIEmitDeps,
): Promise<AIEmitResult> {
  const { ai, indexers } = deps;
  if (ai == null) {
    throw new Error("Configure an AI provider in Settings to generate a list.");
  }
  if (indexers.activeIndexers.length === 0) {
    throw new Error("Configure at least one indexer to resolve titles to hashes.");
  }

  const recommendation = await ai.recommend(prompt, [], count);
  const titles = recommendation.recommendations
    .map((r) => r.title.trim())
    .filter((t) => t.length > 0);
  if (titles.length === 0) {
    throw new Error("The assistant returned no titles to resolve.");
  }

  const resolved = await Promise.all(
    titles.map((title) => resolveTitleToEntry(title, deps)),
  );

  const entries: HashListEntry[] = [];
  const unresolved: string[] = [];
  resolved.forEach((entry, i) => {
    if (entry != null) entries.push(entry);
    else unresolved.push(titles[i]);
  });

  if (entries.length === 0) {
    throw new Error("Could not resolve any of the suggested titles to a torrent.");
  }

  return { entries, encoded: encodeHashList(entries), unresolved };
}

/** Resolve a single title to its best infoHash. TMDB search picks the top match
 * (and its IMDb id), IndexerManager searches it, then we prefer a cached result,
 * else the most-seeded. Returns null when nothing resolves. Never throws. */
async function resolveTitleToEntry(
  title: string,
  deps: AIEmitDeps,
): Promise<HashListEntry | null> {
  const { tmdb, indexers, debrid } = deps;
  try {
    // 1. Find the title on TMDB and get an IMDb id (best indexer key). If no
    //    TMDB, fall back to a text query against the indexers.
    let imdbId: string | null = null;
    let type: MediaType = "movie";
    if (tmdb != null) {
      const search = await tmdb.search(title, null, 1);
      const top = search.items[0];
      if (top != null) {
        type = top.type;
        const detail = await tmdb
          .getDetail(top.id, top.type)
          .catch(() => null);
        if (detail != null && detail.id.startsWith("tt")) imdbId = detail.id;
      }
    }

    const results =
      imdbId != null
        ? await indexers.searchAll(imdbId, type)
        : await indexers.searchByQuery(title, type);
    if (results.length === 0) return null;

    // 2. Prefer a result cached on debrid; results are already quality+seeder
    //    sorted, so the first cached (or first overall) is the best pick.
    let chosen = results[0];
    if (debrid != null && debrid.hasServices) {
      try {
        const merged = await debrid.checkCacheAll(results.map((r) => r.infoHash));
        // checkCacheAll canonicalizes to lowercase — look up the same way.
        const cached = results.find(
          (r) => merged[r.infoHash.toLowerCase()]?.status.kind === "cached",
        );
        if (cached != null) chosen = cached;
      } catch {
        // keep the seeder-sorted top pick
      }
    }

    return { infoHash: chosen.infoHash, name: title };
  } catch {
    return null;
  }
}
