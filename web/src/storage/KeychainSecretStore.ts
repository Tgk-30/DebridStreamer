// OS-keychain-backed SecretStore for the Tauri desktop build.
//
// Implements the same 3-method async SecretStore contract as DexieStore, but
// persists to the native OS keychain via the first-party Rust commands in
// src-tauri/src/keychain.rs (Apple Keychain / Windows Credential Manager /
// Secret Service). Selected over DexieStore inside getSecretStore() when
// isTauri() is true (see storage/index.ts) — so this class is ONLY ever
// constructed on a real desktop build where the Tauri bridge is present.
//
// Security posture (this is the whole point of the keychain backend):
//   - WRITES fail CLOSED. If a keychain set/delete fails (locked/denied keychain,
//     Secret Service down, etc.) the error PROPAGATES. We never silently persist
//     a credential as plaintext in IndexedDB as a "fallback" — that would defeat
//     the keychain entirely precisely in the failure modes that matter.
//   - READS degrade to null (+ a one-time warning) on a keychain error rather
//     than rejecting (which would break settings hydration) or reading the
//     plaintext legacy copy. A genuine keychain MISS (Ok(None)) is different: it
//     triggers the one-time migration below.
//
// Migration (move, not copy): a user upgrading from a pre-keychain build has
// secrets in IndexedDB. On the first keychain miss for a key we lift its legacy
// value into the keychain and DELETE the IndexedDB copy, so (a) upgrading users
// aren't logged out, (b) no plaintext copy lingers at rest, and (c) a later
// delete can't be resurrected by re-reading a leftover plaintext copy.
//
// The @tauri-apps/api binding is loaded with a lazy, cached dynamic import()
// (mirroring lib/tauri.ts) so the plain-browser bundle never resolves the Tauri
// runtime at module-eval time.

import type { SecretStore } from "./types";

/** Keychain service/namespace for all DebridStreamer secrets. Bundle-id style so
 *  items survive product renames and the macOS Keychain ACL stays stably keyed. */
export const KEYCHAIN_SERVICE = "com.tgk30.debridstreamer";

type InvokeFn = <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;

let cachedInvoke: InvokeFn | null = null;

async function loadInvoke(): Promise<InvokeFn> {
  if (cachedInvoke != null) return cachedInvoke;
  const mod = await import("@tauri-apps/api/core");
  cachedInvoke = mod.invoke as InvokeFn;
  return cachedInvoke;
}

/** True once any secret READ failed this session (locked keychain, denied,
 *  backend down). Consumers that would treat "no key" as actionable — like the
 *  forced key-onboarding gate — must stand down when this is set: the keys may
 *  exist but be unreadable, and forcing re-entry would mislead (and any re-save
 *  would fail against the same broken keychain anyway). */
let readFailures = 0;
export function secretReadsFailedThisSession(): boolean {
  return readFailures > 0;
}
export function __resetSecretReadFailuresForTesting(): void {
  readFailures = 0;
}

/** Warn at most once per (op, key) so a persistently locked keychain doesn't spam
 *  the console. Only the key NAME (not a secret value) is logged. */
const warned = new Set<string>();
function warnKeychain(op: string, key: string, err: unknown): void {
  if (op === "read" || op === "init") readFailures += 1;
  const id = `${op}:${key}`;
  if (warned.has(id)) return;
  warned.add(id);
  // eslint-disable-next-line no-console
  console.warn(
    `[KeychainSecretStore] keychain ${op} failed for "${key}" — the secret is ` +
      `unavailable this session and was NOT stored in plaintext.`,
    err,
  );
}

export class KeychainSecretStore implements SecretStore {
  /** Dexie store, used ONLY as the migration source (reading a pre-keychain
   *  plaintext secret) and to purge that legacy copy — never as a write target
   *  on keychain failure. */
  constructor(private readonly fallback: SecretStore) {}

  async getSecret(key: string): Promise<string | null> {
    let invoke: InvokeFn;
    try {
      invoke = await loadInvoke();
    } catch (err) {
      // No Tauri bridge on a build that somehow constructed this class. Fail safe
      // (no plaintext) and don't break hydration.
      warnKeychain("init", key, err);
      return null;
    }

    let current: string | null;
    try {
      current = await invoke<string | null>("keychain_get", {
        service: KEYCHAIN_SERVICE,
        key,
      });
    } catch (err) {
      // Keychain READ failed (locked / denied / backend down). Treat as
      // unavailable this session — do NOT reject (breaks hydration) and do NOT
      // read the plaintext legacy copy.
      warnKeychain("read", key, err);
      return null;
    }
    if (current != null) return current;

    // Genuine keychain miss → one-time migration of any pre-keychain plaintext
    // copy. Read the legacy value defensively (a Dexie hiccup must not throw).
    let legacy: string | null = null;
    try {
      legacy = await this.fallback.getSecret(key);
    } catch {
      legacy = null;
    }
    if (legacy == null) return null;

    try {
      await invoke<void>("keychain_set", {
        service: KEYCHAIN_SERVICE,
        key,
        value: legacy,
      });
      await this.purgeLegacy(key); // move, not copy
    } catch (err) {
      // Migration write failed; serve the legacy value this session and retry the
      // move on a later read. No NEW plaintext copy is created.
      warnKeychain("migrate", key, err);
    }
    return legacy;
  }

  async setSecret(key: string, value: string): Promise<void> {
    // Fail CLOSED: a keychain write failure propagates — we never silently
    // persist the secret as plaintext in IndexedDB.
    const invoke = await loadInvoke();
    await invoke<void>("keychain_set", {
      service: KEYCHAIN_SERVICE,
      key,
      value,
    });
    // Remove any pre-keychain plaintext copy so it can't resurrect / linger.
    await this.purgeLegacy(key);
  }

  async deleteSecret(key: string): Promise<void> {
    // Fail CLOSED on the keychain delete itself.
    const invoke = await loadInvoke();
    await invoke<void>("keychain_delete", {
      service: KEYCHAIN_SERVICE,
      key,
    });
    // Also purge any legacy plaintext copy — otherwise the read-through migration
    // would resurrect the deleted secret on the next get.
    await this.purgeLegacy(key);
  }

  /** Best-effort removal of a pre-keychain plaintext copy. A failure here leaves
   *  the legacy copy (pre-existing state) and must NOT fail the primary keychain
   *  operation that already succeeded. */
  private async purgeLegacy(key: string): Promise<void> {
    try {
      await this.fallback.deleteSecret(key);
    } catch {
      /* best-effort */
    }
  }
}
