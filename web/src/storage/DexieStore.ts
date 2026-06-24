// DexieStore — the IndexedDB-backed implementation of `Store` + `SecretStore`.
//
// IndexedDB works in BOTH a plain browser AND the Tauri webview, so a single
// implementation covers web and desktop with no Rust/SQLite plugin. Dexie gives
// us a typed, promise-based wrapper with a versioned schema (object stores +
// indexes). Everything is async; upsert/dedup semantics match the Swift
// DatabaseManager (one watch-history row per (mediaId, episodeId), newest wins;
// the watchlist has no duplicates; library entries are unique per
// (mediaId, folderId)).
//
// Tests run this against `fake-indexeddb` (see DexieStore.test.ts), which
// provides a spec-compliant in-memory IndexedDB.

import Dexie, { type Table } from "dexie";
import type { MediaItem, MediaPreview } from "../models/media";
import {
  type AIUsageRecord,
  type CachedResolutionRecord,
  type DebridConfigRecord,
  type FolderKind,
  hasResumePoint,
  type IndexerConfigRecord,
  type LibraryEntryRecord,
  type LibraryFolderRecord,
  type ListType,
  listTypeSupportsFolders,
  type MediaCacheRecord,
  type SecretRecord,
  type SettingRecord,
  systemFolderID,
  systemFolderName,
  type TasteEventRecord,
  type WatchHistoryRecord,
  type WatchlistRecord,
} from "./models";
import type {
  LibraryEntryUpsert,
  SecretStore,
  Store,
  WatchHistoryUpsert,
} from "./types";

/** The list types that get a system root folder (mirrors the Swift
 * UserLibraryEntry.ListType.allCases). */
const LIST_TYPES: ListType[] = ["watchlist", "favorites", "custom"];

/** Compose the (mediaId, episodeId) watch-history primary key. A null/absent
 * episodeId collapses to the media-level row. */
function historyKey(mediaId: string, episodeId: string | null | undefined): string {
  return `${mediaId}:${episodeId ?? ""}`;
}

function nowISO(): string {
  return new Date().toISOString();
}

