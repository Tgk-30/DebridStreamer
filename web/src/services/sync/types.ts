// Port of the error type and raw response shapes used by the sync services in
//   Sources/DebridStreamer/Services/Sync/TraktSyncService.swift.
//
// Mirrors the TMDB template: a typed Error class with a `kind` discriminator,
// plus the raw snake_case interfaces the Trakt API returns and the explicit
// mappers that turn them into the domain models in ./models.ts.

import type {
  TraktDeviceCodeResponse,
  TraktTokenResponse,
  TraktWatchlistItem,
  TraktWatchlistPushResult,
} from "./models";

// MARK: - Error type (mirrors Swift `TraktSyncError`)

/**
 * Error kinds returned by the Trakt sync service. Mirrors Swift
 * `TraktSyncError`, carrying the same human-facing descriptions via `message`.
 */
export type TraktSyncErrorKind =
  | "invalidURL"
  | "invalidResponse"
  | "decodingFailed"
  | "httpStatus";

export class TraktSyncError extends Error {
  readonly kind: TraktSyncErrorKind;
  /** HTTP status code, present for `httpStatus`. */
  readonly statusCode?: number;
  /** Response body, present for `httpStatus`. */
  readonly body?: string;
  /** Decoder failure detail, present for `decodingFailed`. */
  readonly detail?: string;

  private constructor(
    kind: TraktSyncErrorKind,
    message: string,
    extra?: { statusCode?: number; body?: string; detail?: string },
  ) {
    super(message);
    this.name = "TraktSyncError";
    this.kind = kind;
    this.statusCode = extra?.statusCode;
    this.body = extra?.body;
    this.detail = extra?.detail;
  }

  static invalidURL(): TraktSyncError {
    return new TraktSyncError("invalidURL", "Invalid Trakt URL.");
  }
  static invalidResponse(): TraktSyncError {
    return new TraktSyncError("invalidResponse", "Invalid Trakt response.");
  }
  static decodingFailed(detail: string): TraktSyncError {
    return new TraktSyncError(
      "decodingFailed",
      `Failed to decode Trakt response: ${detail}`,
      { detail },
    );
  }
  static httpStatus(status: number, body: string): TraktSyncError {
    return new TraktSyncError("httpStatus", `Trakt HTTP ${status}: ${body}`, {
      statusCode: status,
      body,
    });
  }
}

// MARK: - Raw Trakt response shapes (snake_case as the API returns them)
//
// The Swift code relies on JSONDecoder + CodingKeys. In TS we decode the raw
// snake_case JSON explicitly, keeping the mapping in one place.

export interface RawTraktDeviceCodeResponse {
  device_code: string;
  user_code: string;
  verification_url: string;
  expires_in: number;
  interval: number;
}

export interface RawTraktTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: string;
  scope: string;
  created_at: number;
}

/** One element of `GET /sync/watchlist/movies`. */
export interface RawTraktWatchlistResponseItem {
  movie?: RawTraktWatchlistMovie | null;
}

export interface RawTraktWatchlistMovie {
  title: string;
  year?: number | null;
  ids: RawTraktWatchlistMovieIDs;
}

export interface RawTraktWatchlistMovieIDs {
  imdb?: string | null;
}

/** Body of `POST /sync/watchlist`. */
export interface RawTraktWatchlistPushResult {
  added?: RawTraktPushCounts | null;
  existing?: RawTraktPushCounts | null;
  not_found?: RawTraktPushNotFound | null;
}

export interface RawTraktPushCounts {
  movies?: number | null;
}

export interface RawTraktPushNotFound {
  movies?: RawTraktPushNotFoundMovie[] | null;
}

export interface RawTraktPushNotFoundMovie {
  ids?: RawTraktPushNotFoundIDs | null;
}

export interface RawTraktPushNotFoundIDs {
  imdb?: string | null;
}

