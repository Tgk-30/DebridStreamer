// Storage entry point — the singleton accessor the app uses.
//
// `getStore()` returns one process-wide storage backend. Local Mode uses the
// Dexie/IndexedDB store in both a browser and the Tauri webview. Server Mode
// (opt-in via VITE_DEBRIDSTREAMER_SERVER_URL or saved server URL) uses a
// RemoteStore that talks to the self-hosted API.
//
// SECURITY NOTE: secrets (API keys, debrid tokens) are routed through the
// `SecretStore` interface so the backend can vary by environment:
//   - Tauri desktop -> the OS keychain (KeychainSecretStore -> Rust keychain_*
//     commands; Apple Keychain / Windows Credential Manager / Secret Service).
//   - Server Mode -> RemoteStore (secret values are write-only from the browser;
//     the server owns encrypted credential storage).
//   - Plain browser -> IndexedDB via DexieStore (origin-scoped, unencrypted at
//     rest — the documented local web-build model).
// getSecretStore() below performs that selection (isTauri()). Only secret VALUES
// move to the keychain; the `secret:<key>` marker and all other data stay in
// Dexie. Keep credentialed reads/writes routed through `SecretStore` so the
// backend choice stays confined to this file.

import { DexieStore } from "./DexieStore";
import { KeychainSecretStore } from "./KeychainSecretStore";
import { RemoteStore } from "./RemoteStore";
import type { SecretStore, Store } from "./types";
import { isTauri } from "../lib/tauri";
import { configuredServerURL } from "../lib/serverMode";

let instance: Store | null = null;
let dexieInstance: DexieStore | null = null;
let secretInstance: SecretStore | null = null;

/** The process-wide store singleton (works in browser + Tauri webview). */
export function getStore(): Store {
  if (instance == null) {
    instance = createStore();
  }
  return instance;
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
    const serverURL = configuredServerURL();
    if (serverURL != null) {
      secretInstance = getStore() as unknown as SecretStore;
      return secretInstance;
    }
    const dexie = getDexieStore();
    secretInstance = isTauri() ? new KeychainSecretStore(dexie) : dexie;
  }
  return secretInstance;
}

function getDexieStore(): DexieStore {
  if (dexieInstance == null) {
    dexieInstance = new DexieStore();
  }
  return dexieInstance;
}

function createStore(): Store {
  const serverURL = configuredServerURL();
  if (serverURL != null) return new RemoteStore(serverURL);
  return getDexieStore();
}

/** Test/util hook: replace the singleton (e.g. to inject a named DB or reset). */
export function __setStoreForTesting(store: DexieStore | null): void {
  instance = store;
  dexieInstance = store;
  // Reset the secret-store cache too, or a stale KeychainSecretStore/DexieStore
  // would leak across tests. Next getSecretStore() re-selects from isTauri().
  secretInstance = null;
}

export { DexieStore } from "./DexieStore";
export type { Store, SecretStore } from "./types";
export * from "./models";
