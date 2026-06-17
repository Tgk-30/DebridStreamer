// Port of Sources/DebridStreamer/Services/Metadata/OMDBService.swift.
//
// A thin, fetch-based OMDB client that enriches a title with IMDb / Rotten
// Tomatoes / Metacritic ratings keyed by IMDb id (B1). Mirrors the Swift actor:
// the same query params (`i` + `apikey`), the same defensive PascalCase parsing
// (string "N/A"/empty/garbage sentinels -> nil/undefined, RT% pulled out of the
// `Ratings` array and clamped to 0...100), a `Response:"False"` body mapped to a
// notFound throw, and non-2xx statuses mapped to an httpError throw. The Swift
// actor does NOT cache, so there is intentionally no TTL cache here. The `fetch`
// implementation is injectable so tests can stub the network (the Swift code
// injects a URLSession instead).

// MARK: - Public result type (mirrors Swift `OMDBRatings`)

/**
 * Aggregated ratings parsed from an OMDB lookup (B1).
 *
 * Every field is optional and defensively `undefined` when OMDB returns "N/A"
 * or an unparseable value — callers can surface whatever is present without
 * crashing. Mirrors Swift `OMDBRatings` (Swift `nil` -> TS `undefined`).
 */
export interface OMDBRatings {
  imdbRating?: number;
  rtPercent?: number;
  metascore?: number;
}

// MARK: - Raw OMDB response shapes (PascalCase, string "N/A" sentinels).
//
// OMDB uses PascalCase keys and string "N/A" sentinels for missing values, so
// this is decoded with the exact keys OMDB returns (no snake/camel strategy)
// and parsed defensively below. Mirrors the Swift `OMDBResponse` CodingKeys.

interface RawOMDBResponse {
  imdbRating?: string | null;
  Metascore?: string | null;
  Ratings?: RawOMDBRating[] | null;
  Response?: string | null;
  Error?: string | null;
}

interface RawOMDBRating {
  Source: string;
  Value: string;
}

// MARK: - Defensive parsers (mirror the private statics on OMDBResponse)

/** Parse "7.4" -> 7.4, ignoring "N/A" / empty / garbage. Mirrors `parseDouble`. */
function parseDouble(value: string | null | undefined): number | undefined {
  if (value == null || value === "N/A" || value.length === 0) return undefined;
  const parsed = Number.parseFloat(value.trim());
  // Swift's `Double(_:)` rejects trailing junk ("8x"); Number.parseFloat does
  // not, so reject any non-finite/partial parse to match the Swift semantics.
  if (!Number.isFinite(parsed) || !isFullNumber(value.trim())) return undefined;
  return parsed;
}

/** Parse "63" -> 63, ignoring "N/A" / empty / garbage. Mirrors `parseInt`. */
function parseIntStrict(value: string | null | undefined): number | undefined {
  if (value == null || value === "N/A" || value.length === 0) return undefined;
  const trimmed = value.trim();
  // Swift's `Int(_:)` requires the whole string be an integer literal.
  if (!/^[+-]?\d+$/.test(trimmed)) return undefined;
  const parsed = Number.parseInt(trimmed, 10);
  return Number.isNaN(parsed) ? undefined : parsed;
}

/** True when `s` is a complete numeric literal (no trailing junk), matching
 * Swift's strict `Double(_:)` / `Int(_:)` whole-string parsing. */
function isFullNumber(s: string): boolean {
  return /^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/.test(s);
}

/** Pull the Rotten Tomatoes entry out of the `Ratings` array and parse its
 * "74%" value into an Int in 0...100. Returns undefined if absent or
 * unparseable. Mirrors `rottenTomatoesPercent(from:)`. */
function rottenTomatoesPercent(
  ratings: RawOMDBRating[] | null | undefined,
): number | undefined {
  const entry = ratings?.find((r) => r.Source === "Rotten Tomatoes");
  if (entry == null) return undefined;
  // Swift filters to `\.isNumber` chars then `Int(digits)`; "74%" -> "74".
  const digits = entry.Value.replace(/\D/g, "");
  if (digits.length === 0) return undefined;
  const percent = Number.parseInt(digits, 10);
  if (Number.isNaN(percent)) return undefined;
  return Math.min(100, Math.max(0, percent));
}

