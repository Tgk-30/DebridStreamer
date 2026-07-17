// keychainWipe unit tests. Mocks @tauri-apps/api/core's `invoke` and the Tauri
// detection (no Tauri runtime needed). Covers the factory-reset guarantees:
//   - every allowlisted key is deleted (nothing skipped, nothing extra),
//   - a per-key failure does NOT stop the sweep (remaining keys still deleted)
//     but IS surfaced in the aggregate error, so a reset can never silently
//     leave a credential behind,
//   - outside Tauri it is a no-op (no bridge, nothing to wipe).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

const isTauriMock = vi.fn(() => true);
vi.mock("../lib/tauri", () => ({ isTauri: () => isTauriMock() }));

import { KEYCHAIN_SERVICE } from "./KeychainSecretStore";
import { KEYCHAIN_WIPE_KEYS, wipeKeychainSecrets } from "./keychainWipe";

// The exact Rust allowlist (ALLOWED_SETTING_KEYS + ALLOWED_DEBRID_KEYS in
// src-tauri/src/keychain.rs). Duplicated here ON PURPOSE: if either side ever
// drifts from the TS mirror, this test fails and points at the contract.
const RUST_ALLOWLIST = [
  "tmdb_api_key",
  "omdb_api_key",
  "ai_api_key",
  "opensubtitles_api_key",
  "debrid.debrid-real_debrid",
  "debrid.debrid-all_debrid",
  "debrid.debrid-premiumize",
  "debrid.debrid-torbox",
];

beforeEach(() => {
  invoke.mockReset();
  invoke.mockResolvedValue(undefined);
  isTauriMock.mockReturnValue(true);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("keychainWipe", () => {
  it("mirrors the Rust keychain allowlist exactly", () => {
    expect([...KEYCHAIN_WIPE_KEYS]).toEqual(RUST_ALLOWLIST);
  });

  it("deletes every allowlisted key through keychain_delete", async () => {
    await wipeKeychainSecrets();
    const deleted = invoke.mock.calls
      .filter(([cmd]) => cmd === "keychain_delete")
      .map(([, args]) => (args as { key: string }).key);
    expect(deleted).toEqual(RUST_ALLOWLIST);
    for (const [, args] of invoke.mock.calls) {
      expect((args as { service: string }).service).toBe(KEYCHAIN_SERVICE);
    }
  });

  it("keeps sweeping after a per-key failure and surfaces it in the aggregate error", async () => {
    invoke.mockImplementation(async (_cmd?: string, args?: { key?: string }) => {
      if (args?.key === "ai_api_key") throw new Error("keychain locked");
    });
    await expect(wipeKeychainSecrets()).rejects.toThrow(
      /Keychain wipe incomplete: 1 of 8 secrets.*ai_api_key \(keychain locked\)/,
    );
    // The failure did not abort the sweep: all 8 keys were still attempted.
    expect(invoke.mock.calls.filter(([cmd]) => cmd === "keychain_delete")).toHaveLength(8);
  });

  it("aggregates multiple failures", async () => {
    invoke.mockImplementation(async (_cmd?: string, args?: { key?: string }) => {
      if (args?.key === "tmdb_api_key" || args?.key === "debrid.debrid-torbox") {
        throw new Error("denied");
      }
    });
    await expect(wipeKeychainSecrets()).rejects.toThrow(/2 of 8 secrets/);
  });

  it("is a no-op outside Tauri", async () => {
    isTauriMock.mockReturnValue(false);
    await wipeKeychainSecrets();
    expect(invoke).not.toHaveBeenCalled();
  });
});
