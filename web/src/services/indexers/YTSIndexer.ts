// Port of Sources/DebridStreamer/Services/Indexers/YTSIndexer.swift.
//
// YTS.mx API indexer for movies. JSON API at https://yts.mx/api. Mirrors the
// Swift actor: movies-only (returns [] for series), the
// "<titleLong> [<quality>] [<type>]" composed title, and per-torrent decoding.
// The Swift decoder uses convertFromSnakeCase; here we decode the raw
// snake_case JSON (title_long, size_bytes) explicitly.

import type { MediaType } from "../../models/media";
import { TorrentResult } from "./models";
import { defaultFetchImpl, type FetchImpl, IndexerError, type TorrentIndexer } from "./types";

interface RawYTSResponse {
  status: string;
  data: RawYTSData;
}

interface RawYTSData {
  movie_count?: number | null;
  movies?: RawYTSMovie[] | null;
}

interface RawYTSMovie {
  id?: number | null;
  title?: string | null;
  title_long?: string | null;
  year?: number | null;
  imdb_code?: string | null;
  torrents?: RawYTSTorrent[] | null;
}

interface RawYTSTorrent {
  hash?: string | null;
  quality?: string | null;
  type?: string | null;
  seeds?: number | null;
  peers?: number | null;
  size?: string | null;
  size_bytes?: number | null;
}

export class YTSIndexer implements TorrentIndexer {
  readonly name = "YTS";
  // Canonical domain. The previous mirror (yts.torrentbay.st) went permanently
  // 403 for every client — and the failure was silently absorbed for months
  // (nothing surfaced IndexerManager.lastSearchErrors until the honest empty
  // states landed). If this dies too, the UI now SAYS so.
  private readonly baseURL = "https://yts.mx/api/v2";
  private readonly fetchImpl: FetchImpl;

  constructor(fetchImpl: FetchImpl = defaultFetchImpl) {
    this.fetchImpl = fetchImpl;
  }

  async search(
    imdbId: string,
    type: MediaType,
    _season: number | null,
    _episode: number | null,
  ): Promise<TorrentResult[]> {
    // YTS only has movies.
    if (type !== "movie") return [];

    const url = `${this.baseURL}/list_movies.json?query_term=${imdbId}`;
    const movies = await this.fetchMovies(url);
    return this.mapMovies(movies);
  }

  async searchByQuery(query: string, type: MediaType): Promise<TorrentResult[]> {
    if (type !== "movie") return [];

    const encodedQuery = encodeURIComponent(query);
    const url = `${this.baseURL}/list_movies.json?query_term=${encodedQuery}&limit=20`;
    const movies = await this.fetchMovies(url);
    return this.mapMovies(movies);
  }

  /** Fetches + decodes the YTS movie list. Throws `IndexerError.badServerResponse`
   * on non-2xx; returns [] when `data.movies` is null/empty. */
  private async fetchMovies(url: string): Promise<RawYTSMovie[]> {
    const response = await this.fetchImpl(url);
    if (!(response.status >= 200 && response.status <= 299)) {
      throw IndexerError.badServerResponse(response.status);
    }
    const parsed = JSON.parse(await response.text()) as RawYTSResponse;
    const movies = parsed.data.movies;
    if (movies == null || movies.length === 0) return [];
    return movies;
  }

  private mapMovies(movies: RawYTSMovie[]): TorrentResult[] {
    const results: TorrentResult[] = [];
    for (const movie of movies) {
      const torrents = movie.torrents;
      if (torrents == null) continue;
      for (const torrent of torrents) {
        const hash = torrent.hash;
        if (hash == null || hash.length === 0) continue;

        const baseTitle = movie.title_long ?? movie.title ?? "Unknown";
        const title = `${baseTitle} [${torrent.quality ?? "?"}] [${torrent.type ?? ""}]`;
        const sizeBytes = torrent.size_bytes ?? 0;

        results.push(
          TorrentResult.fromSearch({
            infoHash: hash,
            title,
            sizeBytes,
            seeders: torrent.seeds ?? 0,
            leechers: torrent.peers ?? 0,
            indexerName: this.name,
          }),
        );
      }
    }
    return results;
  }
}
