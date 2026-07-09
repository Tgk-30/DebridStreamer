// DexieStore tests - run against fake-indexeddb (an in-memory, spec-compliant
// IndexedDB) so the real Dexie code path is exercised without a browser.
//
// Mirrors the intent of the Swift DatabaseManager tests: settings get/set/all;
// watchlist add/remove/dedup/contains; watch-history upsert (one row per
// (media,episode), newest wins) + getResume + continueWatching ordering;
// library + folder CRUD; indexer/debrid config CRUD + ordering; secrets.

import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DexieStore } from "./DexieStore";
import {
  makeIndexerConfigRecord,
  systemFolderID,
  type AIUsageRecord,
  type CachedResolutionRecord,
  type DebridConfigRecord,
  type TasteEventRecord,
} from "./models";
import type { MediaPreview } from "../models/media";
import type { MediaItem } from "../models/media";

function preview(id: string, title = id): MediaPreview {
  return { id, type: "movie", title };
}

let db: DexieStore;
let counter = 0;

beforeEach(() => {
  // Unique DB name per test → full isolation under fake-indexeddb.
  counter += 1;
  db = new DexieStore(`test-${counter}-${Date.now()}`);
});

afterEach(async () => {
  await db.delete();
});

// ---- Settings ---------------------------------------------------------------

describe("settings", () => {
  it("get returns null when unset", async () => {
    expect(await db.getSetting("missing")).toBeNull();
  });

  it("set then get round-trips", async () => {
    await db.setSetting("tmdb_api_key", "abc123");
    expect(await db.getSetting("tmdb_api_key")).toBe("abc123");
  });

  it("set overwrites", async () => {
    await db.setSetting("k", "v1");
    await db.setSetting("k", "v2");
    expect(await db.getSetting("k")).toBe("v2");
  });

  it("set null deletes", async () => {
    await db.setSetting("k", "v");
    await db.setSetting("k", null);
    expect(await db.getSetting("k")).toBeNull();
  });

  it("allSettings returns every key as an object", async () => {
    await db.setSetting("a", "1");
    await db.setSetting("b", "2");
    expect(await db.allSettings()).toEqual({ a: "1", b: "2" });
  });
});

// ---- Watchlist --------------------------------------------------------------

describe("watchlist", () => {
  it("add then list + contains", async () => {
    await db.addToWatchlist(preview("tt1"));
    expect(await db.isInWatchlist("tt1")).toBe(true);
    const list = await db.listWatchlist();
    expect(list.map((r) => r.mediaId)).toEqual(["tt1"]);
  });

  it("dedupes by mediaId (no duplicate rows)", async () => {
    await db.addToWatchlist(preview("tt1", "First"));
    await db.addToWatchlist(preview("tt1", "Second"));
    const list = await db.listWatchlist();
    expect(list).toHaveLength(1);
    // Latest preview wins (metadata refresh), addedAt is preserved.
    expect(list[0].preview.title).toBe("Second");
  });

  it("remove takes it off the list", async () => {
    await db.addToWatchlist(preview("tt1"));
    await db.removeFromWatchlist("tt1");
    expect(await db.isInWatchlist("tt1")).toBe(false);
    expect(await db.listWatchlist()).toHaveLength(0);
  });

  it("lists most-recently-added first", async () => {
    await db.addToWatchlist({ ...preview("tt1") });
    // Force distinct timestamps via the addedAt path.
    await new Promise((r) => setTimeout(r, 2));
    await db.addToWatchlist({ ...preview("tt2") });
    const list = await db.listWatchlist();
    expect(list[0].mediaId).toBe("tt2");
    expect(list[1].mediaId).toBe("tt1");
  });
});

// ---- Watch history / resume -------------------------------------------------

