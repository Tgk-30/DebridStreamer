import type { MediaType } from "../models/media";
import type { CastMember, MediaItem, MediaPreview } from "../models/media";
import type { AIMovieRecommendation, AIUsageMetrics } from "../services/ai/models";
import type { StreamInfo } from "../services/debrid/models";
import type {
  SubtitleSearchParams,
  SubtitleSearchResult,
} from "../services/subtitles/OpenSubtitlesClient";
import type { SubtitleCue } from "../services/subtitles/cues";
import type { Genre, MediaCategory } from "../services/metadata/types";
import type { StreamRow } from "../data/streams";
import type { UpcomingEpisode } from "./metadata";
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
      // Non-JSON body (e.g. an HTML 5xx page from a reverse proxy) — fall back to
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
}): Promise<{
  rows: StreamRow[];
  hasIndexers: boolean;
  hasDebrid: boolean;
}> {
  const params = new URLSearchParams({ type: input.type });
  if (input.season != null) params.set("season", String(input.season));
  if (input.episode != null) params.set("episode", String(input.episode));
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

export async function resolveServerStream(row: StreamRow): Promise<StreamInfo> {
  const response = await serverRequest<{ stream: StreamInfo }>(
    "POST",
    "/api/streams/resolve",
    {
      infoHash: row.result.infoHash,
      preferredService: row.cachedOn,
    },
  );
  return {
    ...response.stream,
    streamURL: absoluteServerURL(response.stream.streamURL),
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

export async function fetchServerSubtitle(fileId: string): Promise<{ vtt: string }> {
  return serverRequest("POST", "/api/subtitles/fetch", { fileId });
}

export async function translateServerSubtitles(input: {
  cues: SubtitleCue[];
  targetLanguage: string;
}): Promise<{ cues: SubtitleCue[]; providerKind: string }> {
  return serverRequest("POST", "/api/subtitles/translate", input);
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

/** Save (or overwrite) a SHARED server credential — same PUT the Server tab's
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

export interface ServerInviteResult {
  token: string;
  invite: { id: string };
}

/** Create a household invite — same POST the Server tab's invite form uses. The
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
