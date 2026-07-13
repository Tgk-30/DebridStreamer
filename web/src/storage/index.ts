// Storage entry point - the singleton accessor the app uses.
//
// `getStore()` returns one process-wide storage backend. Local Mode uses the
// Dexie/IndexedDB store in both a browser and the Tauri webview. Server Mode
// (opt-in via VITE_DEBRIDSTREAMER_SERVER_URL or saved server URL) uses a
// RemoteStore that talks to the self-hosted API.
//
// SECURITY NOTE: secrets (API keys, debrid tokens) are routed through the
// `SecretStore` interface so the backend can vary by environment:
//   - Server Mode -> RemoteStore (secret values are write-only from the browser;
//     the server owns encrypted credential storage).
//   - Browser AND Tauri desktop -> IndexedDB via DexieStore (origin-scoped,
//     unencrypted at rest - the documented local model). Desktop used the OS
//     keychain until v0.6, but macOS ACLs each keychain item to the creating
//     build's exact code signature, so ANY differently-signed build (dev
//     builds, ad-hoc test builds, cert changes between releases) made macOS
//     prompt for the login-keychain password - a hard product no ("the user
//     should not need to do this ever"). Existing keychain values are
//     auto-migrated out once (keychainMigration.ts); the Rust keychain_*
//     commands remain only to serve that migration.
// Keep credentialed reads/writes routed through `SecretStore` so the backend
// choice stays confined to this file.

import { DexieStore } from "./DexieStore";
import { RemoteStore } from "./RemoteStore";
import { migrateKeychainSecretsOnce } from "./keychainMigration";
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
 * The process-wide SecretStore. Local Mode (browser and desktop) stores secret
 * values in IndexedDB via DexieStore. Under Tauri the first store access also
 * runs the one-time keychain->local migration, and every operation AWAITS it -
 * so the first launch after updating can never race the migration and read a
 * "missing" key that is still sitting in the keychain.
 */
export function getSecretStore(): SecretStore {
  if (secretInstance == null) {
    const serverURL = configuredServerURL();
    if (serverURL != null) {
      secretInstance = getStore() as unknown as SecretStore;
      return secretInstance;
    }
    const dexie = getDexieStore();
    // The keychain->local migration only ever runs against the legacy default
    // database. A non-default profile's DB must NEVER re-read the OS keychain,
    // or it could absorb the household owner's secrets that survived the default
    // profile's drain. Non-default profiles use the raw Dexie secret store.
    secretInstance =
      isTauri() && dexie.name === "debridstreamer" ? new MigratedSecretStore(dexie) : dexie;
  }
  return secretInstance;
}

/** DexieStore secrets gated on the one-time keychain->local migration. */
class MigratedSecretStore implements SecretStore {
  private readonly ready: Promise<void>;

  constructor(private readonly dexie: DexieStore) {
    this.ready = migrateKeychainSecretsOnce(dexie).catch(() => {});
  }

  async getSecret(key: string): Promise<string | null> {
    await this.ready;
    return this.dexie.getSecret(key);
  }

  async setSecret(key: string, value: string): Promise<void> {
    await this.ready;
    return this.dexie.setSecret(key, value);
  }

  async deleteSecret(key: string): Promise<void> {
    await this.ready;
    return this.dexie.deleteSecret(key);
  }
}

function getDexieStore(): DexieStore {
  if (dexieInstance == null) {
    dexieInstance = new DexieStore();
  }
  return dexieInstance;
}

/** The currently selected Local Mode database, if one has been instantiated. */
export function currentDexieDbName(): string | null {
  return dexieInstance?.name ?? null;
}

/** Swap the process-wide Local Mode Store to a profile-specific database. */
export async function swapLocalProfileStore(dbName: string): Promise<void> {
  if (configuredServerURL() != null) {
    throw new Error("Local profile switching is unavailable in Server Mode");
  }
  if (dexieInstance?.name === dbName) return;
  if (dexieInstance != null) await dexieInstance.close();
  dexieInstance = new DexieStore(dbName);
  instance = dexieInstance;
  secretInstance = null;
  await dexieInstance.open();
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
