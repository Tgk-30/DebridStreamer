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
    const cat = type === "movie" ? Category.hdMovies : Category.hdTV;
    const url = `${this.baseURL}/q.php?q=${imdbId}&cat=${cat}`;

    const items = await this.fetchItems(url);
    if (items == null) return [];

    const results: TorrentResult[] = [];
    for (const item of items) {
      const hash = item.info_hash;
      if (hash.length === 0 || hash === ALL_ZERO_HASH) continue;

      // Filter by season/episode for TV shows using an anchored SxxEyy regex.
      // Requires a contiguous S<season><sep>E<episode> token (allowing common
      // separators like dot/space/dash) to avoid false positives from stray
      // non-contiguous matches such as "S01E05.x264-E01TUREL".
      if (type === "series" && season != null && episode != null) {
        const titleUpper = item.name.toUpperCase();
        const pad = (n: number) => String(n).padStart(2, "0");
        const pattern = new RegExp(`S${pad(season)}[ ._-]?E${pad(episode)}`);
        if (!pattern.test(titleUpper)) continue;
      }

      const seeders = Number.parseInt(item.seeders, 10) || 0;
      const leechers = Number.parseInt(item.leechers, 10) || 0;
      const sizeBytes = Number.parseInt(item.size, 10) || 0;

      // Skip dead torrents.
      if (seeders <= 0) continue;

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

    return results;
  }

  async searchByQuery(query: string, type: MediaType): Promise<TorrentResult[]> {
    const encodedQuery = encodeURIComponent(query);
    const cat = type === "movie" ? Category.movies : Category.tvShows;
    const url = `${this.baseURL}/q.php?q=${encodedQuery}&cat=${cat}`;

    const items = await this.fetchItems(url);
    if (items == null) return [];

    const results: TorrentResult[] = [];
    for (const item of items) {
      const hash = item.info_hash;
      if (hash.length === 0 || hash === ALL_ZERO_HASH) continue;

      const seeders = Number.parseInt(item.seeders, 10) || 0;
      const leechers = Number.parseInt(item.leechers, 10) || 0;
      const sizeBytes = Number.parseInt(item.size, 10) || 0;

      if (seeders <= 0) continue;

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
