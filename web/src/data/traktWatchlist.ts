// Trakt watchlist reconciliation helpers.
//
// Trakt stores movies by IMDb id and accepts shows by TMDB id. Local previews
// can use either identifier, so reconcile through TMDB before a push and use
// TMDB's normal detail/search paths before a pull reaches the local watchlist.

import type { MediaItem, MediaPreview, MediaType } from "../models/media";
import { resolveEntry, type ImportEntry } from "./importWatchlist";
import type {
  TraktWatchlistItem,
  TraktWatchlistShowItem,
} from "../services/sync/models";

export interface TraktIMDbIdLookup {
  getExternalIds(
    tmdbId: number,
    type: "movie",
  ): Promise<{ imdbId?: string | null }>;
}

interface TraktShowTMDBIdLookup {
  findByImdbId?(imdbId: string, type: "series"): Promise<number | null>;
}

export type TraktWatchlistPushLookup = TraktIMDbIdLookup & TraktShowTMDBIdLookup;

export interface TraktWatchlistPushCandidates {
  imdbIDs: string[];
  showTMDBIDs: number[];
  skipped: number;
}

/**
 * Build the movie IMDb ids and series TMDB ids accepted by Trakt's watchlist
 * endpoint. Unknown local identifiers are reported as skipped instead of being
 * sent as invalid ids.
 */
export async function collectTraktWatchlistPushCandidates(
  watchlist: MediaPreview[],
  tmdb: TraktWatchlistPushLookup,
): Promise<TraktWatchlistPushCandidates> {
  const movieIDs = new Set<string>();
  const showIDs = new Set<number>();
  let skipped = 0;

  for (const preview of watchlist) {
    if (preview.type === "series") {
      const directTMDBId = tmdbIdFromPreview(preview);
      if (directTMDBId != null) {
        showIDs.add(directTMDBId);
        continue;
      }
      if (preview.id.startsWith("tt") && tmdb.findByImdbId != null) {
        try {
          const resolved = await tmdb.findByImdbId(preview.id, "series");
          if (resolved != null) {
            showIDs.add(resolved);
            continue;
          }
        } catch {
          // A single metadata lookup failure must not abort a manual sync.
        }
      }
      skipped += 1;
      continue;
    }

    if (preview.id.startsWith("tt")) {
      movieIDs.add(preview.id);
      continue;
    }

    const tmdbId = tmdbIdFromPreview(preview);
    if (tmdbId == null) {
      skipped += 1;
      continue;
    }

    try {
      const ids = await tmdb.getExternalIds(tmdbId, "movie");
      if (ids.imdbId != null && ids.imdbId.startsWith("tt")) {
        movieIDs.add(ids.imdbId);
      } else {
        skipped += 1;
      }
    } catch {
      // A single metadata lookup failure must not abort a manual sync.
      skipped += 1;
    }
  }

  return {
    imdbIDs: [...movieIDs],
    showTMDBIDs: [...showIDs],
    skipped,
  };
}

/** The TMDB operations shared by movie and show pulls. */
export interface TraktWatchlistResolver {
  findByImdbId(imdbId: string, type: MediaType): Promise<number | null>;
  getDetail(id: string, type: MediaType): Promise<MediaItem>;
  search(
    query: string,
    type: MediaType | null,
  ): Promise<{ items: MediaPreview[] }>;
}

export interface TraktWatchlistPullResult {
  previews: MediaPreview[];
  movies: number;
  series: number;
  notFound: number;
}

/** Resolve the complete Trakt watchlist through TMDB before merging it into the
 * local Store. The caller owns the Store write, preserving the existing
 * importToWatchlist dedupe and folder behavior. */
export async function resolveTraktWatchlistPull(
  movies: TraktWatchlistItem[],
  shows: TraktWatchlistShowItem[],
  tmdb: TraktWatchlistResolver,
  onProgress?: (done: number, total: number) => void,
): Promise<TraktWatchlistPullResult> {
  const previews: MediaPreview[] = [];
  const seen = new Set<string>();
  let movieCount = 0;
  let seriesCount = 0;
  let notFound = 0;
  const total = movies.length + shows.length;
  let done = 0;

  for (const item of movies) {
    const preview = await resolveTraktMovie(item, tmdb);
    if (preview == null) {
      notFound += 1;
    } else if (appendUniquePreview(previews, seen, preview)) {
      movieCount += 1;
    }
    done += 1;
    onProgress?.(done, total);
  }

  for (const item of shows) {
    const preview = await resolveTraktShow(item, tmdb);
    if (preview == null) {
      notFound += 1;
    } else if (appendUniquePreview(previews, seen, preview)) {
      seriesCount += 1;
    }
    done += 1;
    onProgress?.(done, total);
  }

  return { previews, movies: movieCount, series: seriesCount, notFound };
}

function tmdbIdFromPreview(preview: MediaPreview): number | null {
  if (Number.isInteger(preview.tmdbId) && (preview.tmdbId ?? 0) > 0) {
    return preview.tmdbId!;
  }
  const match = /^tmdb-(\d+)$/.exec(preview.id);
  return match == null ? null : Number(match[1]);
}

function appendUniquePreview(
  previews: MediaPreview[],
  seen: Set<string>,
  preview: MediaPreview,
): boolean {
  const key = `${preview.type}:${preview.id}`;
  if (seen.has(key)) return false;
  seen.add(key);
  previews.push(preview);
  return true;
}

function previewFromDetail(item: MediaItem): MediaPreview {
  return {
    id: item.id,
    type: item.type,
    title: item.title,
    year: item.year,
    posterPath: item.posterPath,
    imdbRating: item.imdbRating,
    tmdbId: item.tmdbId,
    backdropPath: item.backdropPath,
  };
}

async function resolveTraktMovie(
  item: TraktWatchlistItem,
  tmdb: TraktWatchlistResolver,
): Promise<MediaPreview | null> {
  try {
    const tmdbId = await tmdb.findByImdbId(item.imdbID, "movie");
    if (tmdbId != null) {
      return previewFromDetail(await tmdb.getDetail(`tmdb-${tmdbId}`, "movie"));
    }
  } catch {
    // Fall through to a title/year search if IMDb reconciliation was unavailable.
  }
  return resolveTraktSearch(item.title, item.year, "movie", tmdb);
}

async function resolveTraktShow(
  item: TraktWatchlistShowItem,
  tmdb: TraktWatchlistResolver,
): Promise<MediaPreview | null> {
  let tmdbId = item.tmdbID;
  if (tmdbId == null && item.imdbID != null) {
    try {
      tmdbId = await tmdb.findByImdbId(item.imdbID, "series");
    } catch {
      // Fall through to a title/year search if IMDb reconciliation was unavailable.
    }
  }
  if (tmdbId != null) {
    try {
      return previewFromDetail(await tmdb.getDetail(`tmdb-${tmdbId}`, "series"));
    } catch {
      // Fall through to the normal typed title/year search below.
    }
  }
  return resolveTraktSearch(item.title, item.year, "series", tmdb);
}

function resolveTraktSearch(
  title: string,
  year: number | null,
  type: MediaType,
  tmdb: TraktWatchlistResolver,
): Promise<MediaPreview | null> {
  const entry: ImportEntry = { title, year, type };
  return resolveEntry(entry, async (query, requestedType) =>
    (await tmdb.search(query, requestedType)).items,
  );
}