describe("watch history", () => {
  it("upserts one row per (mediaId, episodeId), newest wins", async () => {
    await db.recordHistory({ mediaId: "tt1", preview: preview("tt1"), progressSeconds: 10 });
    await db.recordHistory({ mediaId: "tt1", preview: preview("tt1"), progressSeconds: 120 });
    const all = await db.listHistory();
    expect(all).toHaveLength(1);
    expect(all[0].progressSeconds).toBe(120);
  });

  it("keeps movie and episode rows separate", async () => {
    await db.recordHistory({ mediaId: "tt1", preview: preview("tt1"), progressSeconds: 10 });
    await db.recordHistory({
      mediaId: "tt1",
      episodeId: "s1e1",
      preview: preview("tt1"),
      progressSeconds: 30,
    });
    const all = await db.listHistory();
    expect(all).toHaveLength(2);
  });

  it("remembers player prefs and preserves them across progress-only writes", async () => {
    // First write sets the remembered audio/sub/speed.
    await db.recordHistory({
      mediaId: "tt1",
      preview: preview("tt1"),
      progressSeconds: 60,
      preferredAudioId: "2",
      preferredAudioLang: "eng",
      preferredSubId: "no",
      playbackSpeed: 1.5,
    });
    // A later progress-only write (no pref fields) must NOT wipe them.
    await db.recordHistory({
      mediaId: "tt1",
      preview: preview("tt1"),
      progressSeconds: 900,
    });
    const resume = await db.getResume("tt1");
    expect(resume?.progressSeconds).toBe(900);
    expect(resume?.preferredAudioId).toBe("2");
    expect(resume?.preferredAudioLang).toBe("eng");
    expect(resume?.preferredSubId).toBe("no");
    expect(resume?.playbackSpeed).toBe(1.5);
  });

  it("getResume returns the (media, episode) row", async () => {
    await db.recordHistory({
      mediaId: "tt1",
      preview: preview("tt1"),
      progressSeconds: 300,
      durationSeconds: 6000,
    });
    const resume = await db.getResume("tt1");
    expect(resume?.progressSeconds).toBe(300);
    expect(await db.getResume("tt1", "s1e1")).toBeNull();
  });

  it("continueWatching is newest-first and only resumable rows (not completed, not zero-progress)", async () => {
    await db.recordHistory({
      mediaId: "tt1",
      preview: preview("tt1"),
      progressSeconds: 100,
      durationSeconds: 1000, // 10% → resumable
      lastWatched: "2024-01-01T00:00:00.000Z",
    });
    await db.recordHistory({
      mediaId: "tt2",
      preview: preview("tt2"),
      progressSeconds: 200,
      durationSeconds: 1000, // 20% → resumable
      lastWatched: "2024-02-01T00:00:00.000Z",
    });
    await db.recordHistory({
      mediaId: "tt3",
      preview: preview("tt3"),
      progressSeconds: 990,
      durationSeconds: 1000,
      completed: true, // finished → excluded
      lastWatched: "2024-03-01T00:00:00.000Z",
    });
    // A plain "viewed" row (opening Detail): zero progress → must NOT crowd out
    // the resumable rows above (regression for round-2 bug #2).
    await db.recordHistory({
      mediaId: "tt4",
      preview: preview("tt4"),
      progressSeconds: 0,
      durationSeconds: null,
      lastWatched: "2024-04-01T00:00:00.000Z",
    });
    const cw = await db.continueWatching();
    expect(cw.map((r) => r.mediaId)).toEqual(["tt2", "tt1"]);
  });

  it("listHistory orders newest-first", async () => {
    await db.recordHistory({
      mediaId: "tt1",
      preview: preview("tt1"),
      lastWatched: "2024-01-01T00:00:00.000Z",
    });
    await db.recordHistory({
      mediaId: "tt2",
      preview: preview("tt2"),
      lastWatched: "2024-05-01T00:00:00.000Z",
    });
    const all = await db.listHistory();
    expect(all.map((r) => r.mediaId)).toEqual(["tt2", "tt1"]);
  });
});

// ---- Library + folders ------------------------------------------------------

