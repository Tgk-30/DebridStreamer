const SERVER_URL_STORAGE_KEY = "debridstreamer.server.url";

declare global {
  var __DEBRIDSTREAMER_SERVER_URL__: string | null | undefined;
}

function envValue(key: string): string {
  const env = (import.meta as ImportMeta & { env?: Record<string, string> }).env;
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

export function saveServerURL(url: string | null): void {
  try {
    if (url == null || url.trim().length === 0) {
      globalThis.localStorage?.removeItem(SERVER_URL_STORAGE_KEY);
    } else {
      globalThis.localStorage?.setItem(SERVER_URL_STORAGE_KEY, normalizeBaseURL(url));
    }
  } catch {
    // Non-fatal; callers can still use the current in-memory session.
  }
}
