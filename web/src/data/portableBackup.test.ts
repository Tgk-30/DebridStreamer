import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DexieStore, __setStoreForTesting } from "../storage";
import {
  __resetProfileRegistryForTesting,
  createProfileRecord,
  dbNameForProfile,
  getActiveProfileId,
  listProfiles,
  setActiveProfileId,
  setAutoEnterProfileId,
  setMultiUserEnabled,
} from "../storage/ProfileRegistry";
import {
  exportPortableBackup,
  parsePortableBackup,
  restorePortableBackup,
} from "./portableBackup";

describe("portable local backup", () => {
  const stores: DexieStore[] = [];

  beforeEach(async () => {
    __setStoreForTesting(null);
    await __resetProfileRegistryForTesting();
  });

  afterEach(async () => {
    await Promise.all(
      stores.splice(0).map(async (store) => {
        store.close();
        await indexedDB.deleteDatabase(store.name);
      }),
    );
    __setStoreForTesting(null);
    await __resetProfileRegistryForTesting();
  });

  it("exports user data without settings secrets or secret tables", async () => {
    const store = new DexieStore(`portable-export-${crypto.randomUUID()}`);
    stores.push(store);
    await store.setSetting("ui_theme", "midnight");
    await store.setSetting("tmdb_api_key", "secret:tmdb_api_key");
    await store.setSecret("tmdb_api_key", "do-not-export");
    await store.addToWatchlist({
      id: "movie-1",
      type: "movie",
      title: "Saved film",
      posterPath: null,
      backdropPath: null,
    });

    const backup = await exportPortableBackup(store);

    expect(backup.profiles[0]!.data.settings).toEqual([{ key: "ui_theme", value: "midnight" }]);
    expect(backup.profiles[0]!.data.watchlist).toHaveLength(1);
    expect(JSON.stringify(backup)).not.toContain("do-not-export");
    expect(backup.profiles[0]!.data).not.toHaveProperty("secrets");
    expect(backup.profiles[0]!.data).not.toHaveProperty("cachedResolutions");
    expect(backup.profiles[0]!.data).not.toHaveProperty("downloads");
  });

  it("restores an exact non-secret snapshot and preserves existing secrets", async () => {
    const source = new DexieStore(`portable-source-${crypto.randomUUID()}`);
    const target = new DexieStore(`portable-target-${crypto.randomUUID()}`);
    stores.push(source, target);
    await source.setSetting("ui_theme", "midnight");
    await source.addToWatchlist({
      id: "movie-1",
      type: "movie",
      title: "Saved film",
      posterPath: null,
      backdropPath: null,
    });
    const backup = await exportPortableBackup(source);

    await target.setSetting("ui_theme", "light");
    await target.setSetting("obsolete_setting", "remove-me");
    await target.setSetting("tmdb_api_key", "secret:tmdb_api_key");
    await target.setSecret("tmdb_api_key", "keep-me");
    const result = await restorePortableBackup(backup, target);

    expect(result.preRestoreBackup.profiles[0]!.data.settings).toContainEqual({
      key: "ui_theme",
      value: "light",
    });
    expect(await target.getSetting("ui_theme")).toBe("midnight");
    expect(await target.getSetting("obsolete_setting")).toBeNull();
    expect(await target.getSetting("tmdb_api_key")).toBe("secret:tmdb_api_key");
    expect(await target.getSecret("tmdb_api_key")).toBe("keep-me");
    expect(await target.listWatchlist()).toHaveLength(1);
  });

  it("exports and restores every local profile without exporting profile locks", async () => {
    const defaultStore = new DexieStore("debridstreamer");
    const secondProfile = {
      id: `kid-${crypto.randomUUID()}`,
      name: "Kid",
      isDefault: false,
      isAdmin: false,
      passwordHash: "do-not-export",
      createdAt: Date.now() + 1,
    };
    const secondStore = new DexieStore(dbNameForProfile(secondProfile));
    stores.push(defaultStore, secondStore);
    __setStoreForTesting(defaultStore);
    await createProfileRecord({
      id: "default",
      name: "Owner",
      isDefault: true,
      isAdmin: true,
      passwordHash: "keep-local-lock",
      createdAt: Date.now(),
    });
    await createProfileRecord(secondProfile);
    await setActiveProfileId(secondProfile.id);
    await setAutoEnterProfileId(secondProfile.id);
    await setMultiUserEnabled(true);
    await defaultStore.setSetting("ui_theme", "midnight");
    await secondStore.addToWatchlist({
      id: "movie-kid",
      type: "movie",
      title: "Kid film",
      posterPath: null,
      backdropPath: null,
    });

    const backup = await exportPortableBackup();
    expect(backup.profiles).toHaveLength(2);
    expect(backup.activeProfileId).toBe(secondProfile.id);
    expect(JSON.stringify(backup)).not.toContain("do-not-export");
    expect(JSON.stringify(backup)).not.toContain("keep-local-lock");

    __setStoreForTesting(null);
    defaultStore.close();
    secondStore.close();
    await indexedDB.deleteDatabase(defaultStore.name);
    await indexedDB.deleteDatabase(secondStore.name);
    await __resetProfileRegistryForTesting();
    const restoredDefault = new DexieStore("debridstreamer");
    stores.push(restoredDefault);
    __setStoreForTesting(restoredDefault);

    const result = await restorePortableBackup(backup);
    expect(result.restoredProfiles).toBe(2);
    expect(result.unlockedProfiles).toBe(2);
    expect(await getActiveProfileId()).toBe(secondProfile.id);
    expect(await listProfiles()).toHaveLength(2);
    const restoredSecond = new DexieStore(dbNameForProfile(secondProfile));
    stores.push(restoredSecond);
    expect(await restoredSecond.listWatchlist()).toHaveLength(1);
  });

  it("rejects malformed, oversized, and secret-bearing backups", () => {
    expect(() => parsePortableBackup("{")).toThrow("not valid JSON");
    const secretBackup = {
      product: "YAWF Stream",
      format: "yawf-local-backup",
      version: 2,
      createdAt: new Date().toISOString(),
      activeProfileId: "default",
      autoEnterProfileId: "default",
      multiUserEnabled: false,
      exclusions: [],
      profiles: [
        {
          profile: {
            id: "default",
            name: "You",
            isDefault: true,
            isAdmin: true,
            createdAt: Date.now(),
          },
          databaseName: "debridstreamer",
          data: {
            settings: [{ key: "tmdb_api_key", value: "unsafe" }],
            watchlist: [],
            watchlistFolders: [],
            watchHistory: [],
            library: [],
            folders: [],
            tasteEvents: [],
            mediaCache: [],
            aiUsage: [],
          },
        },
      ],
    };
    expect(() => parsePortableBackup(JSON.stringify(secretBackup))).toThrow(
      "secret-valued setting",
    );
    expect(() => parsePortableBackup(" ".repeat(100 * 1024 * 1024 + 1))).toThrow(
      "100 MB",
    );
  });
});
