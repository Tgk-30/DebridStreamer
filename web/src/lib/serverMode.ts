const SERVER_URL_STORAGE_KEY = "debridstreamer.server.url";
const SERVER_FOLLOW_STORAGE_KEY = "debridstreamer.server.follow";

declare global {
  var __DEBRIDSTREAMER_SERVER_URL__: string | null | undefined;
  var __DEBRIDSTREAMER_SERVER_MODE_ENV__: Record<string, string> | undefined;
}

function envValue(key: string): string {
  const env =
    (globalThis as { __DEBRIDSTREAMER_SERVER_MODE_ENV__?: Record<string, string> })
      .__DEBRIDSTREAMER_SERVER_MODE_ENV__ ??
    (import.meta as ImportMeta & { env?: Record<string, string> }).env;
  return env?.[key]?.trim() ?? "";
}

function normalizeBaseURL(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed === "/") return "";
  return trimmed.replace(/\/+$/, "");
}

export function configuredServerURL(): string | null {
  const explicit = envValue("VITE_DEBRIDSTREAMER_SERVER_URL");
  if (explicit.length > 0) return normalizeBaseURL(explicit);

  const injected = globalThis.__DEBRIDSTREAMER_SERVER_URL__?.trim();
  if (injected != null && injected.length > 0) return normalizeBaseURL(injected);

  try {
    const stored = globalThis.localStorage?.getItem(SERVER_URL_STORAGE_KEY);
    if (stored != null && stored.trim().length > 0) {
      return normalizeBaseURL(stored);
    }
  } catch {
    // Ignore private-mode/localStorage failures and stay in Local Mode.
  }

  return null;
}

export function configuredServerURLSource(): "env" | "same-origin" | "saved" | null {
  const explicit = envValue("VITE_DEBRIDSTREAMER_SERVER_URL");
  if (explicit.length > 0) return "env";

  const injected = globalThis.__DEBRIDSTREAMER_SERVER_URL__?.trim();
  if (injected != null && injected.length > 0) return "same-origin";

  try {
    const stored = globalThis.localStorage?.getItem(SERVER_URL_STORAGE_KEY);
    if (stored != null && stored.trim().length > 0) return "saved";
  } catch {
    // Ignore private-mode/localStorage failures and report Local Mode.
  }

  return null;
}

export function isServerMode(): boolean {
  return configuredServerURL() != null;
}

export function saveServerURL(url: string | null, options?: { follow?: boolean }): void {
  try {
    if (url == null || url.trim().length === 0) {
      globalThis.localStorage?.removeItem(SERVER_URL_STORAGE_KEY);
      globalThis.localStorage?.removeItem(SERVER_FOLLOW_STORAGE_KEY);
    } else {
      globalThis.localStorage?.setItem(SERVER_URL_STORAGE_KEY, normalizeBaseURL(url));
      if (options?.follow === true) {
        globalThis.localStorage?.setItem(SERVER_FOLLOW_STORAGE_KEY, "1");
      } else if (options?.follow === false) {
        globalThis.localStorage?.removeItem(SERVER_FOLLOW_STORAGE_KEY);
      }
    }
  } catch {
    // Non-fatal; callers can still use the current in-memory session.
  }
}

/** The URL a first-run "Connect to a server" handed the window to, when the
 * user chose that flow. Boot follows it once so the app reopens ON the server
 * instead of asking for the address again. Distinct from the Settings API-mode
 * connection, which must stay on the current origin. */
export function followServerURL(): string | null {
  try {
    if (globalThis.localStorage?.getItem(SERVER_FOLLOW_STORAGE_KEY) !== "1") {
      return null;
    }
    const stored = globalThis.localStorage?.getItem(SERVER_URL_STORAGE_KEY);
    if (stored != null && stored.trim().length > 0) {
      return normalizeBaseURL(stored);
    }
  } catch {
    // Ignore private-mode/localStorage failures and boot normally.
  }
  return null;
}
