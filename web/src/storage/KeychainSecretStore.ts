// OS-keychain-backed SecretStore for the Tauri desktop build.
//
// Implements the same 3-method async SecretStore contract as DexieStore, but
// persists to the native OS keychain via the first-party Rust commands in
// src-tauri/src/keychain.rs (Apple Keychain / Windows Credential Manager /
// Secret Service). Selected over DexieStore inside getSecretStore() when
// isTauri() is true (see storage/index.ts).
//
// Mirrors the appFetch / lib/tauri.ts pattern: the @tauri-apps/api binding is
// loaded with a lazy, cached dynamic import() so the plain-browser bundle never
// resolves the Tauri runtime at module-eval time. Each method degrades to a
// provided fallback SecretStore (the Dexie instance) if the native invoke throws
// — exactly like appFetch falling back to the global fetch.

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

export class KeychainSecretStore implements SecretStore {
  /** Dexie (or any SecretStore) used if the native bridge is unavailable, and as
   *  the source for the one-time read-through migration in getSecret. */
  constructor(private readonly fallback: SecretStore) {}

  async getSecret(key: string): Promise<string | null> {
    try {
      const invoke = await loadInvoke();
      const value = await invoke<string | null>("keychain_get", {
        service: KEYCHAIN_SERVICE,
        key,
      });
      if (value != null) return value;

      // One-time read-through migration: a user upgrading from a build that
      // stored secrets in IndexedDB has them in `fallback` but not yet in the
      // keychain. Lift the value into the keychain on first read so we never
      // silently log them out, then keep serving from the keychain. Idempotent
      // (after the first read the keychain wins); the IndexedDB copy is left in
      // place so a downgrade or a keychain-write hiccup still has the data.
      const legacy = await this.fallback.getSecret(key);
      if (legacy != null) {
        await invoke<void>("keychain_set", {
          service: KEYCHAIN_SERVICE,
          key,
          value: legacy,
        });
        return legacy;
      }
      return null;
    } catch {
      return this.fallback.getSecret(key);
    }
  }

  async setSecret(key: string, value: string): Promise<void> {
    try {
      const invoke = await loadInvoke();
      await invoke<void>("keychain_set", {
        service: KEYCHAIN_SERVICE,
        key,
        value,
      });
    } catch {
      await this.fallback.setSecret(key, value);
    }
  }

  async deleteSecret(key: string): Promise<void> {
    try {
      const invoke = await loadInvoke();
      await invoke<void>("keychain_delete", {
        service: KEYCHAIN_SERVICE,
        key,
      });
    } catch {
      await this.fallback.deleteSecret(key);
    }
  }
}
