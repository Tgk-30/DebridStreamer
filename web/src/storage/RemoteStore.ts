import type { MediaItem, MediaPreview } from "../models/media";
import type {
  CachedResolutionRecord,
  DebridConfigRecord,
  IndexerConfigRecord,
  LibraryEntryRecord,
  LibraryFolderRecord,
  ListType,
  MediaCacheRecord,
  TasteEventRecord,
  WatchHistoryRecord,
  WatchlistRecord,
} from "./models";
import type {
  LibraryEntryUpsert,
  SecretStore,
  Store,
  WatchHistoryUpsert,
} from "./types";

import { notifyUnauthorized, readCsrfToken } from "../lib/serverSession";

type JsonObject = Record<string, unknown>;

const SECRET_MARKER = "secret:";
const SERVER_INDEXER_CONFIGS_KEY = "server_indexer_configs";

const SECRET_CREDENTIAL_PROVIDERS: Record<
  string,
  "tmdb" | "omdb" | "opensubtitles"
> = {
  tmdb_api_key: "tmdb",
  omdb_api_key: "omdb",
  opensubtitles_api_key: "opensubtitles",
};

function historyKey(mediaId: string, episodeId: string | null | undefined): string {
  return `${mediaId}:${episodeId ?? ""}`;
}

function nowISO(): string {
  return new Date().toISOString();
}

class ServerAPI {
  constructor(private readonly baseURL: string) {}

  async get<T>(path: string): Promise<T> {
    return this.request<T>("GET", path);
  }

