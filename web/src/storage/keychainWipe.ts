// Factory-reset keychain wipe.
//
// Deletes every allowlisted DebridStreamer secret from the OS keychain via the
// existing audited `keychain_delete` command (idempotent when the entry is
// already absent). This MUST run before the local databases are deleted during
// a factory reset: deleting the DBs also deletes the one-time keychain->local
// migration marker, so any surviving OS-keychain entry would be re-absorbed
// ("resurrected") by the migration on the next launch. Wiping the keychain
// first makes the reset stick.
//
// The key list mirrors the Rust allowlists in src-tauri/src/keychain.rs
// (ALLOWED_SETTING_KEYS + ALLOWED_DEBRID_KEYS). `keychain_delete` rejects any
// key outside that allowlist, so drift here fails loudly (a thrown error the
// caller surfaces) rather than silently leaving a credential behind.

import { isTauri } from "../lib/tauri";
import { KEYCHAIN_SERVICE } from "./KeychainSecretStore";

/** Every key the app has ever been allowed to store in the OS keychain. Mirrors
 *  ALLOWED_SETTING_KEYS + ALLOWED_DEBRID_KEYS in src-tauri/src/keychain.rs. */
export const KEYCHAIN_WIPE_KEYS: readonly string[] = [
  // ALLOWED_SETTING_KEYS
  "tmdb_api_key",
  "omdb_api_key",
  "ai_api_key",
  "opensubtitles_api_key",
  // ALLOWED_DEBRID_KEYS
  "debrid.debrid-real_debrid",
  "debrid.debrid-all_debrid",
  "debrid.debrid-premiumize",
  "debrid.debrid-torbox",
];

/** Delete every allowlisted secret from the OS keychain. No-op outside the
 *  Tauri desktop shell (a plain browser has no keychain bridge).
 *
 *  Attempts EVERY key even when one fails, then throws an aggregate error
 *  naming the keys that could not be deleted, so the caller can surface a
 *  "reset incomplete" state instead of silently leaving credentials behind. */
export async function wipeKeychainSecrets(): Promise<void> {
  if (!isTauri()) return;
  const { invoke } = await import("@tauri-apps/api/core");
  const failures: string[] = [];
  for (const key of KEYCHAIN_WIPE_KEYS) {
    try {
      await invoke<void>("keychain_delete", { service: KEYCHAIN_SERVICE, key });
    } catch (error) {
      failures.push(`${key} (${error instanceof Error ? error.message : String(error)})`);
    }
  }
  if (failures.length > 0) {
    throw new Error(
      `Keychain wipe incomplete: ${failures.length} of ${KEYCHAIN_WIPE_KEYS.length} secrets could not be deleted: ${failures.join("; ")}`,
    );
  }
}
