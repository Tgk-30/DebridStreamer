// Storage entry point — the singleton accessor the app uses.
//
// `getStore()` returns one process-wide DexieStore. IndexedDB is available in
// BOTH a plain browser and the Tauri webview, so the same instance backs web and
// desktop with no Rust/SQLite plugin.
//
// SECURITY NOTE: secrets (API keys, debrid tokens) are routed through the
// `SecretStore` interface so the backend can vary by environment:
//   - Tauri desktop -> the OS keychain (KeychainSecretStore -> Rust keychain_*
//     commands; Apple Keychain / Windows Credential Manager / Secret Service).
//   - Plain browser -> IndexedDB via DexieStore (origin-scoped, unencrypted at
//     rest — the documented web-build model).
// getSecretStore() below performs that selection (isTauri()). Only secret VALUES
// move to the keychain; the `secret:<key>` marker and all other data stay in
// Dexie. Keep credentialed reads/writes routed through `SecretStore` so the
// backend choice stays confined to this file.

import { DexieStore } from "./DexieStore";
import { KeychainSecretStore } from "./KeychainSecretStore";
import type { SecretStore, Store } from "./types";
import { isTauri } from "../lib/tauri";

let instance: DexieStore | null = null;
let secretInstance: SecretStore | null = null;

/** The process-wide store singleton (works in browser + Tauri webview). */
export function getStore(): Store {
  return getDexieStore();
}

/**
 * The process-wide SecretStore. Under Tauri, secrets live in the OS keychain
 * (KeychainSecretStore -> Rust keychain_* commands); in a plain browser they
 * stay in IndexedDB via the same DexieStore. The keychain store holds the Dexie
 * instance ONLY as the source for the one-time read-through migration of
 * pre-keychain secrets (and to purge that legacy copy) — it does NOT fall back to
 * plaintext IndexedDB on a keychain failure; keychain writes fail closed.
 *
 * Note: only secret VALUES move to the keychain. The `secret:<key>` marker and
 * all other settings/library data stay in Dexie, so getStore() is unconditional.
 */
export function getSecretStore(): SecretStore {
  if (secretInstance == null) {
    const dexie = getDexieStore();
    secretInstance = isTauri() ? new KeychainSecretStore(dexie) : dexie;
  }
  return secretInstance;
}

function getDexieStore(): DexieStore {
  if (instance == null) {
    instance = new DexieStore();
  }
  return instance;
}

/** Test/util hook: replace the singleton (e.g. to inject a named DB or reset). */
export function __setStoreForTesting(store: DexieStore | null): void {
  instance = store;
  // Reset the secret-store cache too, or a stale KeychainSecretStore/DexieStore
  // would leak across tests. Next getSecretStore() re-selects from isTauri().
  secretInstance = null;
}

export { DexieStore } from "./DexieStore";
export type { Store, SecretStore } from "./types";
export * from "./models";
