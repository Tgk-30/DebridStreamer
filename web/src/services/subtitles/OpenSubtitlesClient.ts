// OpenSubtitles REST client (rest.opensubtitles.com, the v1 API).
//
// Needs a user-supplied API key (sent as `Api-Key`) and a descriptive
// User-Agent (OpenSubtitles asks every consumer to identify itself). Two
// methods the player needs:
//   • search(query)   -> a normalized list of subtitle results
//   • download(fileId) -> the raw subtitle text (SRT/VTT/etc.)
//
// All requests route through an injectable `FetchImpl` (the app threads
// `appFetch`, which is CORS-free under Tauri and degrades to the global fetch in
// a browser). The class is pure-ish: it does no DOM work and its only side
// effect is the network call, so tests inject a stub fetch.

import type { FetchImpl } from "../../lib/http";

const API_BASE = "https://api.opensubtitles.com/api/v1";
/** OpenSubtitles requires a unique, descriptive UA per consumer app. */
const OPEN_SUBTITLES_USER_AGENT = "DebridStreamer v2";

/** A normalized subtitle search result (one row per file). */
export interface SubtitleSearchResult {
  /** The file id passed to `download`. */
  fileId: string;
  /** ISO-639 language code, e.g. "en", "es", "pt-br". */
  language: string;
  /** Human file/release name for the picker. */
  release: string;
  /** Download count (popularity) - used to sort. */
  downloadCount: number;
  /** Whether the uploader flagged it as hearing-impaired. */
  hearingImpaired: boolean;
  /** Whether OpenSubtitles AI-translated it (lower quality). */
  machineTranslated: boolean;
  /** Uploader-reported FPS, when present. */
  fps: number | null;
}

/** Parameters for a subtitle search. At least one of `imdbId` / `query` should
 * be supplied; `season`/`episode` narrow a TV result. */
export interface SubtitleSearchParams {
  /** IMDb id, with or without the `tt` prefix (the API wants the digits). */
  imdbId?: string | null;
  /** Free-text title query (used when no imdb id is known). */
  query?: string | null;
  season?: number | null;
  episode?: number | null;
  /** ISO-639 language codes to request; defaults to `["en"]`. */
  languages?: string[];
}

/** The subtitle-source surface the player depends on. Implemented by the local
 *  `OpenSubtitlesClient` and the Server-Mode `ServerSubtitlesClient`, so the
 *  player (useSubtitleTracks) is agnostic to where the key/network live. */
export interface SubtitleClient {
  /** Whether searches can run (a key is configured, here or server-side). */
  readonly hasKey: boolean;
  search(params: SubtitleSearchParams): Promise<SubtitleSearchResult[]>;
  /** Resolve a file id to raw subtitle text (SRT/VTT - parseSubtitles handles both).
   *  `imdbId` (the title being watched) lets a Server-Mode client enforce the
   *  maturity cap on the fetched dialogue; the local client ignores it. */
  download(fileId: string, imdbId?: string | null): Promise<string>;
}

export class OpenSubtitlesError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "OpenSubtitlesError";
    this.status = status;
  }
}

/** Strip the `tt` prefix from an IMDb id and return the bare digits, or null. */
export function imdbDigits(imdbId: string | null | undefined): string | null {
  if (!imdbId) return null;
  const digits = imdbId.replace(/^tt/i, "").replace(/\D/g, "");
  return digits.length > 0 ? digits : null;
}

/** Build the `/subtitles` query string from search params. Pure + exported so
 * the request shape is unit-testable without hitting the network. */
export function buildSearchQuery(params: SubtitleSearchParams): string {
  const q = new URLSearchParams();
  const imdb = imdbDigits(params.imdbId);
  if (imdb != null) q.set("imdb_id", imdb);
  if (params.query && params.query.trim().length > 0) {
    q.set("query", params.query.trim());
  }
  if (params.season != null && params.season > 0) {
    q.set("season_number", String(params.season));
  }
  if (params.episode != null && params.episode > 0) {
    q.set("episode_number", String(params.episode));
  }
  const langs = (params.languages ?? ["en"])
    .map((l) => l.trim().toLowerCase())
    .filter((l) => l.length > 0);
  if (langs.length > 0) q.set("languages", langs.join(","));
  // Stable ordering: most-downloaded first.
  q.set("order_by", "download_count");
  q.set("order_direction", "desc");
  // URLSearchParams sorts deterministically for tests.
  q.sort();
  return q.toString();
}

