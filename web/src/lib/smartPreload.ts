// Smart preloading — a per-device performance preference (NOT synced to server
// profiles, since preloading is inherently device/connection-specific).
//
// When on (the default), the app does invisible background work the user never
// notices but benefits from: warming the lazy Detail/Browse code chunks while
// idle, and preloading upcoming hero backdrops so the carousel never flashes.
// Data-conscious users (metered connections) can turn it off in Settings.

const KEY = "ds_smart_preload";

/** Default ON — most users are on unmetered connections and want it snappy. */
export function isSmartPreloadEnabled(): boolean {
  try {
    return globalThis.localStorage?.getItem(KEY) !== "0";
  } catch {
    return true;
  }
}

export function setSmartPreloadEnabled(enabled: boolean): void {
  try {
    globalThis.localStorage?.setItem(KEY, enabled ? "1" : "0");
  } catch {
    // private mode — preference just won't persist
  }
}

/** Run a callback when the browser is idle (falls back to a short timeout). */
export function whenIdle(fn: () => void): void {
  const ric = (
    globalThis as typeof globalThis & {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
    }
  ).requestIdleCallback;
  if (typeof ric === "function") {
    ric(fn, { timeout: 2500 });
  } else {
    setTimeout(fn, 1200);
  }
}
