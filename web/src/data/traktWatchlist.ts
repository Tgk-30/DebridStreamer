// Trakt watchlist reconciliation helpers.
//
// The Trakt sync endpoint accepts IMDb IDs. Local watchlist previews can use
// IMDb IDs directly or a TMDB fallback, so resolve the latter before a push.

import type { MediaPreview } from "../models/media";

export interface TraktIMDbIdLookup {
  getExternalIds(
    tmdbId: number,
    type: "movie",
  ): Promise<{ imdbId?: string | null }>;
}

export interface TraktWatchlistPushCandidates {
  imdbIDs: string[];
  skipped: number;
  seriesExcluded: number;
}

/**
 * Build the movies-only IMDb ID list accepted by Trakt's watchlist endpoint.
 * A local `tmdb-<id>` preview is reconciled through TMDB; other unknown local
 * identifiers are reported as skipped instead of being sent as invalid IDs.
 */
export async function collectTraktWatchlistPushCandidates(
  watchlist: MediaPreview[],
  tmdb: TraktIMDbIdLookup,
): Promise<TraktWatchlistPushCandidates> {
  const imdbIDs: string[] = [];
  let skipped = 0;
  let seriesExcluded = 0;

  for (const preview of watchlist) {
    if (preview.type !== "movie") {
      seriesExcluded += 1;
      continue;
    }

    if (preview.id.startsWith("tt")) {
      imdbIDs.push(preview.id);
      continue;
    }

    const match = /^tmdb-(\d+)$/.exec(preview.id);
    if (match == null) {
      skipped += 1;
      continue;
    }

    try {
      const ids = await tmdb.getExternalIds(Number(match[1]), "movie");
      if (ids.imdbId != null && ids.imdbId.startsWith("tt")) {
        imdbIDs.push(ids.imdbId);
      } else {
        skipped += 1;
      }
    } catch {
      // A single metadata lookup failure should not abort a manual sync.
      skipped += 1;
    }
  }

  return { imdbIDs, skipped, seriesExcluded };
}
