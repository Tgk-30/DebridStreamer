// Port of the value types in
//   Sources/DebridStreamer/Services/Sync/TraktSyncService.swift and
//   Sources/DebridStreamer/Services/Sync/IMDbCSVSyncService.swift
//   (plus UserLibraryEntry.ListType from Models/WatchHistory.swift).
//
// Domain-specific models for the sync layer live here. The shared
// ../../models/media.ts is imported read-only by the services; nothing in
// this subdir mutates it.

// MARK: - SyncState (mirrors Swift `SyncState`)

/** Lifecycle state of a sync run. Mirrors Swift `SyncState`. */
export type SyncState = "idle" | "running" | "success" | "failed";

export const SyncState = {
  idle: "idle" as SyncState,
  running: "running" as SyncState,
  success: "success" as SyncState,
  failed: "failed" as SyncState,
} as const;

// MARK: - ListType (mirrors UserLibraryEntry.ListType)

/** Library list kind. Mirrors Swift `UserLibraryEntry.ListType`. */
export type ListType = "watchlist" | "favorites" | "custom";

export const ListType = {
  watchlist: "watchlist" as ListType,
  favorites: "favorites" as ListType,
  custom: "custom" as ListType,

  /** Mirrors `ListType.supportsFolders`. */
  supportsFolders(type: ListType): boolean {
    return type !== "watchlist";
  },

  allCases(): ListType[] {
    return ["watchlist", "favorites", "custom"];
  },
} as const;

// MARK: - Trakt value types

/** Decoded device-code response. Mirrors Swift `TraktDeviceCodeResponse`. */
export interface TraktDeviceCodeResponse {
  deviceCode: string;
  userCode: string;
  verificationURL: string;
  expiresIn: number;
  interval: number;
}

/** Decoded OAuth token response. Mirrors Swift `TraktTokenResponse`. */
export interface TraktTokenResponse {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  tokenType: string;
  scope: string;
  createdAt: number;
}

/** A single watchlist movie. Mirrors Swift `TraktWatchlistItem`. */
export interface TraktWatchlistItem {
  imdbID: string;
  title: string;
  year: number | null;
}

/**
 * Typed summary of a `POST /sync/watchlist` response. Trakt returns counts of
 * items that were `added`, were already `existing`, and could `not_found` be
 * matched. Mirrors Swift `TraktWatchlistPushResult`.
 */
export interface TraktWatchlistPushResult {
  added?: TraktPushCounts | null;
  existing?: TraktPushCounts | null;
  notFound?: TraktPushNotFound | null;
}

interface TraktPushCounts {
  movies?: number | null;
}

interface TraktPushNotFoundIDs {
  imdb?: string | null;
}

interface TraktPushNotFoundMovie {
  ids?: TraktPushNotFoundIDs | null;
}

interface TraktPushNotFound {
  movies?: TraktPushNotFoundMovie[] | null;
}

// MARK: - IMDb CSV value types

/** A single parsed CSV row. Mirrors Swift `IMDbCSVEntry`. */
export interface IMDbCSVEntry {
  imdbID: string | null;
  title: string;
  year: number | null;
  listType: ListType;
}
