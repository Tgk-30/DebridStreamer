// Port of Sources/DebridStreamer/Services/Sync/TraktSyncService.swift.
//
// A fetch-based Trakt sync client. Mirrors the Swift actor's behavior: the same
// API paths/methods, the same request headers (Content-Type, trakt-api-version,
// trakt-api-key, Authorization Bearer), the token expiry math, and the
// decode/error-mapping (httpStatus vs decodingFailed). The `fetch`
// implementation is injectable so tests can stub the network (the Swift code
// injects a URLSession instead). There is no caching in the Swift service, so
// - unlike the TMDB template - there is no TTL cache here.
//
// Note on decodingFailed: Swift's JSONDecoder throws when a *structurally*
// invalid body (valid JSON, wrong shape - e.g. `{"unexpected":true}`) is fed to
// a Decodable with required keys. `JSON.parse` does NOT throw for that, so each
// strongly-typed decode runs an explicit shape `decode` callback; any throw
// inside it (parse failure OR missing required field) is mapped to
// `decodingFailed`, exactly as Swift maps any decode error.

import {
  type TraktDeviceCodeResponse,
  type TraktScrobbleItem,
  type TraktTokenResponse,
  type TraktWatchlistItem,
  type TraktWatchlistShowItem,
  type TraktWatchlistPushResult,
} from "./models";
import {
  decodeDeviceCodeResponse,
  decodeScrobbleResult,
  decodeTokenResponse,
  decodeWatchlistItems,
  decodeWatchlistShowItems,
  decodeWatchlistPushResult,
  encodeScrobbleItem,
  TraktSyncError,
} from "./types";

/** Injectable fetch signature (a subset of the DOM `fetch`). Mirrors the
 * `URLSession` the Swift actor injects. */
export type FetchImpl = (
  url: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  },
) => Promise<{
  status: number;
  text(): Promise<string>;
}>;

export class TraktSyncService {
  private readonly baseURL = "https://api.trakt.tv";
  private readonly fetchImpl: FetchImpl;

  /** Default safety buffer (seconds) before the real expiry at which a token is
   * considered expired, so callers refresh proactively rather than racing a
   * 401. Mirrors Swift `defaultExpiryBuffer` (24h). */
  static readonly defaultExpiryBuffer = 24 * 60 * 60;

  constructor(fetchImpl?: FetchImpl) {
    // Default to the global fetch; tests inject a stub.
    this.fetchImpl =
      fetchImpl ?? ((url, init) => fetch(url, init as RequestInit));
  }

  /**
   * Returns true when a token issued at `createdAt` (Unix seconds) with lifetime
   * `expiresIn` (seconds) is at or past its expiry, accounting for `buffer`.
   * Both `createdAt` and `expiresIn` come directly from `TraktTokenResponse`.
   * `now` is epoch seconds (Swift passes a `Date`; here a number keeps it pure).
   * Mirrors Swift `isExpired`.
   */
  static isExpired(
    createdAt: number,
    expiresIn: number,
    now: number = Date.now() / 1000,
    buffer: number = TraktSyncService.defaultExpiryBuffer,
  ): boolean {
    const expiry = createdAt + expiresIn;
    return expiry - now <= buffer;
  }

  // MARK: - OAuth device flow

  async startDeviceAuth(clientID: string): Promise<TraktDeviceCodeResponse> {
    return this.request({
      path: "/oauth/device/code",
      method: "POST",
      body: { client_id: clientID },
      decode: decodeDeviceCodeResponse,
    });
  }

  async exchangeDeviceCode(
    clientID: string,
    clientSecret: string,
    deviceCode: string,
  ): Promise<TraktTokenResponse> {
    return this.request({
      path: "/oauth/device/token",
      method: "POST",
      body: {
        code: deviceCode,
        client_id: clientID,
        client_secret: clientSecret,
      },
      decode: decodeTokenResponse,
    });
  }