// MARK: - Decoders (raw snake_case JSON -> domain models)
//
// Each mirrors a Swift `Decodable` conformance: it asserts the *required* keys
// (the non-optional Swift properties) are present and of the right type, then
// maps. A missing/mismatched required key throws `TraktSyncError.decodingFailed`
// — the TS analogue of JSONDecoder throwing — so a 200 body of the wrong shape
// surfaces `decodingFailed`, never `invalidResponse`.

function asObject(raw: unknown, what: string): Record<string, unknown> {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) {
    throw TraktSyncError.decodingFailed(`Expected object for ${what}`);
  }
  return raw as Record<string, unknown>;
}

function requireString(
  obj: Record<string, unknown>,
  key: string,
  what: string,
): string {
  const value = obj[key];
  if (typeof value !== "string") {
    throw TraktSyncError.decodingFailed(`Missing string '${key}' in ${what}`);
  }
  return value;
}

function requireNumber(
  obj: Record<string, unknown>,
  key: string,
  what: string,
): number {
  const value = obj[key];
  if (typeof value !== "number") {
    throw TraktSyncError.decodingFailed(`Missing number '${key}' in ${what}`);
  }
  return value;
}

function optionalNumber(value: unknown): number | null {
  return typeof value === "number" ? value : null;
}

export function decodeDeviceCodeResponse(
  raw: unknown,
): TraktDeviceCodeResponse {
  const r = asObject(raw, "TraktDeviceCodeResponse") as RawTraktDeviceCodeResponse &
    Record<string, unknown>;
  return {
    deviceCode: requireString(r, "device_code", "TraktDeviceCodeResponse"),
    userCode: requireString(r, "user_code", "TraktDeviceCodeResponse"),
    verificationURL: requireString(
      r,
      "verification_url",
      "TraktDeviceCodeResponse",
    ),
    expiresIn: requireNumber(r, "expires_in", "TraktDeviceCodeResponse"),
    interval: requireNumber(r, "interval", "TraktDeviceCodeResponse"),
  };
}

export function decodeTokenResponse(raw: unknown): TraktTokenResponse {
  const r = asObject(raw, "TraktTokenResponse") as RawTraktTokenResponse &
    Record<string, unknown>;
  return {
    accessToken: requireString(r, "access_token", "TraktTokenResponse"),
    refreshToken: requireString(r, "refresh_token", "TraktTokenResponse"),
    expiresIn: requireNumber(r, "expires_in", "TraktTokenResponse"),
    tokenType: requireString(r, "token_type", "TraktTokenResponse"),
    scope: requireString(r, "scope", "TraktTokenResponse"),
    createdAt: requireNumber(r, "created_at", "TraktTokenResponse"),
  };
}

/** Mirrors the `compactMap` in `fetchWatchlist`: requires the body to be an
 * array (per Swift `[ResponseItem]`), then drops entries lacking a movie or an
 * imdb id. */
export function decodeWatchlistItems(raw: unknown): TraktWatchlistItem[] {
  if (!Array.isArray(raw)) {
    throw TraktSyncError.decodingFailed("Expected array for watchlist");
  }
  const items: TraktWatchlistItem[] = [];
  for (const element of raw as RawTraktWatchlistResponseItem[]) {
    const movie = element?.movie;
    if (movie == null) continue;
    const imdb = movie.ids?.imdb;
    if (imdb == null) continue;
    items.push({ imdbID: imdb, title: movie.title, year: movie.year ?? null });
  }
  return items;
}

/** All fields of `TraktWatchlistPushResult` are optional in Swift, so any object
 * decodes (counts default to null when absent). */
export function decodeWatchlistPushResult(
  raw: unknown,
): TraktWatchlistPushResult {
  const r = asObject(raw, "TraktWatchlistPushResult") as RawTraktWatchlistPushResult;
  return {
    added: r.added ? { movies: optionalNumber(r.added.movies) } : null,
    existing: r.existing ? { movies: optionalNumber(r.existing.movies) } : null,
    notFound: r.not_found
      ? {
          movies:
            r.not_found.movies?.map((m) => ({
              ids: m.ids ? { imdb: m.ids.imdb ?? null } : null,
            })) ?? null,
        }
      : null,
  };
}
