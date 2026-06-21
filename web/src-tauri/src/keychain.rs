// OS-keychain SecretStore backend (Tauri side).
//
// Three first-party commands that mirror the TS `SecretStore` contract
// (getSecret / setSecret / deleteSecret). Backed by the `keyring` crate:
//   macOS   -> Apple Keychain Services      (feature "apple-native")
//   Windows -> Windows Credential Manager    (feature "windows-native")
//   Linux   -> Secret Service over D-Bus     (feature "sync-secret-service")
//
// Items are generic passwords keyed by (service, account) = (SERVICE, key),
// where `key` is the namespaced string the web layer already uses (e.g.
// "tmdb_api_key", "debrid.debrid-real_debrid"). The `secret:<key>` marker
// indirection stays in the Dexie KV store on the JS side; only the resolved
// secret value lives here.
//
// Errors surface to JS as a rejected promise carrying the String message,
// matching the player.rs convention. A missing entry is NOT an error:
// keychain_get returns Ok(None); keychain_delete is idempotent (Ok(())).

use keyring::{Entry, Error as KeyringError};

const KEYCHAIN_SERVICE: &str = "com.tgk30.debridstreamer";
const ALLOWED_SETTING_KEYS: &[&str] = &[
    "tmdb_api_key",
    "omdb_api_key",
    "ai_api_key",
    "opensubtitles_api_key",
];
const ALLOWED_DEBRID_KEYS: &[&str] = &[
    "debrid.debrid-real_debrid",
    "debrid.debrid-all_debrid",
    "debrid.debrid-premiumize",
    "debrid.debrid-torbox",
];

fn validate_keychain_args(service: &str, key: &str) -> Result<(), String> {
    if service != KEYCHAIN_SERVICE {
        return Err("Unsupported keychain service.".to_string());
    }
    if ALLOWED_SETTING_KEYS.contains(&key) || ALLOWED_DEBRID_KEYS.contains(&key) {
        return Ok(());
    }
    Err("Unsupported keychain key.".to_string())
}

/// Read a secret. Returns `Ok(None)` when no entry exists for (service, key).
#[tauri::command]
pub fn keychain_get(service: String, key: String) -> Result<Option<String>, String> {
    validate_keychain_args(&service, &key)?;
    let entry = Entry::new(&service, &key).map_err(|e| e.to_string())?;
    match entry.get_password() {
        Ok(secret) => Ok(Some(secret)),
        Err(KeyringError::NoEntry) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

/// Store (or overwrite) a secret for (service, key).
#[tauri::command]
pub fn keychain_set(service: String, key: String, value: String) -> Result<(), String> {
    validate_keychain_args(&service, &key)?;
    let entry = Entry::new(&service, &key).map_err(|e| e.to_string())?;
    entry.set_password(&value).map_err(|e| e.to_string())
}

/// Delete a secret. "Not found" is treated as success (idempotent).
#[tauri::command]
pub fn keychain_delete(service: String, key: String) -> Result<(), String> {
    validate_keychain_args(&service, &key)?;
    let entry = Entry::new(&service, &key).map_err(|e| e.to_string())?;
    match entry.delete_credential() {
        Ok(()) => Ok(()),
        Err(KeyringError::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}
