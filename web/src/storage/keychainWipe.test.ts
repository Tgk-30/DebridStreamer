// keychainWipe unit tests. Mocks @tauri-apps/api/core's `invoke` and the Tauri
// detection (no Tauri runtime needed). Covers the factory-reset guarantees:
//   - every allowlisted key is deleted (nothing skipped, nothing extra),
//   - a per-key failure does NOT stop the sweep (remaining keys still deleted)
//     but IS surfaced in the aggregate error, so a reset can never silently
//     leave a credential behind,
//   - outside Tauri it is a no-op (no bridge, nothing to wipe).

import { readFileSync } from "node:fs";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

const isTauriMock = vi.fn(() => true);
vi.mock("../lib/tauri", () => ({ isTauri: () => isTauriMock() }));

import { KEYCHAIN_SERVICE } from "./KeychainSecretStore";
import { KEYCHAIN_WIPE_KEYS, wipeKeychainSecrets } from "./keychainWipe";

// The Rust keychain allowlist is the SINGLE SOURCE OF TRUTH for which secrets
// the app can store, and therefore for which secrets a factory reset must wipe.
// We parse it straight out of src-tauri/src/keychain.rs rather than hand-copying
// it: a future provider added on the Rust side but not mirrored into
// KEYCHAIN_WIPE_KEYS then fails THIS test in CI, instead of silently surviving a
// factory reset (a secret-remanence bug in a security-sensitive erase path).
// keychain.rs exposes no enumeration command, so this static parse is the only
// cross-check the TS side can make. Resolved from this test's own location so it
// works regardless of the process CWD.
const KEYCHAIN_RS_URL = new URL("../../src-tauri/src/keychain.rs", import.meta.url);

/** Extract the string literals from a `const NAME: &[&str] = &[ ... ];` Rust
 *  slice. Throws loudly if the constant is missing/renamed or parses to zero
 *  keys, so a restructure of keychain.rs can never make this cross-check pass
 *  vacuously (an empty allowlist would otherwise "match" an empty wipe list). */
function extractRustKeyArray(source: string, constName: string): string[] {
  const decl = new RegExp(
    `const\\s+${constName}\\s*:\\s*&\\[&str\\]\\s*=\\s*&\\[([\\s\\S]*?)\\]\\s*;`,
  ).exec(source);
  if (!decl) {
    throw new Error(
      `keychain.rs parse failed: could not find \`const ${constName}: &[&str] = &[...]\`. ` +
        `If it was renamed or restructured, update keychainWipe.ts AND this parser together.`,
    );
  }
  const keys = [...decl[1].matchAll(/"([^"]*)"/g)].map((m) => m[1]);
  if (keys.length === 0) {
    throw new Error(`keychain.rs parse failed: \`const ${constName}\` yielded zero keys.`);
  }
  return keys;
}

const rustSource = readFileSync(KEYCHAIN_RS_URL, "utf8");
// Union in source order (setting keys first, then debrid keys) - the same order
// KEYCHAIN_WIPE_KEYS is authored in, so the exact-equality checks below also
// pin the ordering, keeping the mirror trivially readable against the source.
const RUST_ALLOWLIST = [
  ...extractRustKeyArray(rustSource, "ALLOWED_SETTING_KEYS"),
  ...extractRustKeyArray(rustSource, "ALLOWED_DEBRID_KEYS"),
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
  it("is the exact union of the Rust allowlists parsed from keychain.rs (drift guard)", () => {
    // Fails CI if keychain.rs gains/loses/reorders an allowlisted key without a
    // matching edit to KEYCHAIN_WIPE_KEYS - the one thing that would let a
    // credential survive factory reset. Order is pinned too (source order).
    expect([...KEYCHAIN_WIPE_KEYS]).toEqual(RUST_ALLOWLIST);
    // Belt-and-suspenders: also assert as sets, so a genuine membership drift is
    // reported plainly even if someone later loosens the ordering contract.
    expect([...KEYCHAIN_WIPE_KEYS].sort()).toEqual([...RUST_ALLOWLIST].sort());
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
