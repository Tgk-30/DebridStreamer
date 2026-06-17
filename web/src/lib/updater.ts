// In-app auto-update check.
//
// Runs once on launch (from App.tsx). It is a deliberate no-op in a plain
// browser — the updater plugin only exists in the desktop Tauri shell — so it's
// guarded by `isTauri()` and never throws into the UI. When running under Tauri
// it asks the updater plugin whether a newer signed release is available
// (resolved from the `plugins.updater.endpoints` `latest.json` in
// tauri.conf.json) and, for now, just logs the result.
//
// Releases are signed with the updater keypair (public key in tauri.conf.json,
// private key + password supplied to CI as TAURI_SIGNING_PRIVATE_KEY /
// TAURI_SIGNING_PRIVATE_KEY_PASSWORD); the plugin verifies that signature
// before reporting an update, so an unsigned/forged `latest.json` is ignored.

import { isTauri } from "./tauri";

/** Check for an available desktop update. No-op (and never throws) in the
 * browser. Non-blocking: failures are swallowed with a console warning so a
 * flaky network or a missing release never degrades launch. */
export async function checkForUpdates(): Promise<void> {
  if (!isTauri()) return;

  try {
    // Imported dynamically so the browser bundle never resolves the Tauri
    // updater runtime at module-eval time (it's only present on the desktop).
    const { check } = await import("@tauri-apps/plugin-updater");
    const update = await check();

    if (update) {
      // eslint-disable-next-line no-console
      console.info(
        `[updater] Update available: ${update.version} (current ${update.currentVersion}).`,
        update.body ?? "",
      );
      // TODO: surface a non-blocking in-app prompt here ("Update available —
      // restart to install?"). On confirm, call `await update.downloadAndInstall()`
      // then `await relaunch()` from `@tauri-apps/plugin-process`. Left as a
      // console log this phase so launch stays non-interactive.
    } else {
      // eslint-disable-next-line no-console
      console.info("[updater] App is up to date.");
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("[updater] Update check failed (ignored):", err);
  }
}
