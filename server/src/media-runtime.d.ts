import type { AppDatabase } from "./db.js";
import type { ServerConfig } from "./types.js";

export type MediaType = "movie" | "series";
export type DebridServiceType =
  | "real_debrid"
  | "all_debrid"
  | "premiumize"
  | "torbox";

export interface StreamInfo {
  streamURL: string;
  quality: string;
  codec: string;
  audio: string;
  source: string;
  sizeBytes: number;
  fileName: string;
  debridService: string;
  restrictedId?: string;
}

export interface ServerStreamRow {
  result: Record<string, unknown> & {
    infoHash: string;
    title: string;
  };
  cachedOn: DebridServiceType | null;
}

export interface ServerStreamsResult {
  rows: ServerStreamRow[];
  hasIndexers: boolean;
  hasDebrid: boolean;
  activeIndexers: string[];
  activeDebridServices: DebridServiceType[];
  indexerErrors: Array<{ indexer: string; error: string }>;
}

export interface StreamFilters {
  cachedOnly: boolean;
  maxQuality: string;
  maxSizeGB: number;
}

/** Applies the master Data Saver clamp to resolved stream filters (mirrors the
 *  client effectiveDataSaver). No-op when dataSaverOn is false. */
export function withDataSaverClamp(filters: StreamFilters, dataSaverOn: boolean): StreamFilters;

/** True when a stream row passes the (already Data-Saver-clamped) filters. */
export function rowMatchesStreamFilters(
  row: { result?: { quality?: string; sizeBytes?: number } | null; cachedOn: unknown },
  filters: StreamFilters,
): boolean;

export interface TorrentResultLike {
  infoHash: string;
  title: string;
  seeders: number;
  quality: string;
  [key: string]: unknown;
}

/** Fold an imdb-native pass and a title/name pass into one ranked, deduped set
 *  (the title pass validated against `title` when given). Shared with the client
 *  so Local + Server Mode combine the two passes identically. `movieYear` (the
 *  requested MOVIE's release year - pass null for series) down-ranks, never
 *  drops, releases whose name carries an incompatible year. */
export function combineStreamResults(
  byImdb: TorrentResultLike[],
  byTitle: TorrentResultLike[],
  title: string | null,
  movieYear?: number | null,
): TorrentResultLike[];

export function searchServerStreams(
  db: AppDatabase,
  config: ServerConfig,
  profileId: string,
  input: {
    imdbId: string;
    type: MediaType;
    season?: number | null;
    episode?: number | null;
    /** Human title for the name-matching indexer pass (APIBay etc.). Omitted /
     *  null → imdb-only (also how the route forces capped/kid profiles). */
    title?: string | null;
    /** Release year of the requested item. Movies only: down-ranks (never
     *  drops) releases whose name carries an incompatible year. Ignored for
     *  series. */
    year?: number | null;
  },
): Promise<ServerStreamsResult>;

export function resolveServerStream(
  db: AppDatabase,
  config: ServerConfig,
  profileId: string,
  input: {
    infoHash: string;
    preferredService?: DebridServiceType | null;
    /** Episode context for season-pack file selection; null/omitted → the
     *  default (largest-file) pick. */
    fileHint?: { season: number; episode: number } | null;
  },
): Promise<StreamInfo>;

/** Whether `infoHash` is one of the indexer sources for the title `mediaId`.
 *  Used by the kid play-block to bind the cert-checked title to the resolved
 *  content. Fail-closed (false) when the title has no imdbId or no such source. */
export function titleHasInfoHash(
  db: AppDatabase,
  config: ServerConfig,
  profileId: string,
  mediaId: string,
  mediaType: MediaType,
  infoHash: string,
): Promise<boolean>;
