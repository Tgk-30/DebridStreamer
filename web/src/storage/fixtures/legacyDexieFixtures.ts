export interface LegacyDexieFixture {
  name: string;
  version: 1 | 5;
  schema: Record<string, string>;
  rows: Record<string, Array<Record<string, unknown>>>;
}

const V1_SCHEMA = {
  settings: "key",
  secrets: "key",
  watchlist: "mediaId, addedAt",
  watchHistory: "id, mediaId, lastWatched, completed",
  library: "id, mediaId, folderId, listType, addedAt",
  folders: "id, parentId, listType, isSystem",
  indexerConfigs: "id, priority, isActive",
  debridConfigs: "id, priority, isActive",
  tasteEvents: "id, userId, createdAt",
  mediaCache: "id, lastFetched",
} as const;

const V5_SCHEMA = {
  ...V1_SCHEMA,
  tasteEvents: "id, userId, createdAt, mediaId, eventType, [mediaId+createdAt]",
  cachedResolutions: "mediaId, resolvedAt",
  aiUsage: "id, createdAt",
  downloads: "jobId, status, updatedAt, createdAt, mediaId, episodeId",
} as const;

export const LEGACY_DEXIE_FIXTURES: readonly LegacyDexieFixture[] = [
  {
    name: "v1 first IndexedDB schema",
    version: 1,
    schema: V1_SCHEMA,
    rows: {
      settings: [{ key: "ui_theme", value: "aurora" }],
      secrets: [{ key: "tmdb_api_key", value: "fixture-secret" }],
      watchlist: [
        {
          mediaId: "tt-v1-watchlist",
          addedAt: "2024-01-01T00:00:00.000Z",
          preview: { id: "tt-v1-watchlist", type: "movie", title: "V1 Watchlist" },
        },
      ],
      watchHistory: [
        {
          id: "tt-v1-series:s1e1",
          mediaId: "tt-v1-series",
          episodeId: "s1e1",
          progressSeconds: 315,
          durationSeconds: 1800,
          completed: false,
          lastWatched: "2024-01-02T00:00:00.000Z",
          preview: { id: "tt-v1-series", type: "series", title: "V1 Series" },
        },
      ],
      library: [
        {
          id: "library-v1",
          mediaId: "tt-v1-library",
          folderId: "folder-v1",
          listType: "favorites",
          addedAt: "2024-01-03T00:00:00.000Z",
          customListName: null,
          releaseDateHint: null,
          renewalStatus: null,
          preview: { id: "tt-v1-library", type: "movie", title: "V1 Library" },
        },
      ],
      folders: [
        {
          id: "folder-v1",
          name: "V1 Folder",
          parentId: null,
          listType: "favorites",
          folderKind: "manual",
          isSystem: false,
          createdAt: "2024-01-03T00:00:00.000Z",
          updatedAt: "2024-01-03T00:00:00.000Z",
        },
      ],
      tasteEvents: [
        {
          id: "taste-v1",
          userId: "default",
          mediaId: "tt-v1-library",
          episodeId: null,
          eventType: "liked",
          signalStrength: 1,
          metadata: {},
          createdAt: "2024-01-04T00:00:00.000Z",
        },
      ],
    },
  },
  {
    name: "v5 schema before watchlist folders",
    version: 5,
    schema: V5_SCHEMA,
    rows: {
      settings: [{ key: "ui_theme", value: "midnight" }],
      secrets: [{ key: "debrid.debrid-real_debrid", value: "fixture-token" }],
      watchlist: [
        {
          mediaId: "tt-v5-watchlist",
          addedAt: "2025-01-01T00:00:00.000Z",
          preview: { id: "tt-v5-watchlist", type: "movie", title: "V5 Watchlist" },
        },
      ],
      tasteEvents: [
        {
          id: "taste-v5",
          userId: "default",
          mediaId: "tt-v5-watchlist",
          episodeId: null,
          eventType: "rated",
          signalStrength: 0.8,
          metadata: { rating: "8" },
          createdAt: "2025-01-02T00:00:00.000Z",
        },
      ],
      downloads: [
        {
          jobId: "download-v5",
          mediaId: "tt-v5-watchlist",
          episodeId: null,
          title: "V5 Download",
          status: "completed",
          bytesDone: 1024,
          bytesTotal: 1024,
          createdAt: "2025-01-02T00:00:00.000Z",
          updatedAt: "2025-01-02T00:05:00.000Z",
        },
      ],
    },
  },
];