  async put<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>("PUT", path, body);
  }

  async delete<T>(path: string): Promise<T> {
    return this.request<T>("DELETE", path);
  }

  private async request<T>(
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

    const response = await fetch(`${this.baseURL}${path}`, {
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
        // Non-JSON body (e.g. an HTML 5xx page from a reverse proxy). Fall back
        // to a status-based message below rather than throwing a parse error
        // that masks the real HTTP status.
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
}

interface ServerWatchlistResponse {
  items: Array<{
    mediaId: string;
    addedAt: string;
    preview: MediaPreview;
  }>;
}

interface ServerHistoryResponse {
  items: Array<{
    mediaId: string;
    episodeId: string | null;
    progressSeconds: number;
    durationSeconds: number | null;
    completed: boolean;
    lastWatched: string;
    streamQuality: string | null;
    preview: MediaPreview;
  }>;
}

function mapHistory(row: ServerHistoryResponse["items"][number]): WatchHistoryRecord {
  return {
    id: historyKey(row.mediaId, row.episodeId),
    mediaId: row.mediaId,
    episodeId: row.episodeId,
    progressSeconds: row.progressSeconds,
    durationSeconds: row.durationSeconds,
    completed: row.completed,
    lastWatched: row.lastWatched,
    streamQuality: row.streamQuality,
    preview: row.preview,
  };
}

function unsupportedRemoteWrite(name: string): Error {
  return new Error(`${name} is not available in Server Mode yet.`);
}

export class RemoteStore implements Store, SecretStore {
  private readonly api: ServerAPI;
  private settingsCache: Record<string, string> | null = null;
  private pendingSecrets = new Map<string, string>();

  constructor(baseURL: string) {
    this.api = new ServerAPI(baseURL);
  }

  async getSetting(key: string): Promise<string | null> {
    const settings = await this.allSettings();
    return settings[key] ?? null;
  }

  async setSetting(key: string, value: string | null): Promise<void> {
    await this.api.put("/api/settings/profile", { key, value });
    if (this.settingsCache != null) {
      if (value == null) delete this.settingsCache[key];
      else this.settingsCache[key] = value;
    }
  }

  async allSettings(): Promise<Record<string, string>> {
    if (this.settingsCache != null) return { ...this.settingsCache };
    const response = await this.api.get<{ settings: Record<string, string> }>(
      "/api/settings/profile",
    );
    this.settingsCache = response.settings;
    return { ...response.settings };
  }

  async getSecret(_key: string): Promise<string | null> {
    // Server Mode never reads credential values back into the browser.
    return null;
  }

  async setSecret(key: string, value: string): Promise<void> {
    const provider = SECRET_CREDENTIAL_PROVIDERS[key];
    if (provider != null) {
      if (value.trim().length === 0) {
        // Empty = NO CHANGE, never a delete. In Server Mode getSecret() always
        // returns null (write-only), so saveSettingsToStore re-sends every
        // provider key as "" on any unrelated save; treating that as a delete
        // would silently destroy a working server credential the user never
        // touched. Explicit removal goes through the Server tab's credentials UI
        // (DELETE /api/profile/credentials/:id). Mirrors why listDebridConfigs()
        // returns [] to keep debrid tokens out of destructive reconciliation.
        return;
      }
      await this.api.put("/api/profile/credentials", {
        id: `profile-${provider}`,
        provider,
        label: provider.toUpperCase(),
        value,
        priority: 0,
        isActive: true,
      });
      return;
    }
    // Write-only bridge for saveSettingsToStore(): it first writes the raw
    // secret here, then saves a config row with a secret:<key> marker. We never
    // read values back into the browser after they are sent to the server.
    this.pendingSecrets.set(key, value);
  }

  async deleteSecret(key: string): Promise<void> {
    // Provider credentials are deliberately NOT deleted through this settings
    // round-trip (see setSecret): the phantom empty value that arrives on every
    // unrelated save would otherwise destroy a server credential the user never
    // touched. Explicit removal is done via the Server tab's credentials UI
    // (DELETE /api/profile/credentials/:id). Non-provider keys only ever lived in
    // the in-memory pending map, so clearing that is sufficient.
    this.pendingSecrets.delete(key);
  }

  async addToWatchlist(preview: MediaPreview): Promise<void> {
    await this.api.put(`/api/library/watchlist/${encodeURIComponent(preview.id)}`, {
      preview,
    });
  }

  async removeFromWatchlist(mediaId: string): Promise<void> {
    await this.api.delete(`/api/library/watchlist/${encodeURIComponent(mediaId)}`);
  }

  async listWatchlist(): Promise<WatchlistRecord[]> {
    const response = await this.api.get<ServerWatchlistResponse>(
      "/api/library/watchlist",
    );
    return response.items.map((row) => ({
      mediaId: row.mediaId,
      addedAt: row.addedAt,
      preview: row.preview,
    }));
  }

  async isInWatchlist(mediaId: string): Promise<boolean> {
    const rows = await this.listWatchlist();
    return rows.some((row) => row.mediaId === mediaId);
  }

  async recordHistory(entry: WatchHistoryUpsert): Promise<WatchHistoryRecord> {
    const episodeId = entry.episodeId ?? null;
    const progressSeconds = entry.progressSeconds ?? 0;
    const durationSeconds = entry.durationSeconds ?? null;
    const completed = entry.completed ?? false;
    const streamQuality = entry.streamQuality ?? null;
    const lastWatched = entry.lastWatched ?? nowISO();
    await this.api.put(`/api/history/${encodeURIComponent(entry.mediaId)}`, {
      episodeId,
      progressSeconds,
      durationSeconds,
      completed,
      streamQuality,
      preview: entry.preview,
      lastWatched,
    });
    // The PUT is authoritative; build the record locally instead of re-fetching
    // up to 500 history rows to re-find the row we just wrote — that read-back
    // could page the new row out (when >500 newer rows exist) and spuriously
    // throw even though the write succeeded.
    return {
      id: historyKey(entry.mediaId, episodeId),
      mediaId: entry.mediaId,
      episodeId,
      progressSeconds,
      durationSeconds,
      completed,
      lastWatched,
      streamQuality,
      preview: entry.preview,
    };
  }

  async listHistory(limit = 100): Promise<WatchHistoryRecord[]> {
    const response = await this.api.get<ServerHistoryResponse>(
      `/api/history?limit=${encodeURIComponent(String(limit))}`,
    );
    return response.items.map(mapHistory);
  }

  async getResume(
    mediaId: string,
    episodeId?: string | null,
  ): Promise<WatchHistoryRecord | null> {
    const rows = await this.listHistory(500);
    return (
      rows.find(
        (row) => row.mediaId === mediaId && row.episodeId === (episodeId ?? null),
      ) ?? null
    );
  }

  async continueWatching(limit = 20): Promise<WatchHistoryRecord[]> {
    const rows = await this.listHistory(Math.max(limit, 100));
    return rows.filter((row) => !row.completed).slice(0, limit);
  }

  async addToLibrary(entry: LibraryEntryUpsert): Promise<LibraryEntryRecord> {
    throw unsupportedRemoteWrite(`addToLibrary(${entry.listType})`);
  }

  async removeFromLibrary(_id: string): Promise<void> {
    throw unsupportedRemoteWrite("removeFromLibrary");
  }

  async listLibrary(_listType?: ListType): Promise<LibraryEntryRecord[]> {
    return [];
  }

  async listLibraryByFolder(_folderId: string): Promise<LibraryEntryRecord[]> {
    return [];
  }

  async saveFolder(_folder: LibraryFolderRecord): Promise<void> {
    throw unsupportedRemoteWrite("saveFolder");
  }

  async createFolder(
    _name: string,
    _listType: ListType,
    _parentId: string | null,
  ): Promise<LibraryFolderRecord> {
    throw unsupportedRemoteWrite("createFolder");
  }

  async listFolders(_listType?: ListType): Promise<LibraryFolderRecord[]> {
    return [];
  }

  async deleteFolder(_id: string): Promise<void> {
    throw unsupportedRemoteWrite("deleteFolder");
  }

  async ensureSystemFolders(): Promise<void> {
    // Server owns folder initialization once the library endpoints are added.
  }

  private async remoteIndexerConfigs(): Promise<IndexerConfigRecord[]> {
    const settings = await this.allSettings();
    const raw = settings[SERVER_INDEXER_CONFIGS_KEY];
    if (raw == null || raw.trim().length === 0) return [];
    try {
      const parsed = JSON.parse(raw) as unknown;
      return Array.isArray(parsed) ? (parsed as IndexerConfigRecord[]) : [];
    } catch {
      return [];
    }
  }

  private async saveRemoteIndexerConfigs(configs: IndexerConfigRecord[]): Promise<void> {
    await this.setSetting(SERVER_INDEXER_CONFIGS_KEY, JSON.stringify(configs));
  }

  async saveIndexerConfig(config: IndexerConfigRecord): Promise<void> {
    const existing = await this.remoteIndexerConfigs();
    const next = [
      ...existing.filter((row) => row.id !== config.id),
      config,
    ].sort((a, b) => a.priority - b.priority);
    await this.saveRemoteIndexerConfigs(next);
  }

  async listIndexerConfigs(): Promise<IndexerConfigRecord[]> {
    return this.remoteIndexerConfigs();
  }

  async deleteIndexerConfig(id: string): Promise<void> {
    const existing = await this.remoteIndexerConfigs();
    await this.saveRemoteIndexerConfigs(existing.filter((row) => row.id !== id));
  }

  async saveDebridConfig(config: DebridConfigRecord): Promise<void> {
    const secretKey = config.apiToken.startsWith(SECRET_MARKER)
      ? config.apiToken.slice(SECRET_MARKER.length)
      : null;
    const token =
      secretKey != null ? this.pendingSecrets.get(secretKey) : config.apiToken;
    if (token == null || token.trim().length === 0) return;
    await this.api.put("/api/profile/credentials", {
      id: config.id,
      provider: config.service,
      label: config.service,
      value: token,
      priority: config.priority,
      isActive: config.isActive,
    });
    if (secretKey != null) this.pendingSecrets.delete(secretKey);
  }

  async listDebridConfigs(): Promise<DebridConfigRecord[]> {
    // Do not synthesize rows for write-only server credentials. If we returned
    // redacted rows here, a later save from an unrelated Settings tab would
    // interpret the missing raw tokens as deletes.
    return [];
  }

  async deleteDebridConfig(_id: string): Promise<void> {
    throw unsupportedRemoteWrite("deleteDebridConfig");
  }

  async addTasteEvent(_event: TasteEventRecord): Promise<void> {
    // Taste profile endpoints come after the core remote store wiring.
  }

  async recentTasteEvents(_limit = 100): Promise<TasteEventRecord[]> {
    return [];
  }

  async putMedia(_item: MediaItem): Promise<void> {
    // Server-side media cache endpoints come after stream/search APIs.
  }

  async getMedia(_id: string): Promise<MediaCacheRecord | null> {
    return null;
  }

  async putCachedResolution(_record: CachedResolutionRecord): Promise<void> {
    // Server Mode uses stream sessions rather than local direct-link caching.
  }

  async getCachedResolution(_mediaId: string): Promise<CachedResolutionRecord | null> {
    return null;
  }

  async listCachedResolutions(): Promise<CachedResolutionRecord[]> {
    return [];
  }

  async deleteCachedResolution(_mediaId: string): Promise<void> {
    // No local cache to delete in Server Mode.
  }
}
