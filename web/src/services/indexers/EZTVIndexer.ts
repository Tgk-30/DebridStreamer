// Port of Sources/DebridStreamer/Services/Indexers/EZTVIndexer.swift.
//
// EZTV API indexer for TV shows. JSON API at https://eztvx.to/api. Mirrors the
// Swift actor: series-only, the "tt" prefix stripped to a numeric IMDB id, the
// paginated get-torrents loop (max 3 pages, stop when a page is short of 100),
// and season/episode string-equality filtering. The Swift decoder uses
// convertFromSnakeCase; here we decode the raw snake_case JSON
// (size_bytes, magnet_url) explicitly.

import type { MediaType } from "../../models/media";
import { TorrentResult } from "./models";
import { defaultFetchImpl, type FetchImpl, IndexerError, type TorrentIndexer } from "./types";

interface RawEZTVResponse {
  torrents_count?: number | null;
  page?: number | null;
  torrents?: RawEZTVTorrent[] | null;
}

interface RawEZTVTorrent {
  id?: number | null;
  hash?: string | null;
  filename?: string | null;
  title?: string | null;
  season?: string | null;
  episode?: string | null;
  seeds?: number | null;
  peers?: number | null;
  size_bytes?: string | null;
  magnet_url?: string | null;
}

const PAGE_LIMIT = 100;
const MAX_PAGES = 3;

export class EZTVIndexer implements TorrentIndexer {
  readonly name = "EZTV";
  // eztvx.to went dark (connections hang); eztv.wf is the live API mirror that
  // still serves the same get-torrents JSON. EZTV domains rotate often — the
  // title-query path (APIBay) in data/streams.ts keeps series working even if
  // this one dies again.
  private readonly baseURL = "https://eztv.wf/api";
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
    // EZTV only has TV shows.
    if (type !== "series") return [];

    // EZTV uses the IMDB numeric ID without the "tt" prefix.
    const numericId = imdbId.replaceAll("tt", "");
    if (numericId.length === 0) return [];

    const results: TorrentResult[] = [];
    let page = 1;

    while (page <= MAX_PAGES) {
      const url = `${this.baseURL}/get-torrents?imdb_id=${numericId}&page=${page}&limit=${PAGE_LIMIT}`;
      const torrents = await this.fetchTorrents(url);
      if (torrents == null || torrents.length === 0) break;

      for (const torrent of torrents) {
        const hash = torrent.hash;
        if (hash == null || hash.length === 0) continue;

        // Filter by season/episode if specified (string equality, mirroring
        // the Swift `String(torrentSeason) == String(season)`).
        if (season != null && torrent.season != null) {
          if (torrent.season !== String(season)) continue;
        }
        if (episode != null && torrent.episode != null) {
          if (torrent.episode !== String(episode)) continue;
        }

        const title = torrent.title ?? torrent.filename ?? "Unknown";
        const sizeBytes =
          torrent.size_bytes != null
            ? Number.parseInt(torrent.size_bytes, 10) || 0
            : 0;

        results.push(
          TorrentResult.fromSearch({
            infoHash: hash,
            title,
            sizeBytes,
            seeders: torrent.seeds ?? 0,
            leechers: torrent.peers ?? 0,
            indexerName: this.name,
            magnetURI: torrent.magnet_url ?? null,
          }),
        );
      }

      // Stop when there are no more pages.
      if (torrents.length < PAGE_LIMIT) break;
      page += 1;
    }

    return results;
  }

  async searchByQuery(query: string, type: MediaType): Promise<TorrentResult[]> {
    if (type !== "series") return [];

    const encodedQuery = encodeURIComponent(query);
    const url = `${this.baseURL}/get-torrents?search=${encodedQuery}&limit=${PAGE_LIMIT}`;
    const torrents = await this.fetchTorrents(url);
    if (torrents == null || torrents.length === 0) return [];

    const results: TorrentResult[] = [];
    for (const torrent of torrents) {
      const hash = torrent.hash;
      if (hash == null || hash.length === 0) continue;

      const title = torrent.title ?? torrent.filename ?? "Unknown";
      const sizeBytes =
        torrent.size_bytes != null
          ? Number.parseInt(torrent.size_bytes, 10) || 0
          : 0;

      results.push(
        TorrentResult.fromSearch({
          infoHash: hash,
          title,
          sizeBytes,
          seeders: torrent.seeds ?? 0,
          leechers: torrent.peers ?? 0,
          indexerName: this.name,
          magnetURI: torrent.magnet_url ?? null,
        }),
      );
    }

    return results;
  }

  /** Fetches + decodes one EZTV page. Throws `IndexerError.badServerResponse`
   * on non-2xx; returns the (possibly null) torrents array. */
  private async fetchTorrents(url: string): Promise<RawEZTVTorrent[] | null> {
    const response = await this.fetchImpl(url);
    if (!(response.status >= 200 && response.status <= 299)) {
      throw IndexerError.badServerResponse(response.status);
    }
    const parsed = JSON.parse(await response.text()) as RawEZTVResponse;
    return parsed.torrents ?? null;
  }
}