describe("library + folders", () => {
  it("ensureSystemFolders creates the per-list-type roots + behavior folders", async () => {
    await db.ensureSystemFolders();
    const folders = await db.listFolders();
    const ids = folders.map((f) => f.id);
    expect(ids).toContain(systemFolderID("watchlist"));
    expect(ids).toContain(systemFolderID("favorites"));
    expect(ids).toContain(systemFolderID("custom"));
    expect(ids).toContain("system-favorites-watched");
    expect(ids).toContain("system-favorites-release-wait");
  });

  it("addToLibrary pins watchlist to its system root and dedupes", async () => {
    await db.addToLibrary({ mediaId: "tt1", listType: "watchlist", preview: preview("tt1") });
    await db.addToLibrary({ mediaId: "tt1", listType: "watchlist", preview: preview("tt1") });
    const entries = await db.listLibrary("watchlist");
    expect(entries).toHaveLength(1);
    expect(entries[0].folderId).toBe(systemFolderID("watchlist"));
  });

  it("createFolder + listLibraryByFolder", async () => {
    const folder = await db.createFolder("Faves", "favorites", null);
    await db.addToLibrary({
      mediaId: "tt1",
      listType: "favorites",
      folderId: folder.id,
      preview: preview("tt1"),
    });
    const inFolder = await db.listLibraryByFolder(folder.id);
    expect(inFolder.map((e) => e.mediaId)).toEqual(["tt1"]);
  });

  it("addToLibrary serializes concurrent adds - no duplicate rows (regression)", async () => {
    await Promise.all([
      db.addToLibrary({ mediaId: "ttX", listType: "watchlist", preview: preview("ttX") }),
      db.addToLibrary({ mediaId: "ttX", listType: "watchlist", preview: preview("ttX") }),
    ]);
    const entries = await db.listLibrary("watchlist");
    expect(entries.filter((e) => e.mediaId === "ttX")).toHaveLength(1);
  });

  it("deleteFolder re-parents child folders to root, not dangling (regression)", async () => {
    const parent = await db.createFolder("Parent", "favorites", null);
    const child = await db.createFolder("Child", "favorites", parent.id);
    await db.deleteFolder(parent.id);
    const reloaded = (await db.listFolders("favorites")).find((f) => f.id === child.id);
    expect(reloaded).toBeDefined();
    expect(reloaded?.parentId).toBeNull();
  });

  it("createFolder rejects unsupported list types", async () => {
    await expect(db.createFolder("X", "watchlist", null)).rejects.toThrow();
  });

  it("createFolder falls back to a timestamp-random id when crypto.randomUUID is absent", async () => {
    // Exercise the uuid() fallback used in environments without crypto.randomUUID.
    const original = (globalThis as { crypto?: Crypto }).crypto;
    vi.stubGlobal("crypto", {}); // no randomUUID
    try {
      const folder = await db.createFolder("Fallback", "favorites", null);
      // Fallback shape: "folder-<base36ts>-<base36rand>" (no UUID hyphen-groups).
      expect(folder.id).toMatch(/^folder-[0-9a-z]+-[0-9a-z]+$/);
    } finally {
      vi.stubGlobal("crypto", original);
      vi.unstubAllGlobals();
    }
  });

  it("createFolder uniquifies duplicate names", async () => {
    const a = await db.createFolder("Dupe", "favorites", null);
    const b = await db.createFolder("Dupe", "favorites", null);
    expect(a.name).toBe("Dupe");
    expect(b.name).toBe("Dupe (2)");
  });

  it("deleteFolder reassigns entries to the system root", async () => {
    const folder = await db.createFolder("Temp", "favorites", null);
    await db.addToLibrary({
      mediaId: "tt1",
      listType: "favorites",
      folderId: folder.id,
      preview: preview("tt1"),
    });
    await db.deleteFolder(folder.id);
    const root = await db.listLibraryByFolder(systemFolderID("favorites"));
    expect(root.map((e) => e.mediaId)).toEqual(["tt1"]);
    expect(await db.listFolders("favorites")).not.toContainEqual(
      expect.objectContaining({ id: folder.id }),
    );
  });

  it("deleteFolder drops an entry that already lives in the system root (collision)", async () => {
    // Same media in BOTH a manual folder and the system root → on delete the
    // manual-folder row is dropped (not reassigned) to avoid a duplicate.
    const folder = await db.createFolder("Temp", "favorites", null);
    await db.addToLibrary({
      mediaId: "tt1",
      listType: "favorites",
      folderId: folder.id,
      preview: preview("tt1"),
    });
    await db.addToLibrary({
      mediaId: "tt1",
      listType: "favorites",
      folderId: systemFolderID("favorites"),
      preview: preview("tt1"),
    });
    await db.deleteFolder(folder.id);
    const root = await db.listLibraryByFolder(systemFolderID("favorites"));
    // Exactly one row remains for tt1 in the root (no duplicate created).
    expect(root.filter((e) => e.mediaId === "tt1")).toHaveLength(1);
  });

  it("deleteFolder on a missing id is a silent no-op", async () => {
    await expect(db.deleteFolder("does-not-exist")).resolves.toBeUndefined();
  });

  it("deleteFolder refuses system folders", async () => {
    await db.ensureSystemFolders();
    await expect(db.deleteFolder(systemFolderID("favorites"))).rejects.toThrow();
  });

  it("saveFolder upserts an arbitrary folder record", async () => {
    const rec = {
      id: "f-custom",
      name: "Manual Save",
      parentId: null,
      listType: "favorites" as const,
      folderKind: "manual" as const,
      isSystem: false,
      createdAt: "2024-01-01T00:00:00.000Z",
      updatedAt: "2024-01-01T00:00:00.000Z",
    };
    await db.saveFolder(rec);
    expect(await db.listFolders("favorites")).toContainEqual(
      expect.objectContaining({ id: "f-custom", name: "Manual Save" }),
    );
  });

  it("listLibrary with no listType returns every entry, newest-first", async () => {
    await db.addToLibrary({
      mediaId: "tt1",
      listType: "favorites",
      addedAt: "2024-01-01T00:00:00.000Z",
      preview: preview("tt1"),
    });
    await db.addToLibrary({
      mediaId: "tt2",
      listType: "watchlist",
      addedAt: "2024-02-02T00:00:00.000Z",
      preview: preview("tt2"),
    });
    const all = await db.listLibrary();
    // Both list types present, ordered newest addedAt first.
    expect(all.map((e) => e.mediaId)).toEqual(["tt2", "tt1"]);
  });

  it("removeFromLibrary removes an entry by id", async () => {
    const entry = await db.addToLibrary({
      mediaId: "tt1",
      listType: "favorites",
      preview: preview("tt1"),
    });
    await db.removeFromLibrary(entry.id);
    expect(await db.listLibrary("favorites")).toHaveLength(0);
  });

  it("listFolders puts system folders first", async () => {
    await db.ensureSystemFolders();
    await db.createFolder("AAA Manual", "favorites", null);
    const folders = await db.listFolders("favorites");
    expect(folders[0].isSystem).toBe(true);
  });

  it("listFolders orders same-tier (non-system) folders by name", async () => {
    await db.createFolder("Zeta", "favorites", null);
    await db.createFolder("Alpha", "favorites", null);
    const manual = (await db.listFolders("favorites")).filter((f) => !f.isSystem);
    expect(manual.map((f) => f.name)).toEqual(["Alpha", "Zeta"]);
  });

  it("createFolder with a blank name defaults to 'New Folder'", async () => {
    const folder = await db.createFolder("   ", "favorites", null);
    expect(folder.name).toBe("New Folder");
  });
});

