// Pure, React-free stream-search matching helpers.
//
// These back the two-pass stream search (an imdb-native pass + a title/name
// pass) in BOTH Local Mode (web/src/data/streams.ts) and Server Mode
// (server/src/media-runtime.js). They live in one module, imported by both, so
// the two modes can never drift into showing different lists - the same class
// of bug the Data Saver clamp comment warns about. Nothing here touches React
// or the DOM, so the server bundles it cleanly.

import { VideoQuality, type TorrentResult } from "../services/indexers/models";

/** The human-title query for the NAME-matching indexers (APIBay etc.). They
 * search torrent titles, so an imdb id returns nothing there - an episode needs
 * the `Title SxxEyy` form and a movie just the title. */
export function buildTitleQuery(
  title: string,
  season: number | null,
  episode: number | null,
): string {
  const base = title.trim();
  if (season != null && episode != null) {
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${base} S${pad(season)}E${pad(episode)}`;
  }
  return base;
}

/** Lowercase, fold the "&"/"and" connector, strip everything non-alphanumeric to
 * spaces, collapse. The "&" → "and" fold (applied to BOTH the title and the
 * release name) keeps the contiguous-phrase match in filterResultsByTitle from
 * dropping a valid release that spells the connector out - e.g. title
 * "Dungeons & Dragons" vs release "Dungeons.and.Dragons…", or "Tom & Jerry" vs
 * "Tom.and.Jerry…". */
function normalizeForMatch(s: string): string {
  return s
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Keep only title-pass results whose release name contains the requested title
 * as a CONTIGUOUS whole-word phrase. The name-matching indexers (APIBay) do a
 * loose substring search, so requiring only that each title word appear somewhere
 * lets a different show leak in - e.g. "The Bear" would match
 * "The Adventures of Paddington Bear" because both "the" and "bear" are present.
 * Requiring the whole normalized title (" the bear ") as an adjacent run of whole
 * words rejects those cross-show matches while still tolerating the release's
 * separators/casing. Release names conventionally lead with the contiguous title,
 * and the imdb pass already covers the rare reordered/article-dropped release, so
 * this only tightens the (additive, best-effort) title pass. */
export function filterResultsByTitle(
  results: TorrentResult[],
  title: string,
): TorrentResult[] {
  const phrase = normalizeForMatch(title);
  if (phrase.length === 0) return results;
  const needle = ` ${phrase} `;
  return results.filter((r) => ` ${normalizeForMatch(r.title)} `.includes(needle));
}

/** Merge two result sets: dedupe by infoHash (keep the higher-seeder copy) and
 * sort by quality then seeders. Lets the imdb-based and title-based passes be
 * combined without double-listing the same torrent. */
function mergeResults(
  a: TorrentResult[],
  b: TorrentResult[],
): TorrentResult[] {
  const byHash = new Map<string, TorrentResult>();
  for (const r of a.concat(b)) {
    const key = r.infoHash.toLowerCase();
    const existing = byHash.get(key);
    if (existing == null || r.seeders > existing.seeders) byHash.set(key, r);
  }
  return [...byHash.values()].sort((x, y) => {
    if (x.quality !== y.quality) {
      return VideoQuality.sortOrder(y.quality) - VideoQuality.sortOrder(x.quality);
    }
    return y.seeders - x.seeders;
  });
}

/** Combine an imdb-native pass with a title/name pass into one ranked result
 * set. The imdb pass is title-exact; the title pass is a loose name search, so
 * validate it against the requested title (when known) before merging. Shared
 * so Local + Server Mode fold the two passes together identically. */
export function combineStreamResults(
  byImdb: TorrentResult[],
  byTitle: TorrentResult[],
  title: string | null,
): TorrentResult[] {
  const validatedByTitle =
    title != null ? filterResultsByTitle(byTitle, title) : byTitle;
  return mergeResults(byImdb, validatedByTitle);
}