  async refreshToken(
    clientID: string,
    clientSecret: string,
    refreshToken: string,
  ): Promise<TraktTokenResponse> {
    return this.request({
      path: "/oauth/token",
      method: "POST",
      body: {
        refresh_token: refreshToken,
        client_id: clientID,
        client_secret: clientSecret,
        grant_type: "refresh_token",
      },
      decode: decodeTokenResponse,
    });
  }

  // MARK: - Sync

  async fetchWatchlist(
    clientID: string,
    accessToken: string,
  ): Promise<TraktWatchlistItem[]> {
    return this.request({
      path: "/sync/watchlist/movies",
      method: "GET",
      traktClientID: clientID,
      accessToken,
      decode: decodeWatchlistItems,
    });
  }

  async fetchWatchlistShows(
    clientID: string,
    accessToken: string,
  ): Promise<TraktWatchlistShowItem[]> {
    return this.request({
      path: "/sync/watchlist/shows",
      method: "GET",
      traktClientID: clientID,
      accessToken,
      decode: decodeWatchlistShowItems,
    });
  }

  async pushWatchlist(
    clientID: string,
    accessToken: string,
    imdbIDs: string[],
    showTMDBIDs: number[] = [],
  ): Promise<TraktWatchlistPushResult> {
    const payload = {
      movies: imdbIDs.map((imdb) => ({ ids: { imdb } })),
      shows: showTMDBIDs.map((tmdb) => ({ ids: { tmdb } })),
    };
    return this.request({
      path: "/sync/watchlist",
      method: "POST",
      traktClientID: clientID,
      accessToken,
      body: payload,
      decode: decodeWatchlistPushResult,
    });
  }

  async scrobbleStart(
    clientID: string,
    accessToken: string,
    item: TraktScrobbleItem,
  ): Promise<void> {
    return this.scrobble("start", clientID, accessToken, item);
  }

  async scrobblePause(
    clientID: string,
    accessToken: string,
    item: TraktScrobbleItem,
  ): Promise<void> {
    return this.scrobble("pause", clientID, accessToken, item);
  }

  async scrobbleStop(
    clientID: string,
    accessToken: string,
    item: TraktScrobbleItem,
  ): Promise<void> {
    return this.scrobble("stop", clientID, accessToken, item);
  }

  private async scrobble(
    action: "start" | "pause" | "stop",
    clientID: string,
    accessToken: string,
    item: TraktScrobbleItem,
  ): Promise<void> {
    await this.request({
      path: `/scrobble/${action}`,
      method: "POST",
      traktClientID: clientID,
      accessToken,
      body: encodeScrobbleItem(item),
      decode: decodeScrobbleResult,
    });
  }

  // MARK: - HTTP
  //
  // Mirrors the Swift `request` generic: builds the URL, sets the fixed headers,
  // optionally sets trakt-api-key / Authorization, encodes the JSON body, then
  // maps non-2xx to `httpStatus` and a decode failure to `decodingFailed`.

  private async request<T>(opts: {
    path: string;
    method: string;
    traktClientID?: string | null;
    accessToken?: string | null;
    body?: unknown;
    decode: (raw: unknown) => T;
  }): Promise<T> {
    let url: string;
    try {
      url = new URL(this.baseURL + opts.path).toString();
    } catch {
      throw TraktSyncError.invalidURL();
    }

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "trakt-api-version": "2",
    };
    if (opts.traktClientID != null) {
      headers["trakt-api-key"] = opts.traktClientID;
    }
    if (opts.accessToken != null) {
      headers.Authorization = `Bearer ${opts.accessToken}`;
    }

    const response = await this.fetchImpl(url, {
      method: opts.method,
      headers,
      body: opts.body != null ? JSON.stringify(opts.body) : undefined,
    });

    const status = response.status;
    const text = await response.text();

    if (!(status >= 200 && status <= 299)) {
      throw TraktSyncError.httpStatus(status, text);
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (error) {
      throw TraktSyncError.decodingFailed(String(error));
    }

    try {
      return opts.decode(parsed);
    } catch (error) {
      if (error instanceof TraktSyncError) throw error;
      throw TraktSyncError.decodingFailed(String(error));
    }
  }
}