// ---- Indexer configs --------------------------------------------------------

describe("indexer configs", () => {
  it("save + list ordered by priority", async () => {
    await db.saveIndexerConfig(
      makeIndexerConfigRecord({ id: "b", type: "torznab", baseURL: "u", priority: 2 }),
    );
    await db.saveIndexerConfig(
      makeIndexerConfigRecord({ id: "a", type: "jackett", baseURL: "u", priority: 1 }),
    );
    const list = await db.listIndexerConfigs();
    expect(list.map((c) => c.id)).toEqual(["a", "b"]);
  });

  it("defaults providerSubtype + endpointPath from type", async () => {
    await db.saveIndexerConfig(
      makeIndexerConfigRecord({ id: "j", type: "jackett", baseURL: "u" }),
    );
    const [c] = await db.listIndexerConfigs();
    expect(c.providerSubtype).toBe("jackett");
    expect(c.endpointPath).toBe("/api/v2.0/indexers/all/results/torznab/api");
  });

  it("persists the stremio_addon type faithfully", async () => {
    await db.saveIndexerConfig(
      makeIndexerConfigRecord({
        id: "s",
        type: "stremio_addon",
        baseURL: "https://addon.example/manifest.json",
      }),
    );
    const [c] = await db.listIndexerConfigs();
    expect(c.type).toBe("stremio_addon");
    expect(c.providerSubtype).toBe("stremio_addon");
  });

  it("save acts as upsert, delete removes", async () => {
    const cfg = makeIndexerConfigRecord({ id: "x", type: "torznab", baseURL: "u" });
    await db.saveIndexerConfig(cfg);
    await db.saveIndexerConfig({ ...cfg, baseURL: "u2" });
    let list = await db.listIndexerConfigs();
    expect(list).toHaveLength(1);
    expect(list[0].baseURL).toBe("u2");
    await db.deleteIndexerConfig("x");
    list = await db.listIndexerConfigs();
    expect(list).toHaveLength(0);
  });
});