/** Mirrors `OMDBResponse.toRatings()`. */
function toRatings(raw: RawOMDBResponse): OMDBRatings {
  const ratings: OMDBRatings = {};
  const imdbRating = parseDouble(raw.imdbRating);
  if (imdbRating !== undefined) ratings.imdbRating = imdbRating;
  const rtPercent = rottenTomatoesPercent(raw.Ratings);
  if (rtPercent !== undefined) ratings.rtPercent = rtPercent;
  const metascore = parseIntStrict(raw.Metascore);
  if (metascore !== undefined) ratings.metascore = metascore;
  return ratings;
}

// MARK: - Errors (mirror Swift `OMDBError`)

export type OMDBErrorKind =
  | "invalidURL"
  | "invalidResponse"
  | "httpError"
  | "notFound";

export class OMDBError extends Error {
  readonly kind: OMDBErrorKind;
  /** HTTP status code, present for `httpError`. */
  readonly statusCode?: number;
  /** The OMDB error message / imdb id, present for `notFound`. */
  readonly detail?: string;

  private constructor(
    kind: OMDBErrorKind,
    message: string,
    opts?: { statusCode?: number; detail?: string },
  ) {
    super(message);
    this.name = "OMDBError";
    this.kind = kind;
    this.statusCode = opts?.statusCode;
    this.detail = opts?.detail;
  }

  static invalidURL(): OMDBError {
    return new OMDBError("invalidURL", "Invalid OMDB URL");
  }
  static invalidResponse(): OMDBError {
    return new OMDBError("invalidResponse", "Invalid response from OMDB");
  }
  static httpError(code: number): OMDBError {
    return new OMDBError("httpError", `OMDB HTTP ${code}`, { statusCode: code });
  }
  static notFound(msg: string): OMDBError {
    return new OMDBError("notFound", `OMDB lookup failed: ${msg}`, {
      detail: msg,
    });
  }
}

// MARK: - Service

/** Injectable fetch signature (a subset of the DOM `fetch`). */
export type FetchImpl = (
  url: string,
  init?: { headers?: Record<string, string> },
) => Promise<{
  status: number;
  text(): Promise<string>;
}>;

/**
 * Thin OMDB API client used to enrich a title with IMDb / Rotten Tomatoes
 * ratings keyed by IMDb id (B1). Mirrors Swift `OMDBService`.
 */
export class OMDBService {
  private readonly apiKey: string;
  private readonly baseURL = "https://www.omdbapi.com/";
  private readonly fetchImpl: FetchImpl;

  constructor(apiKey: string, fetchImpl?: FetchImpl) {
    this.apiKey = apiKey;
    // Default to the global fetch; tests inject a stub.
    this.fetchImpl =
      fetchImpl ?? ((url, init) => fetch(url, init as RequestInit));
  }

  /**
   * Fetch ratings for an IMDb id (`tt…`). Throws on transport/decoding failures
   * and on an OMDB error response; the caller treats any throw as "no ratings
   * available" and silently skips. Mirrors Swift `fetchRatings(imdbId:)`.
   */
  async fetchRatings(imdbId: string): Promise<OMDBRatings> {
    let url: URL;
    try {
      url = new URL(this.baseURL);
    } catch {
      throw OMDBError.invalidURL();
    }
    url.searchParams.append("i", imdbId);
    url.searchParams.append("apikey", this.apiKey);

    const response = await this.fetchImpl(url.toString());
    const status = response.status;
    if (!(status >= 200 && status <= 299)) {
      throw OMDBError.httpError(status);
    }

    const text = await response.text();
    let decoded: RawOMDBResponse;
    try {
      decoded = JSON.parse(text) as RawOMDBResponse;
    } catch {
      throw OMDBError.invalidResponse();
    }

    if (decoded.Response?.toLowerCase() === "false") {
      throw OMDBError.notFound(decoded.Error ?? imdbId);
    }
    return toRatings(decoded);
  }
}