/** Normalize a raw `/subtitles` payload into `SubtitleSearchResult[]`. Pure +
 * exported for tests. Tolerant of missing fields (the API is loosely typed). */
export function parseSearchResponse(json: unknown): SubtitleSearchResult[] {
  const data = (json as { data?: unknown })?.data;
  if (!Array.isArray(data)) return [];
  const out: SubtitleSearchResult[] = [];
  for (const row of data) {
    const attrs = (row as { attributes?: Record<string, unknown> })?.attributes;
    if (attrs == null) continue;
    const files = attrs.files as { file_id?: number | string }[] | undefined;
    const fileId = files?.[0]?.file_id;
    if (fileId == null) continue;
    out.push({
      fileId: String(fileId),
      language: String(attrs.language ?? "").toLowerCase(),
      release: String(attrs.release ?? attrs.feature_details ?? "Subtitle"),
      downloadCount: Number(attrs.download_count ?? 0),
      hearingImpaired: Boolean(attrs.hearing_impaired),
      machineTranslated: Boolean(attrs.machine_translated),
      fps: attrs.fps != null ? Number(attrs.fps) : null,
    });
  }
  return out;
}

export class OpenSubtitlesClient implements SubtitleClient {
  private readonly apiKey: string;
  private readonly fetchImpl: FetchImpl;
  private readonly userAgent: string;

  constructor(
    apiKey: string,
    fetchImpl: FetchImpl,
    userAgent: string = OPEN_SUBTITLES_USER_AGENT,
  ) {
    this.apiKey = apiKey.trim();
    this.fetchImpl = fetchImpl;
    this.userAgent = userAgent;
  }

  /** Whether a usable key is configured. */
  get hasKey(): boolean {
    return this.apiKey.length > 0;
  }

  private headers(extra?: Record<string, string>): Record<string, string> {
    return {
      "Api-Key": this.apiKey,
      "User-Agent": this.userAgent,
      Accept: "application/json",
      ...extra,
    };
  }

  /** Search for subtitles. Throws `OpenSubtitlesError` on a non-2xx response or
   * when no key is configured. */
  async search(
    params: SubtitleSearchParams,
  ): Promise<SubtitleSearchResult[]> {
    if (!this.hasKey) {
      throw new OpenSubtitlesError(0, "Missing OpenSubtitles API key.");
    }
    const url = `${API_BASE}/subtitles?${buildSearchQuery(params)}`;
    const res = await this.fetchImpl(url, { headers: this.headers() });
    if (!(res.status >= 200 && res.status <= 299)) {
      throw new OpenSubtitlesError(
        res.status,
        (await res.text().catch(() => "")) || "OpenSubtitles search failed",
      );
    }
    const json = JSON.parse(await res.text());
    return parseSearchResponse(json);
  }

  /** Resolve a file id to a temporary download link via `POST /download`, then
   * fetch and return the raw subtitle text. Two requests: the API gates the
   * direct file behind a per-key download quota. Throws on failure. */
  // imdbId is unused locally (no server-side maturity cap on a direct key).
  async download(fileId: string, _imdbId?: string | null): Promise<string> {
    if (!this.hasKey) {
      throw new OpenSubtitlesError(0, "Missing OpenSubtitles API key.");
    }
    const res = await this.fetchImpl(`${API_BASE}/download`, {
      method: "POST",
      headers: this.headers({ "Content-Type": "application/json" }),
      body: JSON.stringify({ file_id: Number(fileId) }),
    });
    if (!(res.status >= 200 && res.status <= 299)) {
      throw new OpenSubtitlesError(
        res.status,
        (await res.text().catch(() => "")) || "OpenSubtitles download failed",
      );
    }
    const link = (JSON.parse(await res.text()) as { link?: string }).link;
    if (link == null || link.length === 0) {
      throw new OpenSubtitlesError(502, "OpenSubtitles returned no download link.");
    }
    const fileRes = await this.fetchImpl(link, {
      headers: { "User-Agent": this.userAgent },
    });
    if (!(fileRes.status >= 200 && fileRes.status <= 299)) {
      throw new OpenSubtitlesError(
        fileRes.status,
        "Failed to fetch the subtitle file.",
      );
    }
    return fileRes.text();
  }
}