// ---- Debrid configs ---------------------------------------------------------

describe("debrid configs", () => {
  function cfg(id: string, priority: number): DebridConfigRecord {
    return { id, service: "real_debrid", apiToken: "tok", isActive: true, priority };
  }

  it("save + list ordered by priority, upsert + delete", async () => {
    await db.saveDebridConfig(cfg("b", 5));
    await db.saveDebridConfig(cfg("a", 1));
    let list = await db.listDebridConfigs();
    expect(list.map((c) => c.id)).toEqual(["a", "b"]);

    await db.saveDebridConfig({ ...cfg("a", 1), apiToken: "tok2" });
    list = await db.listDebridConfigs();
    expect(list).toHaveLength(2);
    expect(list[0].apiToken).toBe("tok2");

    await db.deleteDebridConfig("a");
    list = await db.listDebridConfigs();
    expect(list.map((c) => c.id)).toEqual(["b"]);
  });
});

// ---- Taste events -----------------------------------------------------------

describe("taste events", () => {
  function event(id: string, createdAt: string): TasteEventRecord {
    return {
      id,
      userId: "default",
      mediaId: "tt1",
      episodeId: null,
      eventType: "added_to_watchlist",
      signalStrength: 1,
      metadata: {},
      createdAt,
    };
  }

  it("add + recent newest-first, capped", async () => {
    await db.addTasteEvent(event("e1", "2024-01-01T00:00:00.000Z"));
    await db.addTasteEvent(event("e2", "2024-02-01T00:00:00.000Z"));
    const recent = await db.recentTasteEvents();
    expect(recent.map((e) => e.id)).toEqual(["e2", "e1"]);
    expect(await db.recentTasteEvents(1)).toHaveLength(1);
  });
});

// ---- Media cache ------------------------------------------------------------

describe("media cache", () => {
  it("put + get round-trips", async () => {
    const item: MediaItem = {
      id: "tt1",
      type: "movie",
      title: "Cached",
      genres: [],
      lastFetched: new Date().toISOString(),
    };
    await db.putMedia(item);
    const got = await db.getMedia("tt1");
    expect(got?.item.title).toBe("Cached");
    expect(await db.getMedia("missing")).toBeNull();
  });
});

// ---- Secrets (SecretStore) --------------------------------------------------

