import type { AppDatabase } from "./db.js";
import type { ServerConfig } from "./types.js";

export type MediaType = "movie" | "series";
export type MediaCategory =
  | "popular"
  | "top_rated"
  | "now_playing"
  | "upcoming"
  | "airing_today"
  | "on_the_air";

/** Resolves the decrypted credential value for a provider, with profile-scoped
 *  credentials taking precedence over server-scoped. Returns null when unset or
 *  on a decrypt failure. */
export function effectiveCredentialValue(
  db: AppDatabase,
  config: ServerConfig,
  profileId: string,
  provider: string,
): string | null;

export function getServerDiscoverHome(
  db: AppDatabase,
  config: ServerConfig,
  profileId: string,
): Promise<unknown>;

export function searchServerMedia(
  db: AppDatabase,
  config: ServerConfig,
  profileId: string,
  input: {
    query: string;
    type?: MediaType | null;
    page?: number;
  },
): Promise<unknown>;

export function getServerCategory(
  db: AppDatabase,
  config: ServerConfig,
  profileId: string,
  input: {
    type: MediaType;
    category: "trending" | MediaCategory;
    page?: number;
  },
): Promise<unknown>;

export function discoverServerMedia(
  db: AppDatabase,
  config: ServerConfig,
  profileId: string,
  input: {
    type: MediaType;
    params: Record<string, string>;
  },
): Promise<unknown>;

export function getServerGenres(
  db: AppDatabase,
  config: ServerConfig,
  profileId: string,
  input: {
    type: MediaType;
  },
): Promise<unknown>;

export function getServerUpcomingEpisodes(
  db: AppDatabase,
  config: ServerConfig,
  profileId: string,
  input: {
    series: Array<Record<string, unknown> & {
      id: string;
      type: "series";
      title: string;
    }>;
  },
): Promise<unknown>;

export function getServerDetail(
  db: AppDatabase,
  config: ServerConfig,
  profileId: string,
  input: {
    id: string;
    type: MediaType;
  },
): Promise<unknown>;
