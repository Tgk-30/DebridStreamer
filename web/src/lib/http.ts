// Cross-environment HTTP for the ported services.
//
// The indexer/debrid/AI/sync services all take an injectable `fetchImpl` of the
// shape `(url, init?: { method?, headers?, body? }) => Promise<{ status, text() }>`
// (a subset of the DOM `fetch`). In a plain browser, the global `fetch` is the
// right implementation — but indexer/debrid/addon hosts are third-party origins
// that don't send CORS headers, so a browser request to them is blocked.
//
// Inside the Tauri desktop webview we route those requests through the Rust side
// via `@tauri-apps/plugin-http`'s `fetch`, which performs the request natively
// (no CORS preflight, no same-origin policy) and returns a standard `Response`.
// That `Response` already exposes `status` + `text()`, so adapting it to the
// services' `FetchImpl` shape is a thin pass-through.
//
// `appFetch` degrades to the global `fetch` whenever we're NOT under Tauri, so
// the same call site works in both the browser (`npm run dev`) and the desktop
// build. TMDB/OMDB are CORS-friendly and work on either path.

import { isTauri } from "./tauri";

/** The superset fetch signature the ported services inject. It is structurally
 * assignable to each service module's local `FetchImpl` (indexers accept only
 * `{ headers }`; debrid/AI/sync also accept `method`/`body`). */
export type FetchImpl = (
  url: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  },
) => Promise<{
  status: number;
  text(): Promise<string>;
}>;

/** The Tauri plugin's `fetch`, loaded lazily so the browser bundle never tries
 * to resolve the Tauri runtime at module-eval time (it's only present in the
 * desktop webview). Cached after the first successful import. */
type TauriFetch = (
  input: string,
  init?: RequestInit,
) => Promise<Response>;
let cachedTauriFetch: TauriFetch | null = null;

async function loadTauriFetch(): Promise<TauriFetch> {
  if (cachedTauriFetch != null) return cachedTauriFetch;
  const mod = await import("@tauri-apps/plugin-http");
  cachedTauriFetch = mod.fetch as TauriFetch;
  return cachedTauriFetch;
}

/** A CORS-free fetch for the ported services.
 *
 * Under Tauri it dynamically imports the plugin's `fetch` (which proxies through
 * Rust); everywhere else it uses the global `fetch`. The returned `Response` in
 * both cases satisfies the services' `{ status, text() }` contract directly, so
 * no body-buffering adapter is needed. If the dynamic import ever fails (e.g. a
 * misbuilt desktop bundle), we fall back to the global `fetch` rather than throw
 * so the service still attempts the request. */
export const appFetch: FetchImpl = async (url, init) => {
  const requestInit = init as RequestInit | undefined;
  if (isTauri()) {
    try {
      const tauriFetch = await loadTauriFetch();
      return await tauriFetch(url, requestInit);
    } catch {
      // Plugin unavailable — degrade to the global fetch (which may CORS-fail,
      // but that's the same behavior as a non-Tauri browser).
      return fetch(url, requestInit);
    }
  }
  return fetch(url, requestInit);
};