describe("secrets", () => {
  it("get/set/delete round-trips", async () => {
    expect(await db.getSecret("k")).toBeNull();
    await db.setSecret("k", "s3cr3t");
    expect(await db.getSecret("k")).toBe("s3cr3t");
    await db.setSecret("k", "rotated");
    expect(await db.getSecret("k")).toBe("rotated");
    await db.deleteSecret("k");
    expect(await db.getSecret("k")).toBeNull();
  });
});

// ---- AI usage (local-only cost/token ledger) --------------------------------

describe("AI usage ledger", () => {
  function usage(id: string, cost: number | null): AIUsageRecord {
    return {
      id,
      provider: "openai",
      model: "gpt-4o-mini",
      feature: "analyze",
      inputTokens: 10,
      outputTokens: 20,
      totalTokens: 30,
      estimatedCostUSD: cost,
      createdAt: "2024-01-01T00:00:00.000Z",
    };
  }

  it("starts at zero cost with no records", async () => {
    expect(await db.totalAIUsageCostUSD()).toBe(0);
  });

  it("sums estimatedCostUSD across records, treating null as zero", async () => {
    await db.addAIUsage(usage("u1", 0.01));
    await db.addAIUsage(usage("u2", 0.25));
    await db.addAIUsage(usage("u3", null)); // null contributes 0
    expect(await db.totalAIUsageCostUSD()).toBeCloseTo(0.26, 10);
  });

  it("addAIUsage upserts by id (newest wins)", async () => {
    await db.addAIUsage(usage("u1", 0.1));
    await db.addAIUsage(usage("u1", 0.5));
    expect(await db.totalAIUsageCostUSD()).toBeCloseTo(0.5, 10);
  });
});

// ---- Cached resolutions (watchlist auto-resolve) ----------------------------

describe("cached resolutions", () => {
  function resolution(mediaId: string, resolvedAt: string): CachedResolutionRecord {
    return {
      mediaId,
      stream: {
        streamURL: `https://cdn.example/${mediaId}.mkv`,
        quality: "1080p",
        codec: "H.265",
        audio: "AAC",
        source: "WEB-DL",
        sizeBytes: 1_000_000,
        fileName: `${mediaId}.mkv`,
        debridService: "RD",
      },
      resolvedAt,
      debridService: "RD",
      infoHash: `hash-${mediaId}`,
    };
  }

  it("put + get round-trips and returns null for a missing id", async () => {
    expect(await db.getCachedResolution("tt1")).toBeNull();
    await db.putCachedResolution(resolution("tt1", "2024-01-01T00:00:00.000Z"));
    const got = await db.getCachedResolution("tt1");
    expect(got?.mediaId).toBe("tt1");
    expect(got?.stream.streamURL).toBe("https://cdn.example/tt1.mkv");
    expect(got?.infoHash).toBe("hash-tt1");
  });

  it("put is an upsert keyed by mediaId (newest wins)", async () => {
    await db.putCachedResolution(resolution("tt1", "2024-01-01T00:00:00.000Z"));
    await db.putCachedResolution(resolution("tt1", "2024-02-02T00:00:00.000Z"));
    const got = await db.getCachedResolution("tt1");
    expect(got?.resolvedAt).toBe("2024-02-02T00:00:00.000Z");
    expect(await db.listCachedResolutions()).toHaveLength(1);
  });

  it("list returns all rows and delete removes one", async () => {
    await db.putCachedResolution(resolution("tt1", "2024-01-01T00:00:00.000Z"));
    await db.putCachedResolution(resolution("tt2", "2024-01-02T00:00:00.000Z"));
    expect(await db.listCachedResolutions()).toHaveLength(2);
    await db.deleteCachedResolution("tt1");
    const remaining = await db.listCachedResolutions();
    expect(remaining.map((r) => r.mediaId)).toEqual(["tt2"]);
    // Deleting a missing id is a no-op.
    await db.deleteCachedResolution("nope");
    expect(await db.listCachedResolutions()).toHaveLength(1);
  });
});
