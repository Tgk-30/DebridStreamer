// KeychainSecretStore unit tests. Mocks @tauri-apps/api/core's `invoke` (no Tauri
// runtime needed). Uses a STATEFUL keychain map + a STATEFUL Dexie-like fallback
// so the lifecycle interactions (migrate -> delete -> re-read) are exercised, not
// just per-call shapes. Covers the security-critical behaviors:
//   - writes fail CLOSED (a keychain failure rejects and never writes plaintext),
//   - reads degrade to null on a keychain error (no plaintext read, no reject),
//   - migration MOVES the legacy copy (purges IndexedDB) so a deleted secret
//     cannot resurrect.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

import {
  __resetSecretReadFailuresForTesting,
  KEYCHAIN_SERVICE,
  KeychainSecretStore,
  secretReadsFailedThisSession,
} from "./KeychainSecretStore";
import type { SecretStore } from "./types";

/** A stateful in-memory SecretStore standing in for the Dexie fallback. */
function mapStore(init?: Record<string, string>): SecretStore & { _map: Map<string, string> } {
  const m = new Map<string, string>(Object.entries(init ?? {}));
  return {
    _map: m,
    getSecret: async (k) => (m.has(k) ? (m.get(k) as string) : null),
    setSecret: async (k, v) => void m.set(k, v),
    deleteSecret: async (k) => void m.delete(k),
  };
}

/** Wire `invoke` to a stateful keychain Map so get/set/delete actually persist.
 *  `failOn` makes the named commands reject (locked/denied keychain). The impl is
 *  tolerant of any incidental zero-arg bookkeeping call Vitest makes on the mock
 *  (returns undefined) so only the command under test drives behavior. */
function statefulKeychain(failOn: string[] = []): Map<string, string> {
  const kc = new Map<string, string>();
  invoke.mockImplementation(async (cmd?: string, args?: { key: string; value?: string }) => {
    if (cmd != null && failOn.includes(cmd)) throw new Error("keychain locked");
    if (cmd === "keychain_get") return args && kc.has(args.key) ? kc.get(args.key) : null;
    if (cmd === "keychain_set" && args) {
      kc.set(args.key, args.value as string);
      return undefined;
    }
    if (cmd === "keychain_delete" && args) {
      kc.delete(args.key);
      return undefined;
    }
    return undefined;
  });
  return kc;
}

describe("KeychainSecretStore", () => {
  beforeEach(() => {
    invoke.mockReset();
    __resetSecretReadFailuresForTesting();
  });
  afterEach(() => vi.clearAllMocks());

  it("getSecret invokes keychain_get with the service namespace", async () => {
    statefulKeychain().set("tmdb_api_key", "tok-123");
    const store = new KeychainSecretStore(mapStore());
    await expect(store.getSecret("tmdb_api_key")).resolves.toBe("tok-123");
    expect(invoke).toHaveBeenCalledWith("keychain_get", {
      service: KEYCHAIN_SERVICE,
      key: "tmdb_api_key",
    });
  });

  it("getSecret returns null on a genuine miss with no legacy copy", async () => {
    statefulKeychain();
    const store = new KeychainSecretStore(mapStore());
    await expect(store.getSecret("omdb_api_key")).resolves.toBeNull();
  });

  it("setSecret writes to the keychain and purges any legacy plaintext copy", async () => {
    const kc = statefulKeychain();
    const fb = mapStore({ "debrid.debrid-real_debrid": "old-plaintext" });
    const store = new KeychainSecretStore(fb);
    await store.setSecret("debrid.debrid-real_debrid", "rd-tok");
    expect(kc.get("debrid.debrid-real_debrid")).toBe("rd-tok");
    expect(invoke).toHaveBeenCalledWith("keychain_set", {
      service: KEYCHAIN_SERVICE,
      key: "debrid.debrid-real_debrid",
      value: "rd-tok",
    });
    // Legacy plaintext copy must be purged so it can't resurrect / linger.
    expect(await fb.getSecret("debrid.debrid-real_debrid")).toBeNull();
  });

  it("deleteSecret removes from the keychain", async () => {
    const kc = statefulKeychain();
    kc.set("ai_api_key", "x");
    const store = new KeychainSecretStore(mapStore());
    await store.deleteSecret("ai_api_key");
    expect(kc.has("ai_api_key")).toBe(false);
    expect(invoke).toHaveBeenCalledWith("keychain_delete", {
      service: KEYCHAIN_SERVICE,
      key: "ai_api_key",
    });
  });

  // --- security-critical behaviors ----------------------------------------

  it("setSecret FAILS CLOSED: rejects and writes no plaintext when the keychain fails", async () => {
    statefulKeychain(["keychain_set"]);
    const fb = mapStore();
    const store = new KeychainSecretStore(fb);
    await expect(store.setSecret("tmdb_api_key", "secret")).rejects.toThrow("keychain locked");
    // The credential must NOT have been written to the (plaintext) fallback.
    expect(await fb.getSecret("tmdb_api_key")).toBeNull();
  });

  it("getSecret degrades to null (no plaintext read, no reject) on a keychain read error", async () => {
    statefulKeychain(["keychain_get"]);
    const fb = mapStore({ tmdb_api_key: "legacy-plaintext" });
    const store = new KeychainSecretStore(fb);
    // Must not reject, must not serve the plaintext legacy on a keychain ERROR.
    await expect(store.getSecret("tmdb_api_key")).resolves.toBeNull();
    // And it must not have touched the legacy copy.
    expect(await fb.getSecret("tmdb_api_key")).toBe("legacy-plaintext");
    // The failure is signalled so key-dependent gates (forced onboarding)
    // stand down instead of treating "unreadable" as "missing".
    expect(secretReadsFailedThisSession()).toBe(true);
  });

  it("does NOT signal read failures on a genuine miss or a healthy read", async () => {
    statefulKeychain().set("tmdb_api_key", "tok-123");
    const store = new KeychainSecretStore(mapStore());
    await store.getSecret("tmdb_api_key");
    await store.getSecret("missing_key");
    expect(secretReadsFailedThisSession()).toBe(false);
  });

  it("migrates a legacy IndexedDB secret into the keychain AND purges the plaintext copy", async () => {
    const kc = statefulKeychain();
    const fb = mapStore({ tmdb_api_key: "legacy-key" });
    const store = new KeychainSecretStore(fb);
    await expect(store.getSecret("tmdb_api_key")).resolves.toBe("legacy-key");
    expect(kc.get("tmdb_api_key")).toBe("legacy-key"); // moved up
    expect(await fb.getSecret("tmdb_api_key")).toBeNull(); // purged (move, not copy)
  });

  it("does NOT resurrect a deleted secret (migrate -> delete -> re-read stays gone)", async () => {
    const kc = statefulKeychain();
    const fb = mapStore({ "debrid.debrid-real_debrid": "legacy-token" });
    const store = new KeychainSecretStore(fb);

    // 1) first read migrates the legacy token into the keychain and purges Dexie
    expect(await store.getSecret("debrid.debrid-real_debrid")).toBe("legacy-token");
    expect(await fb.getSecret("debrid.debrid-real_debrid")).toBeNull();

    // 2) user clears the key
    await store.deleteSecret("debrid.debrid-real_debrid");
    expect(kc.has("debrid.debrid-real_debrid")).toBe(false);

    // 3) the deleted secret must stay gone - no read-through resurrection
    expect(await store.getSecret("debrid.debrid-real_debrid")).toBeNull();
  });
});
