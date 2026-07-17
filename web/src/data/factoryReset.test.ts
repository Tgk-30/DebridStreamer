// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  wipeKeychainSecrets,
  closeActiveLocalStore,
  currentDexieDbName,
  closeProfileRegistry,
  dbNameForProfile,
  listProfiles,
  clearServerSession,
  readCsrfToken,
  configuredServerURL,
  saveServerURL,
  deleteDatabase,
} = vi.hoisted(() => ({
  wipeKeychainSecrets: vi.fn(),
  closeActiveLocalStore: vi.fn(),
  currentDexieDbName: vi.fn(),
  closeProfileRegistry: vi.fn(),
  dbNameForProfile: vi.fn(),
  listProfiles: vi.fn(),
  clearServerSession: vi.fn(),
  readCsrfToken: vi.fn(),
  configuredServerURL: vi.fn(),
  saveServerURL: vi.fn(),
  deleteDatabase: vi.fn(),
}));

vi.mock("../storage/keychainWipe", () => ({ wipeKeychainSecrets }));
vi.mock("../lib/serverSession", () => ({ clearServerSession, readCsrfToken }));
vi.mock("../lib/serverMode", () => ({ configuredServerURL, saveServerURL }));
vi.mock("../storage", () => ({ closeActiveLocalStore, currentDexieDbName }));
vi.mock("../storage/ProfileRegistry", () => ({
  closeProfileRegistry,
  dbNameForProfile,
  listProfiles,
}));
vi.mock("dexie", () => ({ default: { delete: (...args: unknown[]) => deleteDatabase(...args) } }));

import { factoryReset } from "./factoryReset";

let reload: ReturnType<typeof vi.fn>;
let serverFetch: ReturnType<typeof vi.fn>;
let storage = new Map<string, string>();
const localStorageMock: Storage = {
  get length() { return storage.size; },
  clear: () => storage.clear(),
  getItem: (key) => storage.get(key) ?? null,
  key: (index) => [...storage.keys()][index] ?? null,
  removeItem: (key) => { storage.delete(key); },
  setItem: (key, value) => { storage.set(key, String(value)); },
};

beforeEach(() => {
  wipeKeychainSecrets.mockReset();
  closeActiveLocalStore.mockReset();
  currentDexieDbName.mockReset();
  closeProfileRegistry.mockReset();
  dbNameForProfile.mockReset();
  listProfiles.mockReset();
  clearServerSession.mockReset();
  readCsrfToken.mockReset();
  configuredServerURL.mockReset();
  saveServerURL.mockReset();
  deleteDatabase.mockReset();
  wipeKeychainSecrets.mockResolvedValue(undefined);
  serverFetch = vi.fn(async () => ({ status: 204, text: async () => "" }));
  closeActiveLocalStore.mockResolvedValue(undefined);
  currentDexieDbName.mockReturnValue("debridstreamer_p_active");
  listProfiles.mockResolvedValue([{ id: "other", isDefault: false }]);
  dbNameForProfile.mockReturnValue("debridstreamer_p_other");
  deleteDatabase.mockResolvedValue(undefined);
  configuredServerURL.mockReturnValue("https://server.example.com");
  readCsrfToken.mockReturnValue("csrf");
  reload = vi.fn();
  storage = new Map();
  vi.stubGlobal("localStorage", localStorageMock);
  vi.stubGlobal("window", { location: { reload }, localStorage: localStorageMock });
  vi.stubGlobal("fetch", serverFetch);
  Object.defineProperty(globalThis, "indexedDB", {
    configurable: true,
    value: {
      databases: vi.fn(async () => [
        { name: "debridstreamer" },
        { name: "debridstreamer_p_other" },
        { name: "unrelated" },
      ]),
    },
  });
  localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe("factoryReset", () => {
  it("wipes keychain secrets before deleting every DebridStreamer database", async () => {
    const events: string[] = [];
    wipeKeychainSecrets.mockImplementation(async () => events.push("keychain"));
    closeActiveLocalStore.mockImplementation(async () => events.push("close"));
    deleteDatabase.mockImplementation(async (name: string) => events.push(`delete:${name}`));
    // saveServerURL runs at the end of the localStorage sweep, and the reload
    // mock pushes too, so the assertion below pins the FULL contractual order:
    // keychain -> close -> deletes -> localStorage sweep -> reload LAST. (An
    // inert reload mock does not halt execution the way a real one would, so
    // without the ordering assertion a reload-too-early regression would pass.)
    saveServerURL.mockImplementation(() => events.push("clear-localstorage"));
    reload.mockImplementation(() => events.push("reload"));
    localStorage.setItem("ds_nav_collapsed", "true");
    // The settings store predates the ds_ convention (STORAGE_KEY in
    // data/settings.ts) and can hold plaintext secrets on web/PWA. A reset
    // that misses it leaves API keys behind - it must be swept too.
    localStorage.setItem("debridstreamer.settings.v1", "{\"omdbApiKey\":\"secret\"}");
    localStorage.setItem("other", "keep");

    await factoryReset();

    expect(serverFetch).toHaveBeenCalledWith(
      "https://server.example.com/api/auth/logout",
      expect.objectContaining({ method: "POST", credentials: "include", headers: { "x-csrf-token": "csrf" } }),
    );
    // The deletion set is the UNION of the indexedDB.databases() listing and
    // the known names (registry + active profile), because the spec allows the
    // listing to be an outdated snapshot missing a just-created DB. The mocked
    // listing here deliberately omits the active-profile and registry DBs to
    // pin that: replace-instead-of-union would leave them behind.
    expect(events).toEqual([
      "keychain",
      "close",
      "delete:debridstreamer",
      "delete:debridstreamer_p_other",
      "delete:debridstreamer_profiles",
      "delete:debridstreamer_p_active",
      "clear-localstorage",
      "reload",
    ]);
    expect(localStorage.getItem("ds_nav_collapsed")).toBeNull();
    expect(localStorage.getItem("debridstreamer.settings.v1")).toBeNull();
    expect(localStorage.getItem("other")).toBe("keep");
    expect(saveServerURL).toHaveBeenCalledWith(null);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("uses known profile names when indexedDB.databases is unavailable", async () => {
    Object.defineProperty(globalThis, "indexedDB", { configurable: true, value: {} });

    await factoryReset();

    expect(deleteDatabase).toHaveBeenCalledWith("debridstreamer");
    expect(deleteDatabase).toHaveBeenCalledWith("debridstreamer_profiles");
    expect(deleteDatabase).toHaveBeenCalledWith("debridstreamer_p_active");
    expect(deleteDatabase).toHaveBeenCalledWith("debridstreamer_p_other");
  });

  it("stops without deleting databases or reloading when keychain removal fails", async () => {
    wipeKeychainSecrets.mockRejectedValue(new Error("keychain locked"));

    await expect(factoryReset()).rejects.toThrow("keychain locked");

    expect(closeActiveLocalStore).not.toHaveBeenCalled();
    expect(deleteDatabase).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
  });
});
