// Storage entry point — the singleton accessor the app uses.
//
// `getStore()` returns one process-wide DexieStore. IndexedDB is available in
// BOTH a plain browser and the Tauri webview, so the same instance backs web and
// desktop with no Rust/SQLite plugin.
//
// SECURITY NOTE: secrets (API keys, debrid tokens) currently live in IndexedDB
// via this same store (see DexieStore's SecretStore impl), NOT in an OS keychain.
// IndexedDB is origin-scoped but unencrypted at rest. A Tauri keychain plugin
// behind the `SecretStore` interface is the documented follow-up — because every
// credentialed call already goes through `SecretStore`, swapping the backend
// there is the only change needed to honor the native build's security model
// (keychain-backed, never synced to iCloud). Keep credentialed reads/writes
// routed through `SecretStore` so that swap stays a one-file change.

import { DexieStore } from "./DexieStore";
import type { SecretStore, Store } from "./types";

let instance: DexieStore | null = null;

/** The process-wide store singleton (works in browser + Tauri webview). */
export function getStore(): Store {
  return getDexieStore();
}

/** The same singleton as a SecretStore (the DexieStore implements both). */
export function getSecretStore(): SecretStore {
  return getDexieStore();
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
}

export { DexieStore } from "./DexieStore";
export type { Store, SecretStore } from "./types";
export * from "./models";
