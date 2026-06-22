// Server-side OMDb rating lookup.
//
// This is the "hidden key" path: the OMDb API key lives ONLY on the server
// (env DS_SERVER_OMDB_API_KEY, or an encrypted server/profile credential in the
// DB) and the server makes the OMDb request on the client's behalf. The client
// receives only the parsed ratings — never the key, and never the OMDb request
// itself — so a limited-distribution build can ship rich ratings with a key
// that cannot be extracted from the client or sniffed off the client's wire.
//
// Defensive parsing mirrors the web OMDBService (PascalCase keys, "N/A"
// sentinels → undefined, Rotten Tomatoes pulled from the Ratings array).

export interface OMDBRatings {
  imdbRating?: number;
  rtPercent?: number;
  metascore?: number;
}

interface RawOMDBRating {
  Source?: string;
  Value?: string;
}

interface RawOMDBResponse {
  imdbRating?: string | null;
  Metascore?: string | null;
  Ratings?: RawOMDBRating[] | null;
  Response?: string | null;
}

function isFullNumber(s: string): boolean {
  return /^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/.test(s);
}

function parseDouble(value: string | null | undefined): number | undefined {
  if (value == null || value === "N/A" || value.length === 0) return undefined;
  const trimmed = value.trim();
  const parsed = Number.parseFloat(trimmed);
  if (!Number.isFinite(parsed) || !isFullNumber(trimmed)) return undefined;
  return parsed;
}

function parseIntStrict(value: string | null | undefined): number | undefined {
  if (value == null || value === "N/A" || value.length === 0) return undefined;
  const trimmed = value.trim();
  if (!/^[+-]?\d+$/.test(trimmed)) return undefined;
  const parsed = Number.parseInt(trimmed, 10);
  return Number.isNaN(parsed) ? undefined : parsed;
}

function rottenTomatoesPercent(ratings: RawOMDBRating[] | null | undefined): number | undefined {
  const entry = ratings?.find((r) => r.Source === "Rotten Tomatoes");
  if (entry?.Value == null) return undefined;
  const digits = entry.Value.replace(/\D/g, "");
  if (digits.length === 0) return undefined;
  const percent = Number.parseInt(digits, 10);
  if (Number.isNaN(percent)) return undefined;
  return Math.min(100, Math.max(0, percent));
}

export function parseOmdbRatings(raw: RawOMDBResponse): OMDBRatings {
  const ratings: OMDBRatings = {};
  const imdbRating = parseDouble(raw.imdbRating);
  if (imdbRating !== undefined) ratings.imdbRating = imdbRating;
  const rtPercent = rottenTomatoesPercent(raw.Ratings);
  if (rtPercent !== undefined) ratings.rtPercent = rtPercent;
  const metascore = parseIntStrict(raw.Metascore);
  if (metascore !== undefined) ratings.metascore = metascore;
  return ratings;
}

/** True for an empty result (no usable ratings). */
export function isEmptyRatings(r: OMDBRatings): boolean {
  return r.imdbRating === undefined && r.rtPercent === undefined && r.metascore === undefined;
}

const OMDB_BASE = "https://www.omdbapi.com/";

/**
 * Fetch ratings for an IMDb id using a server-held key. The host is fixed and
 * the id is strictly validated (`tt\d+`), so there is no SSRF surface. Returns
 * `null` on any failure (bad id, transport error, OMDb "Response":"False", or
 * an unparseable body) — callers treat that as "no ratings".
 */
export async function fetchOmdbRatings(
  apiKey: string,
  imdbId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<OMDBRatings | null> {
  if (!/^tt\d+$/.test(imdbId)) return null;
  if (apiKey.trim().length === 0) return null;

  const url = new URL(OMDB_BASE);
  url.searchParams.set("i", imdbId);
  url.searchParams.set("apikey", apiKey);

  let res: Response;
  try {
    res = await fetchImpl(url.toString(), { signal: AbortSignal.timeout(8000) });
  } catch {
    return null;
  }
  if (!res.ok) return null;

  let data: RawOMDBResponse;
  try {
    data = (await res.json()) as RawOMDBResponse;
  } catch {
    return null;
  }
  if (String(data?.Response).toLowerCase() === "false") return null;

  const ratings = parseOmdbRatings(data);
  return isEmptyRatings(ratings) ? null : ratings;
}
