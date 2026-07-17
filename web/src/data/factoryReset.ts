// Complete device-local reset. Keychain removal intentionally precedes database
// deletion so the legacy keychain migration cannot restore erased credentials.

import Dexie from "dexie";
import { clearServerSession, readCsrfToken } from "../lib/serverSession";
import { configuredServerURL, saveServerURL } from "../lib/serverMode";
import { closeActiveLocalStore, currentDexieDbName } from "../storage";
import {
  closeProfileRegistry,
  dbNameForProfile,
  listProfiles,
} from "../storage/ProfileRegistry";
import { wipeKeychainSecrets } from "../storage/keychainWipe";

const DATABASE_PREFIX = "debridstreamer";
const DEFAULT_DATABASE = "debridstreamer";
const PROFILE_REGISTRY_DATABASE = "debridstreamer_profiles";
const LOCAL_STORAGE_PREFIX = "ds_";
// The settings store predates the ds_ convention and persists the whole
// settings blob (which, on web/PWA, is also where secret values may live)
// under this prefix - see STORAGE_KEY in data/settings.ts. A reset that left
// it behind would keep API keys on the device while claiming they were erased.
const LEGACY_LOCAL_STORAGE_PREFIX = "debridstreamer";

async function bestEffortServerSignOut(): Promise<void> {
  const serverURL = configuredServerURL();
  if (serverURL == null) return;
  const csrf = readCsrfToken();
  try {
    await fetch(`${serverURL}/api/auth/logout`, {
      method: "POST",
      credentials: "include",
      headers: csrf == null ? {} : { "x-csrf-token": csrf },
      // A server that accepts the connection but never responds must degrade
      // to the same best-effort path as an offline one, or the whole reset
      // stalls here before anything is wiped.
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    // Reset is still useful while the configured server is offline.
  }
  clearServerSession();
}

async function knownLocalDatabaseNames(): Promise<Set<string>> {
  const names = new Set<string>([
    DEFAULT_DATABASE,
    PROFILE_REGISTRY_DATABASE,
    currentDexieDbName() ?? DEFAULT_DATABASE,
  ]);
  try {
    for (const profile of await listProfiles()) names.add(dbNameForProfile(profile));
  } catch {
    // The default database is still a safe fallback if a damaged registry cannot
    // be read. A browser with indexedDB.databases() will use its full listing.
  }
  return names;
}

async function localDatabaseNames(): Promise<Set<string>> {
  const fallback = await knownLocalDatabaseNames();
  const databases = (globalThis.indexedDB as IDBFactory & {
    databases?: () => Promise<Array<{ name?: string }>>;
  }).databases;
  if (typeof databases !== "function") return fallback;
  try {
    const listed = await databases.call(globalThis.indexedDB);
    const names = new Set(
      listed
        .map((database) => database.name)
        .filter((name): name is string => name?.startsWith(DATABASE_PREFIX) === true),
    );
    // UNION with the known names, never replace: the spec allows databases()
    // to return an outdated snapshot, so a just-created per-profile DB could be
    // missing from the listing and silently survive the reset.
    for (const name of fallback) names.add(name);
    return names;
  } catch {
    return fallback;
  }
}

function removeDeviceLocalStorage(): void {
  for (let index = localStorage.length - 1; index >= 0; index -= 1) {
    const key = localStorage.key(index);
    if (
      key?.startsWith(LOCAL_STORAGE_PREFIX) === true ||
      key?.startsWith(LEGACY_LOCAL_STORAGE_PREFIX) === true
    ) {
      localStorage.removeItem(key);
    }
  }
  // This saved Server Mode endpoint is also device-local state, but predates the
  // ds_ key convention. An environment-provided endpoint is intentionally left.
  saveServerURL(null);
}

/** Erase every local database, preference, secret, and saved server session. */
export async function factoryReset(): Promise<void> {
  await bestEffortServerSignOut();

  // Do not move this after database deletion. See keychainWipe.ts for why.
  await wipeKeychainSecrets();

  const names = await localDatabaseNames();
  await closeActiveLocalStore();
  closeProfileRegistry();
  await Promise.all([...names].map((name) => Dexie.delete(name)));
  removeDeviceLocalStorage();
  window.location.reload();
}
