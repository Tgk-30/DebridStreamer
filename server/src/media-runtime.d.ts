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

export function searchServerStreams(
  db: AppDatabase,
  config: ServerConfig,
  profileId: string,
  input: {
    imdbId: string;
    type: MediaType;
    season?: number | null;
    episode?: number | null;
  },
): Promise<ServerStreamsResult>;

export function resolveServerStream(
  db: AppDatabase,
  config: ServerConfig,
  profileId: string,
  input: {
    infoHash: string;
    preferredService?: DebridServiceType | null;
  },
): Promise<StreamInfo>;