function uuid(): string {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  // Fallback for environments without crypto.randomUUID.
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export class DexieStore extends Dexie implements Store, SecretStore {
  // Typed tables (Dexie populates these from the schema below).
  private settings!: Table<SettingRecord, string>;
  private secrets!: Table<SecretRecord, string>;
  private watchlist!: Table<WatchlistRecord, string>;
  private watchHistory!: Table<WatchHistoryRecord, string>;
  private library!: Table<LibraryEntryRecord, string>;
  private folders!: Table<LibraryFolderRecord, string>;
  private indexerConfigs!: Table<IndexerConfigRecord, string>;
  private debridConfigs!: Table<DebridConfigRecord, string>;
  private tasteEvents!: Table<TasteEventRecord, string>;
  private mediaCache!: Table<MediaCacheRecord, string>;
  private cachedResolutions!: Table<CachedResolutionRecord, string>;
  private aiUsage!: Table<AIUsageRecord, string>;

  constructor(name = "debridstreamer") {
    super(name);

    // v1 schema. Primary keys are the leading field; `&` marks a unique index;
    // other comma-separated entries are secondary indexes used by the queries
    // below (e.g. watchHistory by lastWatched for recency ordering, library by
    // folderId / listType, configs by priority).
    this.version(1).stores({
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
    });

    // v2: adds the watchlist auto-resolve cache (one ready-to-play resolution
    // per media id, indexed by resolvedAt for staleness sweeps). Dexie carries
    // every v1 store forward automatically; only the new store is declared.
    this.version(2).stores({
      cachedResolutions: "mediaId, resolvedAt",
    });

    // v3: adds the local AI usage ledger (one row per AI call, indexed by
    // createdAt for recency ordering). Local-only — the "Would I Like This?"
    // analysis writes a record here on each call so a running cost estimate can
    // be shown. Dexie carries the prior stores forward; only the new one is here.
    this.version(3).stores({
      aiUsage: "id, createdAt",
    });
  }

  // ---- Settings -------------------------------------------------------------

  async getSetting(key: string): Promise<string | null> {
    const row = await this.settings.get(key);
    return row?.value ?? null;
  }

  async setSetting(key: string, value: string | null): Promise<void> {
    if (value == null) {
      await this.settings.delete(key);
      return;
    }
    await this.settings.put({ key, value });
  }

  async allSettings(): Promise<Record<string, string>> {
    const rows = await this.settings.toArray();
    const out: Record<string, string> = {};
    for (const r of rows) out[r.key] = r.value;
    return out;
  }

  // ---- Secrets (SecretStore) -----------------------------------------------

  async getSecret(key: string): Promise<string | null> {
    const row = await this.secrets.get(key);
    return row?.value ?? null;
  }

  async setSecret(key: string, value: string): Promise<void> {
    await this.secrets.put({ key, value });
  }

  async deleteSecret(key: string): Promise<void> {
    await this.secrets.delete(key);
  }

  // ---- Watchlist ------------------------------------------------------------

  async addToWatchlist(preview: MediaPreview): Promise<void> {
    // Keyed by mediaId → put() is an upsert, so there can be no duplicate.
    // Preserve the original addedAt when re-adding so ordering is stable, but
    // refresh the stored preview (metadata may have improved).
    const existing = await this.watchlist.get(preview.id);
    await this.watchlist.put({
      mediaId: preview.id,
      addedAt: existing?.addedAt ?? nowISO(),
      preview,
    });
  }

  async removeFromWatchlist(mediaId: string): Promise<void> {
    await this.watchlist.delete(mediaId);
  }

  async listWatchlist(): Promise<WatchlistRecord[]> {
    const rows = await this.watchlist.toArray();
    // Most-recently-added first.
    return rows.sort((a, b) => b.addedAt.localeCompare(a.addedAt));
  }

  async isInWatchlist(mediaId: string): Promise<boolean> {
    return (await this.watchlist.get(mediaId)) != null;
  }

  // ---- Watch history / resume ----------------------------------------------

  async recordHistory(entry: WatchHistoryUpsert): Promise<WatchHistoryRecord> {
    const episodeId = entry.episodeId ?? null;
    const id = historyKey(entry.mediaId, episodeId);
    // Upsert by the derived key → exactly one row per (mediaId, episodeId),
    // newest wins (put replaces). Mirrors WatchHistory.save in GRDB.
    const record: WatchHistoryRecord = {
      id,
      mediaId: entry.mediaId,
      episodeId,
      progressSeconds: entry.progressSeconds ?? 0,
      durationSeconds: entry.durationSeconds ?? null,
      completed: entry.completed ?? false,
      lastWatched: entry.lastWatched ?? nowISO(),
      streamQuality: entry.streamQuality ?? null,
      preview: entry.preview,
    };
    await this.watchHistory.put(record);
    return record;
  }

  async listHistory(limit = 100): Promise<WatchHistoryRecord[]> {
    // lastWatched index → reverse for newest-first, then cap.
    return this.watchHistory
      .orderBy("lastWatched")
      .reverse()
      .limit(limit)
      .toArray();
  }

  async getResume(
    mediaId: string,
    episodeId?: string | null,
  ): Promise<WatchHistoryRecord | null> {
    const row = await this.watchHistory.get(historyKey(mediaId, episodeId ?? null));
    return row ?? null;
  }

  async continueWatching(limit = 20): Promise<WatchHistoryRecord[]> {
    // Rows with a real resume point, newest first — mirrors fetchRecentWatchHistory.
    // Filter to resumable BEFORE slicing: zero-progress "viewed" rows (written
    // when a Detail opens) would otherwise fill the limit and crowd genuinely
    // resumable titles out of Continue Watching.
    const rows = await this.watchHistory
      .orderBy("lastWatched")
      .reverse()
      .filter((r) => hasResumePoint(r))
      .toArray();
    return rows.slice(0, limit);
  }

  // ---- Library + folders ----------------------------------------------------

  async addToLibrary(entry: LibraryEntryUpsert): Promise<LibraryEntryRecord> {
    // Serialize the reconcile-then-put in one transaction: the table is keyed by
    // a random uuid, so this read-then-decide is the ONLY thing enforcing the
    // one-row-per-(mediaId, folderId) invariant. Without a transaction, two
    // overlapping adds of the same media could both observe "absent" and insert
    // two permanent duplicate rows.
    return this.transaction("rw", this.library, this.folders, async () => {
      await this.ensureSystemFolders();

      // Resolve the folder the way the Swift addToLibrary normalization does:
      // non-folder list types pin to the system root; folder list types default
      // an empty folderId to the system root.
      const resolvedFolderId = listTypeSupportsFolders(entry.listType)
        ? (entry.folderId?.trim() || systemFolderID(entry.listType))
        : systemFolderID(entry.listType);

      // Reconcile on (mediaId, folderId) so re-adding the same media to the same
      // folder updates the existing row instead of creating a duplicate.
      const existing = await this.library
        .where("mediaId")
        .equals(entry.mediaId)
        .filter((r) => r.folderId === resolvedFolderId)
        .first();

      const record: LibraryEntryRecord = {
        id: existing?.id ?? `lib-${uuid()}`,
        mediaId: entry.mediaId,
        folderId: resolvedFolderId,
        listType: entry.listType,
        addedAt: entry.addedAt ?? existing?.addedAt ?? nowISO(),
        customListName: entry.customListName ?? existing?.customListName ?? null,
        releaseDateHint:
          entry.releaseDateHint ?? existing?.releaseDateHint ?? null,
        renewalStatus: entry.renewalStatus ?? existing?.renewalStatus ?? null,
        preview: entry.preview,
      };
      await this.library.put(record);
      return record;
    });
  }

  async removeFromLibrary(id: string): Promise<void> {
    await this.library.delete(id);
  }

  async listLibrary(listType?: ListType): Promise<LibraryEntryRecord[]> {
    const rows = listType
      ? await this.library.where("listType").equals(listType).toArray()
      : await this.library.toArray();
    return rows.sort((a, b) => b.addedAt.localeCompare(a.addedAt));
  }

  async listLibraryByFolder(folderId: string): Promise<LibraryEntryRecord[]> {
    const rows = await this.library.where("folderId").equals(folderId).toArray();
    return rows.sort((a, b) => b.addedAt.localeCompare(a.addedAt));
  }

  async saveFolder(folder: LibraryFolderRecord): Promise<void> {
    await this.folders.put(folder);
  }

  async createFolder(
    name: string,
    listType: ListType,
    parentId: string | null,
  ): Promise<LibraryFolderRecord> {
    if (!listTypeSupportsFolders(listType)) {
      throw new Error(`Folders are not supported for ${listType}.`);
    }
    await this.ensureSystemFolders();
    const resolvedParentId = parentId ?? systemFolderID(listType);
    const uniqueName = await this.uniqueFolderName(name, listType, resolvedParentId);
    const folder: LibraryFolderRecord = {
      id: `folder-${uuid()}`,
      name: uniqueName,
      parentId: resolvedParentId,
      listType,
      folderKind: "manual",
      isSystem: false,
      createdAt: nowISO(),
      updatedAt: nowISO(),
    };
    await this.folders.put(folder);
    return folder;
  }

  async listFolders(listType?: ListType): Promise<LibraryFolderRecord[]> {
    const rows = listType
      ? await this.folders.where("listType").equals(listType).toArray()
      : await this.folders.toArray();
    // System folders first, then by name — mirrors fetchAllLibraryFolders.
    return rows.sort((a, b) => {
      if (a.isSystem !== b.isSystem) return a.isSystem ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  }

  async deleteFolder(id: string): Promise<void> {
    const folder = await this.folders.get(id);
    if (folder == null) return;
    if (folder.isSystem) {
      throw new Error("System folders cannot be deleted");
    }
    // Reassign this folder's entries to the system root, then delete it.
    const fallback = systemFolderID(folder.listType);
    const entries = await this.library.where("folderId").equals(id).toArray();
    for (const entry of entries) {
      // Skip if the media already lives in the fallback (avoid a duplicate).
      const collides = await this.library
        .where("mediaId")
        .equals(entry.mediaId)
        .filter((r) => r.folderId === fallback)
        .first();
      if (collides) {
        await this.library.delete(entry.id);
      } else {
        await this.library.update(entry.id, { folderId: fallback });
      }
    }
    // Re-parent child folders to the root (parentId: null) rather than leaving
    // dangling parentId references — mirrors the server's ON DELETE SET NULL so
    // a subtree stays reachable after its parent is deleted.
    const children = await this.folders.where("parentId").equals(id).toArray();
    for (const child of children) {
      await this.folders.update(child.id, { parentId: null, updatedAt: nowISO() });
    }
    await this.folders.delete(id);
  }

  async ensureSystemFolders(): Promise<void> {
    for (const listType of LIST_TYPES) {
      const id = systemFolderID(listType);
      const existing = await this.folders.get(id);
      if (existing == null) {
        await this.folders.put({
          id,
          name: systemFolderName(listType),
          parentId: null,
          listType,
          folderKind: "system_root",
          isSystem: true,
          createdAt: nowISO(),
          updatedAt: nowISO(),
        });
      }
    }
    // Behavior folders under the favorites (Library) root — Watched / Release Wait.
    const libraryRoot = systemFolderID("favorites");
    const behaviors: { id: string; name: string; kind: FolderKind }[] = [
      { id: "system-favorites-watched", name: "Watched", kind: "watched" },
      {
        id: "system-favorites-release-wait",
        name: "Release Wait",
        kind: "release_wait",
      },
    ];
    for (const b of behaviors) {
      const existing = await this.folders.get(b.id);
      if (existing == null) {
        await this.folders.put({
          id: b.id,
          name: b.name,
          parentId: libraryRoot,
          listType: "favorites",
          folderKind: b.kind,
          isSystem: true,
          createdAt: nowISO(),
          updatedAt: nowISO(),
        });
      }
    }
  }

  private async uniqueFolderName(
    desired: string,
    listType: ListType,
    parentId: string | null,
  ): Promise<string> {
    const base = desired.trim().length > 0 ? desired.trim() : "New Folder";
    const siblings = await this.folders
      .where("listType")
      .equals(listType)
      .filter((f) => f.parentId === parentId)
      .toArray();
    const taken = new Set(siblings.map((f) => f.name));
    if (!taken.has(base)) return base;
    let i = 2;
    while (taken.has(`${base} (${i})`)) i += 1;
    return `${base} (${i})`;
  }

  // ---- Indexer configs ------------------------------------------------------

  async saveIndexerConfig(config: IndexerConfigRecord): Promise<void> {
    await this.indexerConfigs.put(config);
  }

  async listIndexerConfigs(): Promise<IndexerConfigRecord[]> {
    const rows = await this.indexerConfigs.toArray();
    return rows.sort((a, b) => a.priority - b.priority);
  }

  async deleteIndexerConfig(id: string): Promise<void> {
    await this.indexerConfigs.delete(id);
  }

  // ---- Debrid configs -------------------------------------------------------

  async saveDebridConfig(config: DebridConfigRecord): Promise<void> {
    await this.debridConfigs.put(config);
  }

  async listDebridConfigs(): Promise<DebridConfigRecord[]> {
    const rows = await this.debridConfigs.toArray();
    return rows.sort((a, b) => a.priority - b.priority);
  }

  async deleteDebridConfig(id: string): Promise<void> {
    await this.debridConfigs.delete(id);
  }

  // ---- Taste events ---------------------------------------------------------

  async addTasteEvent(event: TasteEventRecord): Promise<void> {
    await this.tasteEvents.put(event);
  }

  async recentTasteEvents(limit = 100): Promise<TasteEventRecord[]> {
    return this.tasteEvents
      .orderBy("createdAt")
      .reverse()
      .limit(limit)
      .toArray();
  }

  // ---- AI usage (local-only token/cost ledger) ------------------------------

  async addAIUsage(record: AIUsageRecord): Promise<void> {
    await this.aiUsage.put(record);
  }

  async totalAIUsageCostUSD(): Promise<number> {
    const rows = await this.aiUsage.toArray();
    return rows.reduce((sum, r) => sum + (r.estimatedCostUSD ?? 0), 0);
  }

  // ---- Media cache ----------------------------------------------------------

  async putMedia(item: MediaItem): Promise<void> {
    await this.mediaCache.put({ id: item.id, item, lastFetched: nowISO() });
  }

  async getMedia(id: string): Promise<MediaCacheRecord | null> {
    return (await this.mediaCache.get(id)) ?? null;
  }

  // ---- Cached resolutions (watchlist auto-resolve) --------------------------

  async putCachedResolution(record: CachedResolutionRecord): Promise<void> {
    // Keyed by mediaId → put() is an upsert, so exactly one resolution is kept
    // per title; re-resolving replaces the previous (newest wins).
    await this.cachedResolutions.put(record);
  }

  async getCachedResolution(
    mediaId: string,
  ): Promise<CachedResolutionRecord | null> {
    return (await this.cachedResolutions.get(mediaId)) ?? null;
  }

  async listCachedResolutions(): Promise<CachedResolutionRecord[]> {
    return this.cachedResolutions.toArray();
  }

  async deleteCachedResolution(mediaId: string): Promise<void> {
    await this.cachedResolutions.delete(mediaId);
  }
}
