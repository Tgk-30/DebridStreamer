// Metadata helpers shared by the Calendar + watchlist auto-resolve features.
//
// These build on the ported TMDBService (read-only) without modifying it:
//  - `resolveImdbId`     - derive the IMDb id (tt…) an indexer search needs.
//  - `getUpcomingEpisodes` - find a series' unaired / upcoming episodes by
//    walking seasons -> episodes and filtering by air date.
//
// Everything is fault-tolerant (a TMDB failure yields null / [] rather than
// throwing) and gates gracefully when no TMDB service is configured.

import type { MediaPreview, MediaType } from "../models/media";
import type { TMDBService } from "../services/metadata/TMDBService";

/** Derive the numeric TMDB id for a preview, from its `tmdbId` or `tmdb-{id}` id. */
export function tmdbIdOf(preview: MediaPreview): number | null {
  if (preview.tmdbId != null) return preview.tmdbId;
  if (preview.id.startsWith("tmdb-")) {
    const n = Number.parseInt(preview.id.slice(5), 10);
    return Number.isNaN(n) ? null : n;
  }
  if (/^[0-9]+$/.test(preview.id)) {
    const n = Number.parseInt(preview.id, 10);
    return Number.isNaN(n) ? null : n;
  }
  return null;
}

/** Resolve the IMDb id (tt…) for a preview via TMDB's detail/external-ids. The
 * preview id may already be an IMDb id (tt…); otherwise we fetch the detail,
 * whose id is an IMDb id when TMDB has one. Returns null when unresolved or no
 * TMDB key is configured. Never throws. */
export async function resolveImdbId(
  preview: MediaPreview,
  tmdb: TMDBService | null,
): Promise<string | null> {
  if (preview.id.startsWith("tt")) return preview.id;
  if (tmdb == null) return null;
  try {
    const detail = await tmdb.getDetail(preview.id, preview.type as MediaType);
    if (detail.id.startsWith("tt")) return detail.id;
  } catch {
    // fall through
  }
  // Last resort: external_ids by numeric tmdb id.
  const tmdbId = tmdbIdOf(preview);
  if (tmdbId == null) return null;
  try {
    const ids = await tmdb.getExternalIds(tmdbId, preview.type as MediaType);
    return ids.imdbId ?? null;
  } catch {
    return null;
  }
}

/** A single upcoming episode plus its parent series, for the Calendar agenda. */
export interface UpcomingEpisode {
  series: MediaPreview;
  seasonNumber: number;
  episodeNumber: number;
  title: string | null;
  /** ISO date (YYYY-MM-DD) the episode airs. Always present (filtered on it). */
  airDate: string;
}

/** A timestamp as a LOCAL `YYYY-MM-DD` string. TMDB air dates are bare
 * date-only strings with no timezone, so they must be compared against the
 * user's *local* calendar day. Using the UTC date (toISOString) misclassifies
 * by a day for non-UTC users in evening/early-morning windows - dropping
 * tonight's premiere as "already aired" or labeling tomorrow's as "Today". */
export function localISODate(now: number): string {
  const d = new Date(now);
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${month}-${day}`;
}

/** Today's date as a local `YYYY-MM-DD` string (TMDB air dates are date-only). */
function todayISODate(now: number): string {
  return localISODate(now);
}

/** Find a series' upcoming (today-or-later) episodes by walking TMDB seasons ->
 * episodes. Only TV series are considered; movies and no-key states yield [].
 *
 * To stay cheap and fault-tolerant we only inspect the LATEST season(s) - most
 * unaired episodes live in the current/last season. We look at the highest one
 * or two real seasons (skipping season 0 "specials"), pull their episodes, and
 * keep those with an air date >= today. Bounded so a series with many seasons
 * doesn't fan out into dozens of episode requests. Never throws. */
export async function getUpcomingEpisodes(
  series: MediaPreview,
  tmdb: TMDBService | null,
  now: number = Date.now(),
): Promise<UpcomingEpisode[]> {
  if (tmdb == null) return [];
  if (series.type !== "series") return [];
  const tmdbId = tmdbIdOf(series);
  if (tmdbId == null) return [];

  const today = todayISODate(now);

  try {
    const seasons = await tmdb.getSeasons(tmdbId);
    // Real seasons (skip specials at season 0), highest number first.
    const realSeasons = seasons
      .filter((s) => s.seasonNumber > 0)
      .sort((a, b) => b.seasonNumber - a.seasonNumber);
    if (realSeasons.length === 0) return [];

    // Inspect at most the latest two seasons - enough to catch a season that has
    // started airing plus the next one, without fanning out across the whole run.
    const candidates = realSeasons.slice(0, 2);

    const perSeason = await Promise.all(
      candidates.map(async (season) => {
        try {
          const episodes = await tmdb.getEpisodes(tmdbId, season.seasonNumber);
          return episodes
            .filter((ep) => ep.airDate != null && ep.airDate >= today)
            .map<UpcomingEpisode>((ep) => ({
              series,
              seasonNumber: ep.seasonNumber,
              episodeNumber: ep.episodeNumber,
              title: ep.title ?? null,
              airDate: ep.airDate as string,
            }));
        } catch {
          return [] as UpcomingEpisode[];
        }
      }),
    );

    return perSeason
      .flat()
      .sort((a, b) => a.airDate.localeCompare(b.airDate));
  } catch {
    return [];
  }
}

/** Concurrently gather upcoming episodes for many series, deduping the series by
 * id first so the same show in both Library + Watchlist isn't fetched twice.
 * Fault-tolerant: per-series failures are dropped. Flattened + date-sorted. */
export async function getUpcomingEpisodesForSeries(
  seriesList: MediaPreview[],
  tmdb: TMDBService | null,
  now: number = Date.now(),
): Promise<UpcomingEpisode[]> {
  if (tmdb == null) return [];
  const seen = new Set<string>();
  const unique = seriesList.filter((s) => {
    if (s.type !== "series") return false;
    if (seen.has(s.id)) return false;
    seen.add(s.id);
    return true;
  });

  const all = await Promise.all(
    unique.map((s) => getUpcomingEpisodes(s, tmdb, now)),
  );
  return all.flat().sort((a, b) => a.airDate.localeCompare(b.airDate));
}
