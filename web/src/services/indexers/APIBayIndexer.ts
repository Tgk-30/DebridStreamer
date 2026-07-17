// Port of Sources/DebridStreamer/Services/Indexers/APIBayIndexer.swift.
//
// APIBay (The Pirate Bay proxy) indexer for movies and TV. JSON API at
// https://apibay.org. Mirrors the Swift actor: same q.php endpoint + category
// IDs, the "No results returned" sentinel + all-zero infohash + dead-torrent
// (0 seeders) filtering, and the anchored SxxEyy season/episode regex.

import type { MediaType } from "../../models/media";
import { TorrentResult } from "./models";
import { defaultFetchImpl, type FetchImpl, IndexerError, type TorrentIndexer } from "./types";

// Category IDs for video content (mirrors the Swift `Category` enum).
const Category = {
  movies: "201", // Movies
  tvShows: "205", // TV Shows
  hdMovies: "207", // HD Movies
  hdTV: "208", // HD TV Shows
} as const;

/** Raw APIBay item (all fields are strings as the API returns them). Mirrors
 * `APIBayItem` incl. its `info_hash`/`num_files` snake_case keys. */
interface RawAPIBayItem {
  id: string;
  name: string;
  info_hash: string;
  leechers: string;
  seeders: string;
  size: string;
  num_files?: string | null;
  username?: string | null;
  added?: string | null;
  status?: string | null;
  category?: string | null;
  imdb?: string | null;
}

const ALL_ZERO_HASH = "0000000000000000000000000000000000000000";

type APIBayCategory =
  | "200" // All Video
  | "201" // Movies
  | "205" // TV Shows
  | "207" // HD Movies
  | "208"; // HD TV Shows

function buildSearchCategories(type: MediaType): APIBayCategory[] {
  return type === "movie"
    ? [Category.hdMovies, Category.movies, "200"]
    : [Category.hdTV, Category.tvShows, "200"];
}

function buildSeasonEpisodeRegex(season: number, episode: number): RegExp[] {
  const seasonPattern = String(season);
  const episodePattern = String(episode);
  const season2 = seasonPattern.padStart(2, "0");
  const episode2 = episodePattern.padStart(2, "0");
  return [
    new RegExp(`\\bS\\s*${seasonPattern}\\s*[._\\-]?\\s*E\\s*${episodePattern}`, "i"),
    new RegExp(`\\bS\\s*${seasonPattern}\\s*[._\\-]?\\s*EP\\s*${episodePattern}`, "i"),
    new RegExp(`\\bS\\s*${season2}\\s*[._\\-]?\\s*E\\s*${episode2}`, "i"),
    new RegExp(`\\bS\\s*${season2}\\s*[._\\-]?\\s*[xX]\\s*${episode2}`, "i"),
    new RegExp(`\\b0?${seasonPattern}\\s*[xX]\\s*0?${episodePattern}(?!\\d)`, "i"),
  ];
}

function buildFallbackIMDbIDs(imdbId: string): string[] {
  const trimmed = imdbId.trim();
  if (trimmed.length === 0) return [];

  const ids = [trimmed];
  if (trimmed.toLowerCase().startsWith("tt") && trimmed.length > 2) {
    ids.push(trimmed.slice(2));
  }

  return [...new Set(ids)];
}

function titleMatchesSeasonEpisode(
  title: string,
  season: number,
  episode: number,
): boolean {
  return buildSeasonEpisodeRegex(season, episode).some((regex) =>
    regex.test(title),
  );
}

export class APIBayIndexer implements TorrentIndexer {
  readonly name = "APIBay";
  private readonly baseURL = "https://apibay.org";
  private readonly fetchImpl: FetchImpl;

  constructor(fetchImpl: FetchImpl = defaultFetchImpl) {
    this.fetchImpl = fetchImpl;
  }

  async search(
    imdbId: string,
    type: MediaType,
    season: number | null,
    episode: number | null,
  ): Promise<TorrentResult[]> {
    const queries = buildFallbackIMDbIDs(imdbId);
    if (queries.length === 0) {
      return [];
    }
    const categories = buildSearchCategories(type);
    const seen = new Set<string>();
    const results: TorrentResult[] = [];

    for (const category of categories) {
      for (const query of queries) {
        const url = `${this.baseURL}/q.php?q=${encodeURIComponent(query)}&cat=${category}`;
        const items = await this.fetchItems(url);
        if (items == null) continue;

        for (const item of items) {
          const hash = item.info_hash;
          if (hash.length === 0 || hash === ALL_ZERO_HASH) continue;

          if (
            type === "series" &&
            season != null &&
            episode != null &&
            !titleMatchesSeasonEpisode(item.name, season, episode)
          ) {
            continue;
          }

          const seeders = Number.parseInt(item.seeders, 10) || 0;
          const leechers = Number.parseInt(item.leechers, 10) || 0;
          const sizeBytes = Number.parseInt(item.size, 10) || 0;

          // Skip dead torrents.
          if (seeders <= 0) continue;

          const normalizedHash = hash.toLowerCase();
          if (seen.has(normalizedHash)) continue;
          seen.add(normalizedHash);

          results.push(
            TorrentResult.fromSearch({
              infoHash: hash,
              title: item.name,
              sizeBytes,
              seeders,
              leechers,
              indexerName: this.name,
            }),
          );
        }

        if (results.length > 0) {
          return results;
        }
      }
    }

    return results;
  }

  async searchByQuery(query: string, type: MediaType): Promise<TorrentResult[]> {
    const trimmedQuery = query.trim();
    if (trimmedQuery.length === 0) {
      return [];
    }

    const encodedQuery = encodeURIComponent(trimmedQuery);
    const categories = buildSearchCategories(type);
    const seen = new Set<string>();

    const results: TorrentResult[] = [];
    for (const category of categories) {
      const url = `${this.baseURL}/q.php?q=${encodedQuery}&cat=${category}`;
      const items = await this.fetchItems(url);
      if (items == null) continue;

      for (const item of items) {
        const hash = item.info_hash;
        if (hash.length === 0 || hash === ALL_ZERO_HASH) continue;

        const seeders = Number.parseInt(item.seeders, 10) || 0;
        const leechers = Number.parseInt(item.leechers, 10) || 0;
        const sizeBytes = Number.parseInt(item.size, 10) || 0;

        if (seeders <= 0) continue;

        const normalizedHash = hash.toLowerCase();
        if (seen.has(normalizedHash)) continue;
        seen.add(normalizedHash);

        results.push(
          TorrentResult.fromSearch({
            infoHash: hash,
            title: item.name,
            sizeBytes,
            seeders,
            leechers,
            indexerName: this.name,
          }),
        );
      }

      if (results.length > 0) return results;
    }

    return results;
  }

  /** Fetches + decodes the APIBay list, returning `null` when the body is empty
   * or is the "No results returned" sentinel (caller maps that to []). Throws
   * `IndexerError.badServerResponse` on non-2xx. */
  private async fetchItems(url: string): Promise<RawAPIBayItem[] | null> {
    const response = await this.fetchImpl(url);
    if (!(response.status >= 200 && response.status <= 299)) {
      throw IndexerError.badServerResponse(response.status);
    }
    const items = JSON.parse(await response.text()) as RawAPIBayItem[];
    if (items.length === 0 || items[0]?.name === "No results returned") {
      return null;
    }
    return items;
  }
}
