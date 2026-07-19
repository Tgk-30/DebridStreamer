import type { MediaType } from "../models/media";
import type { CastMember, Episode, MediaItem, MediaPreview, Season } from "../models/media";
import type { AIMovieRecommendation, AIUsageMetrics } from "../services/ai/models";
import type { DebridServiceType, StreamInfo } from "../services/debrid/models";
import type {
  SubtitleSearchParams,
  SubtitleSearchResult,
} from "../services/subtitles/OpenSubtitlesClient";
import type { SubtitleCue } from "../services/subtitles/cues";
import type { Genre, MediaCategory } from "../services/metadata/types";
import type { OMDBRatings } from "../services/metadata/OMDBService";
import type { StreamRow } from "../data/streams";
import type { UpcomingEpisode } from "./metadata";
import type { MovieRelease } from "../services/metadata/TMDBService";
import { configuredServerURL } from "./serverMode";
import { notifyUnauthorized, readCsrfToken } from "./serverSession";

type JsonObject = Record<string, unknown>;

function serverBaseURL(): string {
  const baseURL = configuredServerURL();
  if (baseURL == null) throw new Error("Server Mode is not configured.");
  return baseURL;
}

async function serverRequest<T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const headers: Record<string, string> = {};
  const unsafe = method !== "GET" && method !== "HEAD";
  if (body !== undefined) headers["content-type"] = "application/json";
  if (unsafe) {
    const csrf = readCsrfToken();
    if (csrf != null) headers["x-csrf-token"] = csrf;
  }

  const response = await fetch(`${serverBaseURL()}${path}`, {
    method,
    credentials: "include",
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const text = await response.text();
  let parsed: JsonObject = {};
  if (text.length > 0) {
    try {
      parsed = JSON.parse(text) as JsonObject;
    } catch {
      // Non-JSON body (e.g. an HTML 5xx page from a reverse proxy) - fall back to
      // a status-based message rather than throwing a misleading parse error.
      parsed = {};
    }
  }
  if (!response.ok) {
    if (response.status === 401) notifyUnauthorized();
    const message =
      typeof parsed.error === "string"
        ? parsed.error
        : `Server request failed (${response.status}).`;
    const error = new Error(message) as Error & { status: number };
    error.status = response.status;
    throw error;
  }
  return parsed as T;
}

function absoluteServerURL(pathOrUrl: string): string {
  try {
    return new URL(pathOrUrl).toString();
  } catch {
    return `${serverBaseURL()}${pathOrUrl.startsWith("/") ? "" : "/"}${pathOrUrl}`;
  }
}

export async function fetchServerStreams(input: {
  imdbId: string;
  type: MediaType;
  season?: number | null;
  episode?: number | null;
  /** Human title for the server's name-matching indexer pass (APIBay etc.),
   *  which an imdb id alone can't reach. Optional - older servers ignore the
   *  extra query param and fall back to the imdb-only search. */
  title?: string | null;
  /** The item's release year - lets the server down-rank same-titled releases
   *  from a different year (movies only). Optional - older servers ignore the
   *  extra query param and keep the unranked-by-year order. */
  year?: number | null;
}): Promise<{
  rows: StreamRow[];
  hasIndexers: boolean;
  hasDebrid: boolean;
}> {
  const params = new URLSearchParams({ type: input.type });
  if (input.season != null) params.set("season", String(input.season));
  if (input.episode != null) params.set("episode", String(input.episode));
  if (input.title != null && input.title.trim().length > 0) {
    params.set("title", input.title.trim());
  }
  if (input.year != null) params.set("year", String(input.year));
  const response = await serverRequest<{
    rows: StreamRow[];
    hasIndexers: boolean;
    hasDebrid: boolean;
  }>(
    "GET",
    `/api/streams/${encodeURIComponent(input.imdbId)}?${params.toString()}`,
  );
  return {
    rows: response.rows,
    hasIndexers: response.hasIndexers,
    hasDebrid: response.hasDebrid,
  };
}

/** Validates a candidate debrid token against the provider SERVER-side.
 * Debrid hosts (TorBox in particular) send no CORS headers, so the client-side
 * check is meaningless in a webview/browser: in server mode the server is the
 * only party that can reach the provider API. */
export async function testServerDebridToken(input: {
  service: DebridServiceType;
  apiToken: string;
}): Promise<boolean> {
  const response = await serverRequest<{ valid: boolean }>(
    "POST",
    "/api/debrid/test",
    { service: input.service, apiToken: input.apiToken },
  );
  return response.valid === true;
}

export async function resolveServerStream(
  row: StreamRow,
  opts: {
    transcode?: boolean;
    media?: { id: string; type: MediaType };
    /** Episode context (series) - steers season-pack file selection on the
     *  server. Omitted for movies / older servers (unknown fields ignored). */
    fileHint?: { season: number; episode: number } | null;
  } = {},
): Promise<StreamInfo> {
  const response = await serverRequest<{ stream: StreamInfo }>(
    "POST",
    "/api/streams/resolve",
    {
      infoHash: row.result.infoHash,
      preferredService: row.cachedOn,
      // The server needs the title context to enforce maturity gating on capped
      // (kid) profiles; it's ignored for normal profiles, so always send it.
      ...(opts.media != null
        ? { mediaId: opts.media.id, mediaType: opts.media.type }
        : {}),
      ...(opts.fileHint != null
        ? { season: opts.fileHint.season, episode: opts.fileHint.episode }
        : {}),
    },
  );
  // When transcoding is requested, point the player at the session's HLS manifest
  // variant of the same playback URL. VideoPlayer sniffs the ".m3u8" suffix and
  // plays it via hls.js - so no player change is needed.
  const path = opts.transcode
    ? `${response.stream.streamURL}/index.m3u8`
    : response.stream.streamURL;
  return {
    ...response.stream,
    streamURL: absoluteServerURL(path),
  };
}

export async function searchServerMedia(input: {
  query: string;
  type: MediaType | null;
  page?: number;
}): Promise<{
  items: MediaPreview[];
  page: number;
  totalPages: number;
  totalResults: number;
}> {
  const params = new URLSearchParams({
    q: input.query,
    type: input.type ?? "all",
    page: String(input.page ?? 1),
  });
  return serverRequest("GET", `/api/search?${params.toString()}`);
}

export async function fetchServerDiscoverHome(): Promise<{
  hero: MediaPreview | null;
  trendingMovies: MediaPreview[];
  trendingTV: MediaPreview[];
  popularMovies: MediaPreview[];
  topRatedMovies: MediaPreview[];
  nowPlayingMovies: MediaPreview[];
  upcomingMovies: MediaPreview[];
}> {
  return serverRequest("GET", "/api/discover/home");
}

export async function fetchServerCategory(input: {
  type: MediaType;
  category: "trending" | MediaCategory;
  page?: number;
}): Promise<{
  items: MediaPreview[];
  page: number;
  totalPages: number;
  totalResults: number;
}> {
  const params = new URLSearchParams({
    type: input.type,
    category: input.category,
    page: String(input.page ?? 1),
  });
  return serverRequest("GET", `/api/catalog/category?${params.toString()}`);
}

export async function discoverServerMedia(input: {
  type: MediaType;
  params: Record<string, string>;
}): Promise<{
  items: MediaPreview[];
  page: number;
  totalPages: number;
  totalResults: number;
}> {
  const params = new URLSearchParams({
    type: input.type,
    ...input.params,
  });
  return serverRequest("GET", `/api/catalog/discover?${params.toString()}`);
}

export async function fetchServerGenres(type: MediaType): Promise<Genre[]> {
  const params = new URLSearchParams({ type });
  const response = await serverRequest<{ genres: Genre[] }>(
    "GET",
    `/api/genres?${params.toString()}`,
  );
  return response.genres;
}

export async function fetchServerUpcomingEpisodes(
  series: MediaPreview[],
): Promise<UpcomingEpisode[]> {
  const response = await serverRequest<{ episodes: UpcomingEpisode[] }>(
    "POST",
    "/api/calendar/upcoming",
    { series },
  );
  return response.episodes;
}

/** Movie release dates resolved by the Server Mode TMDB broker. */
export async function fetchServerMovieReleases(): Promise<MovieRelease[]> {
  const response = await serverRequest<{ releases: MovieRelease[] }>(
    "GET",
    "/api/calendar/movies",
  );
  return response.releases;
}

export async function recommendServerAI(input: {
  prompt: string;
  count?: number;
}): Promise<{
  recommendations: AIMovieRecommendation[];
  model: string | null;
  usage: AIUsageMetrics | null;
}> {
  return serverRequest("POST", "/api/ai/recommend", {
    prompt: input.prompt,
    count: input.count ?? 8,
  });
}

export async function curateServerAI(input: {
  prompt: string;
  count?: number;
}): Promise<{ items: MediaPreview[]; unmatched: number }> {
  return serverRequest("POST", "/api/ai/curate", {
    prompt: input.prompt,
    count: input.count ?? 8,
  });
}

export async function searchServerSubtitles(
  params: SubtitleSearchParams,
): Promise<{ results: SubtitleSearchResult[] }> {
  return serverRequest("POST", "/api/subtitles/search", params);
}

export async function fetchServerSubtitle(
  fileId: string,
  imdbId?: string | null,
): Promise<{ vtt: string }> {
  return serverRequest("POST", "/api/subtitles/fetch", { fileId, imdbId });
}

export async function translateServerSubtitles(input: {
  cues: SubtitleCue[];
  targetLanguage: string;
}): Promise<{ cues: SubtitleCue[]; providerKind: string }> {
  return serverRequest("POST", "/api/subtitles/translate", input);
}

export async function revokeServerStreamSession(id: string): Promise<void> {
  await serverRequest(
    "POST",
    `/api/admin/streams/${encodeURIComponent(id)}/revoke`,
  );
}

// ---- Household sub-profiles ("who's watching") ----------------------------
// These talk to the account-scoped /api/account/profiles + /api/profiles/switch
// routes. A sub-profile is a viewer WITHIN the current account (no username; the
// password is optional), distinct from the admin account-management surface in
// Settings that uses /api/profiles. serverRequest already attaches credentials +
// the CSRF header on the unsafe methods.

export interface AccountProfile {
  id: string;
  displayName: string;
  avatarColor: string | null;
  simpleMode: boolean;
  isDefault: boolean;
  /** Kid mode locks the profile into the curated, search-disabled experience and
   *  pairs with a `maturityMax` cap. The server strictly couples the two. */
  isKid: boolean;
  /** US movie cert cap ("G"|"PG"|"PG-13"|"R"|"NC-17"), or null when not a kid. */
  maturityMax: string | null;
  /** A server-side household PIN is set. The PIN hash never leaves the server. */
  hasPin?: boolean;
  /** Warn-only rolling 30-day household bandwidth data. */
  bandwidthCapBytes?: number | null;
  bandwidthUsageBytes?: number;
  bandwidthStatus?: "ok" | "approaching" | "over";
}

export interface AccountProfileState {
  profiles: AccountProfile[];
  activeProfileId: string;
}

export async function fetchAccountProfiles(): Promise<AccountProfileState> {
  return serverRequest("GET", "/api/account/profiles");
}

export async function createAccountProfile(input: {
  displayName: string;
  avatarColor?: string | null;
  password?: string | null;
  simpleMode?: boolean;
}): Promise<{ profile: AccountProfile }> {
  return serverRequest("POST", "/api/account/profiles", {
    displayName: input.displayName,
    avatarColor: input.avatarColor ?? null,
    // Only send a password when one was actually entered - the server treats it
    // as optional for household viewer profiles.
    ...(input.password != null && input.password.length > 0
      ? { password: input.password }
      : {}),
    simpleMode: input.simpleMode ?? true,
  });
}

export async function updateAccountProfile(
  id: string,
  patch: { displayName?: string; avatarColor?: string | null; simpleMode?: boolean },
): Promise<{ ok: true; profiles: AccountProfile[] }> {
  return serverRequest("PATCH", `/api/account/profiles/${encodeURIComponent(id)}`, patch);
}

export async function deleteAccountProfile(
  id: string,
): Promise<{ ok: true; profiles: AccountProfile[] }> {
  return serverRequest("DELETE", `/api/account/profiles/${encodeURIComponent(id)}`);
}

/** Owner/admin only. Sets kid mode + maturity cap together - the server rejects a
 *  half-state (kid without a cap, or a cap without kid mode) with a 400. */
export async function setProfileMaturity(
  id: string,
  body: { isKid: boolean; maturityMax: string | null },
): Promise<{ ok: true; profiles: AccountProfile[] }> {
  return serverRequest(
    "POST",
    `/api/account/profiles/${encodeURIComponent(id)}/maturity`,
    body,
  );
}

export async function switchAccountProfile(
  profileId: string,
  password?: string,
): Promise<{
  session: {
    profileId: string;
    displayName: string;
    avatarColor: string | null;
    role: "owner" | "admin" | "member" | "restricted";
    username: string;
    simpleMode: boolean;
  } | null;
  profiles: AccountProfileState | null;
}> {
  // The same server contract carries the account password when leaving a kid
  // profile and the target profile PIN when entering a PIN-protected profile.
  return serverRequest("POST", "/api/profiles/switch", {
    profileId,
    ...(password != null && password.length > 0 ? { password } : {}),
  });
}

/** Set or clear a viewer profile's 4-6 digit household PIN. The response is the
 * refreshed picker state so the lock glyph updates without a separate fetch. */
export async function setProfilePin(
  profileId: string,
  pin: string | null,
): Promise<{ profiles: AccountProfileState }> {
  return serverRequest("POST", "/api/profiles/pin", { profileId, pin });
}

/** Owner/admin only. A rolling monthly household warning cap, never playback
 * enforcement. `null` clears the cap and returns refreshed picker state. */
export async function setProfileBandwidthQuota(
  profileId: string,
  capBytes: number | null,
): Promise<{ profiles: AccountProfileState }> {
  return serverRequest("POST", "/api/profiles/quota", { profileId, capBytes });
}

// ---- Title requests (Phase 4) ---------------------------------------------
// A "request" is a member asking an admin to add a title to the household. The
// shared `/api/library/requested` list surfaces APPROVED titles to everyone;
// the admin queue lives behind /api/admin/requests. serverRequest already
// attaches credentials + the CSRF header on the unsafe methods.

export interface RequestRecord {
  id: string;
  mediaId: string;
  preview: MediaPreview;
  status: "pending" | "approved" | "denied";
  decisionReason: string | null;
  requestedAt: string;
  decidedAt: string | null;
  requestedByDisplayName: string | null;
  decidedByDisplayName: string | null;
}

/** File a title request. Throws with status 409 when the title already has a
 *  live pending request (the caller surfaces "Already requested"). */
export async function createRequest(
  mediaId: string,
  preview: MediaPreview,
): Promise<{ request: RequestRecord }> {
  return serverRequest("POST", "/api/library/requests", { mediaId, preview });
}

/** The caller's OWN requests, optionally filtered by status. */
export async function listOwnRequests(
  status?: RequestRecord["status"],
): Promise<{ requests: RequestRecord[] }> {
  const query = status != null ? `?status=${encodeURIComponent(status)}` : "";
  return serverRequest("GET", `/api/library/requests${query}`);
}

/** The SHARED, account-wide list of APPROVED titles. */
export async function listRequested(): Promise<{ items: RequestRecord[] }> {
  return serverRequest("GET", "/api/library/requested");
}

/** The admin moderation queue (defaults to pending). Admin only on the server. */
export async function adminListRequests(
  status?: RequestRecord["status"],
): Promise<{ requests: RequestRecord[] }> {
  const query = status != null ? `?status=${encodeURIComponent(status)}` : "";
  return serverRequest("GET", `/api/admin/requests${query}`);
}

/** Approve a pending request. Admin + CSRF on the server. */
export async function adminApproveRequest(id: string): Promise<{ ok: true }> {
  return serverRequest(
    "POST",
    `/api/admin/requests/${encodeURIComponent(id)}/approve`,
  );
}

/** Deny a pending request, optionally with a reason. Admin + CSRF on the server. */
export async function adminDenyRequest(
  id: string,
  reason?: string,
): Promise<{ ok: true }> {
  return serverRequest(
    "POST",
    `/api/admin/requests/${encodeURIComponent(id)}/deny`,
    reason != null && reason.trim().length > 0 ? { reason } : undefined,
  );
}

export async function fetchServerDetail(input: {
  id: string;
  type: MediaType;
}): Promise<{
  item: MediaItem;
  cast: CastMember[];
  related: MediaPreview[];
  imdbId: string | null;
}> {
  const params = new URLSearchParams({
    id: input.id,
    type: input.type,
  });
  return serverRequest("GET", `/api/media/detail?${params.toString()}`);
}

/** Fetch a series' seasons via the server metadata proxy (the TMDB key lives
 *  on the server). Callers treat any failure as "no episode guide". */
export async function fetchServerSeasons(input: {
  tmdbId: number;
}): Promise<{ seasons: Season[] }> {
  const params = new URLSearchParams({ tmdbId: String(input.tmdbId) });
  return serverRequest("GET", `/api/media/seasons?${params.toString()}`);
}

/** Fetch one season's episode list via the server metadata proxy. */
export async function fetchServerEpisodes(input: {
  tmdbId: number;
  season: number;
}): Promise<{ episodes: Episode[] }> {
  const params = new URLSearchParams({
    tmdbId: String(input.tmdbId),
    season: String(input.season),
  });
  return serverRequest("GET", `/api/media/episodes?${params.toString()}`);
}

/** Fetch OMDb ratings for an IMDb id via the server "hidden key" proxy. The
 *  server holds the key (profile / server / env) and returns only the parsed
 *  ratings - the key never reaches the client. Returns null when the server has
 *  no OMDb key for this profile. */
export async function fetchServerOmdb(imdbId: string): Promise<OMDBRatings | null> {
  const res = await serverRequest<{ ratings: OMDBRatings | null }>(
    "GET",
    `/api/omdb/${encodeURIComponent(imdbId)}`,
  );
  return res.ratings;
}

// ── Server first-run setup helpers ───────────────────────────────────────────
// Thin wrappers over the EXISTING admin endpoints the Settings → Server tab
// already drives. They exist so the guided Server setup wizard can reuse the
// same save/invite/health paths without re-implementing the fetch/CSRF plumbing
// (serverRequest above already handles credentials + x-csrf-token).

/** Provider key the setup wizard / Settings store credentials under. Mirrors
 *  CredentialProvider in Settings.tsx. */
export type ServerCredentialProvider =
  | "tmdb"
  | "omdb"
  | "real_debrid"
  | "all_debrid"
  | "premiumize"
  | "torbox"
  | "openai"
  | "anthropic"
  | "ollama"
  | "opensubtitles"
  | "trakt";

/** Save (or overwrite) a SHARED server credential - same PUT the Server tab's
 *  "Save shared credential" button uses. Owner/admin only on the server. */
export async function saveServerSharedCredential(input: {
  provider: ServerCredentialProvider;
  label: string;
  value: string;
}): Promise<void> {
  await serverRequest("PUT", "/api/admin/credentials", {
    provider: input.provider,
    label: input.label.trim().length > 0 ? input.label : "Shared",
    value: input.value,
  });
}

interface ServerInviteResult {
  token: string;
  invite: { id: string };
}

/** Create a household invite - same POST the Server tab's invite form uses. The
 *  caller builds the shareable URL from the returned token. */
export async function createServerInvite(input: {
  label?: string;
  role: "member" | "admin" | "restricted";
  simpleMode: boolean;
  maxUses: number;
  expiresInSeconds: number;
}): Promise<ServerInviteResult> {
  return serverRequest<ServerInviteResult>("POST", "/api/admin/invites", {
    label: input.label?.trim() || undefined,
    role: input.role,
    simpleMode: input.simpleMode,
    maxUses: input.maxUses,
    expiresInSeconds: input.expiresInSeconds,
  });
}

/** Read the owner-only health summary so the setup gate can count existing
 *  credentials (and the wizard can show how many keys are configured). */
export async function fetchServerAdminHealth(): Promise<{
  counts: { credentials: number; profiles: number; activeInvites: number };
}> {
  return serverRequest("GET", "/api/admin/health");
}
