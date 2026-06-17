// KeychainSecretStore unit tests. The class is testable without a Tauri runtime
// by mocking @tauri-apps/api/core's `invoke`. Covers: the command/arg shapes,
// the Ok(None) -> null mapping, the Dexie fallback on a thrown invoke, and the
// one-time read-through migration of a pre-keychain (IndexedDB) secret.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock the lazy-imported Tauri core module.
const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

import { KEYCHAIN_SERVICE, KeychainSecretStore } from "./KeychainSecretStore";
import type { SecretStore } from "./types";

function makeFallback(): SecretStore & {
  getSecret: ReturnType<typeof vi.fn>;
  setSecret: ReturnType<typeof vi.fn>;
  deleteSecret: ReturnType<typeof vi.fn>;
} {
  return {
    getSecret: vi.fn(async () => null),
    setSecret: vi.fn(async () => {}),
    deleteSecret: vi.fn(async () => {}),
  };
}

describe("KeychainSecretStore", () => {
  beforeEach(() => invoke.mockReset());
  afterEach(() => vi.clearAllMocks());

  it("getSecret invokes keychain_get with the service namespace", async () => {
    invoke.mockResolvedValueOnce("tok-123");
    const store = new KeychainSecretStore(makeFallback());
    await expect(store.getSecret("tmdb_api_key")).resolves.toBe("tok-123");
    expect(invoke).toHaveBeenCalledWith("keychain_get", {
      service: KEYCHAIN_SERVICE,
      key: "tmdb_api_key",
    });
  });

  it("getSecret returns null when the keychain has no entry and no legacy value", async () => {
    invoke.mockResolvedValueOnce(null); // mirrors Rust Ok(None)
    const store = new KeychainSecretStore(makeFallback());
    await expect(store.getSecret("omdb_api_key")).resolves.toBeNull();
  });

  it("setSecret invokes keychain_set with service/key/value", async () => {
    invoke.mockResolvedValueOnce(undefined);
    const store = new KeychainSecretStore(makeFallback());
    await store.setSecret("debrid.debrid-real_debrid", "rd-tok");
    expect(invoke).toHaveBeenCalledWith("keychain_set", {
      service: KEYCHAIN_SERVICE,
      key: "debrid.debrid-real_debrid",
      value: "rd-tok",
    });
  });

  it("deleteSecret invokes keychain_delete", async () => {
    invoke.mockResolvedValueOnce(undefined);
    const store = new KeychainSecretStore(makeFallback());
    await store.deleteSecret("ai_api_key");
    expect(invoke).toHaveBeenCalledWith("keychain_delete", {
      service: KEYCHAIN_SERVICE,
      key: "ai_api_key",
    });
  });

  it("falls back to Dexie when invoke throws (misbuilt bundle)", async () => {
    // Use mockImplementationOnce (one throw) to match the single invoke call the
    // fallback path makes. A PERSISTENT throwing mock makes Vitest's mock
    // result-tracking surface a spurious unhandled rejection here even though the
    // source already catches the throw and returns the fallback value.
    invoke.mockImplementationOnce(() => {
      throw new Error("no tauri");
    });
    const fallback = makeFallback();
    fallback.getSecret.mockResolvedValueOnce("from-dexie");
    const store = new KeychainSecretStore(fallback);
    await expect(store.getSecret("tmdb_api_key")).resolves.toBe("from-dexie");
    expect(fallback.getSecret).toHaveBeenCalledWith("tmdb_api_key");
  });

  it("setSecret falls back to Dexie when invoke throws", async () => {
    invoke.mockImplementationOnce(() => {
      throw new Error("no tauri");
    });
    const fallback = makeFallback();
    const store = new KeychainSecretStore(fallback);
    await store.setSecret("tmdb_api_key", "k");
    expect(fallback.setSecret).toHaveBeenCalledWith("tmdb_api_key", "k");
  });

  it("migrates a legacy IndexedDB secret into the keychain on first read", async () => {
    invoke
      .mockResolvedValueOnce(null) // keychain_get: empty
      .mockResolvedValueOnce(undefined); // keychain_set: write-up
    const fallback = makeFallback();
    fallback.getSecret.mockResolvedValueOnce("legacy-key");
    const store = new KeychainSecretStore(fallback);
    await expect(store.getSecret("tmdb_api_key")).resolves.toBe("legacy-key");
    expect(invoke).toHaveBeenNthCalledWith(2, "keychain_set", {
      service: KEYCHAIN_SERVICE,
      key: "tmdb_api_key",
      value: "legacy-key",
    });
  });
});
