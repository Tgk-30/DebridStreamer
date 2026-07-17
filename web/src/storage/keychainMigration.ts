// One-time migration OUT of the OS keychain into the local secret store.
//
// WHY: on macOS, a login-keychain item is ACL'd to the exact code signature of
// the app that created it. Any differently-signed build - every dev build, an
// ad-hoc-signed test build, a cert change between releases - makes macOS prompt
// for the login-keychain password for EVERY stored key. There is no keychain
// arrangement that makes those prompts structurally impossible, and the product
// decision is that the user must never see them. The browser/PWA build already
// stores these same keys in IndexedDB, so desktop now uses that same documented
// local model (origin-scoped, unencrypted at rest) on every platform.
//
// This migration lifts each existing keychain value into the local store and
// then deletes the keychain copy (move, not copy). It runs ONCE: a cancelled
// prompt or denied read marks that key as skipped - the user re-enters it via
// the normal Settings flow - and the migration is never retried, so the OS can
// never prompt again on later launches.

import type { DexieStore } from "./DexieStore";
import { KEYCHAIN_SERVICE } from "./KeychainSecretStore";

const MIGRATION_FLAG = "keychain_migrated_to_local_v1";

/** Every key the Rust keychain commands ever accepted (keychain.rs ALLOWED_*). */
const KEYCHAIN_KEYS = [
  "tmdb_api_key",
  "omdb_api_key",
  "ai_api_key",
  "opensubtitles_api_key",
  "debrid.debrid-real_debrid",
  "debrid.debrid-all_debrid",
  "debrid.debrid-premiumize",
  "debrid.debrid-torbox",
] as const;

/** Migrate all keychain secrets into `dexie`, once per install. Safe to call on
 * every launch: after the first run (or in a plain browser) it's a no-op. */
export async function migrateKeychainSecretsOnce(dexie: DexieStore): Promise<void> {
  try {
    if ((await dexie.getSetting(MIGRATION_FLAG)) != null) return;
  } catch {
    return; // storage unavailable - retry next launch
  }

  let invoke: (<T>(cmd: string, args?: Record<string, unknown>) => Promise<T>) | null =
    null;
  try {
    invoke = (await import("@tauri-apps/api/core")).invoke;
  } catch {
    return; // not under Tauri - nothing to migrate, don't burn the flag
  }

  for (const key of KEYCHAIN_KEYS) {
    try {
      const value = await invoke<string | null>("keychain_get", {
        service: KEYCHAIN_SERVICE,
        key,
      });
      if (value != null && value.length > 0) {
        await dexie.setSecret(key, value);
        // Move semantics: purge the keychain copy so nothing lingers. Reads
        // just succeeded in this session, so the delete won't re-prompt; if it
        // fails anyway the orphaned item is inert (nothing reads it again).
        try {
          await invoke("keychain_delete", { service: KEYCHAIN_SERVICE, key });
        } catch {
          /* best-effort */
        }
      }
    } catch {
      // Denied / cancelled prompt / backend down: skip this key. The user
      // re-enters it in Settings; never retry, so the OS never prompts again.
    }
  }

  try {
    await dexie.setSetting(MIGRATION_FLAG, "true");
  } catch {
    /* worst case: one more attempt next launch */
  }
}
