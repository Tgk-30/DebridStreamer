// The single auditable network gate for DebridStreamer's privacy modes.
//
// There is no central fetch chokepoint in this app: TMDB/OMDb use raw fetch,
// the player opens debrid CDN URLs directly, the updater goes through a Tauri
// plugin, posters load via <img>. So privacy cannot be enforced in one place by
// construction. Instead EVERY outbound surface classifies its own traffic into
// a NetworkCategory and asks this module whether the CURRENT mode permits it.
// This file is the one place to read to know exactly what each mode allows.
//
// Modes:
//   standard  - normal operation, everything allowed (default).
//   fullLocal - privacy first: only the essentials needed to find and stream
//               media (metadata, ratings, debrid, indexers, subtitles) plus a
//               LOCAL AI endpoint. No app updates, no external AI, no trailers,
//               no anything else. "Won't connect to anything but the basics."
//   offline   - fully offline: nothing leaves the device to the internet. Serve
//               metadata from the local cache and play already-downloaded files.
//               On-device endpoints (loopback: local AI, a local companion
//               server) stay reachable because they never touch the internet.

export type NetworkMode = "standard" | "fullLocal" | "offline";

const NETWORK_MODES: readonly NetworkMode[] = ["standard", "fullLocal", "offline"];

type NetworkCategory =
  | "metadata" // TMDB catalog/detail (api.themoviedb.org)
  | "images" // TMDB artwork (image.tmdb.org) loaded via <img>
  | "ratings" // OMDb (omdbapi.com)
  | "debrid" // debrid provider APIs (resolve/unrestrict)
  | "streaming" // opening/downloading the resolved remote stream URL
  | "indexers" // torrent search (built-in + user Jackett/Prowlarr/etc)
  | "subtitles" // OpenSubtitles
  | "aiExternal" // hosted AI providers (Anthropic/OpenAI/Gemini/...)
  | "aiLocal" // on-device AI (Ollama on loopback)
  | "updates" // Tauri app updater
  | "trailer" // YouTube trailer embed
  | "telemetry" // usage/crash reporting (none exists today; gated defensively)
  | "server" // the user's own companion server (self-hosted, often loopback/LAN)
  | "misc"; // anything unclassified - denied by default in the privacy modes

// The matrix. Explicit true/false per (mode, category) so an auditor can read
// the whole privacy contract at a glance. "true" means the mode PERMITS that
// category of outbound traffic.
const MATRIX: Record<NetworkMode, Record<NetworkCategory, boolean>> = {
  standard: {
    metadata: true, images: true, ratings: true, debrid: true, streaming: true,
    indexers: true, subtitles: true, aiExternal: true, aiLocal: true,
    updates: true, trailer: true, telemetry: true, server: true, misc: true,
  },
  fullLocal: {
    metadata: true, images: true, ratings: true, debrid: true, streaming: true,
    indexers: true, subtitles: true, aiLocal: true, server: true,
    // Blocked: no hosted AI, no update checks, no trailers, no telemetry, and
    // nothing unclassified.
    aiExternal: false, updates: false, trailer: false, telemetry: false, misc: false,
  },
  offline: {
    // On-device only. Loopback AI and a local companion server never reach the
    // internet, so they stay allowed; everything that leaves the device does not.
    aiLocal: true, server: true,
    metadata: false, images: false, ratings: false, debrid: false, streaming: false,
    indexers: false, subtitles: false, aiExternal: false, updates: false,
    trailer: false, telemetry: false, misc: false,
  },
};

let currentMode: NetworkMode = "standard";

/** Set the active mode. Called from the app store when settings load or change. */
export function setNetworkMode(mode: NetworkMode): void {
  currentMode = NETWORK_MODES.includes(mode) ? mode : "standard";
}

export function getNetworkMode(): NetworkMode {
  return currentMode;
}

/** Whether the current mode permits this category of outbound traffic. */
export function isNetworkAllowed(category: NetworkCategory, mode: NetworkMode = currentMode): boolean {
  return MATRIX[mode][category] === true;
}

/** Raised when a blocked outbound call is attempted. Callers catch this to show
 *  a calm "unavailable in this privacy mode" state instead of a network error. */
export class NetworkBlockedError extends Error {
  readonly category: NetworkCategory;
  readonly mode: NetworkMode;
  constructor(category: NetworkCategory, mode: NetworkMode, context?: string) {
    super(
      `Blocked ${category} request in ${mode} mode${context ? ` (${context})` : ""}`,
    );
    this.name = "NetworkBlockedError";
    this.category = category;
    this.mode = mode;
  }
}

/** Throw if the current mode forbids this category. Use at each outbound surface. */
export function assertNetworkAllowed(category: NetworkCategory, context?: string): void {
  if (!isNetworkAllowed(category)) {
    throw new NetworkBlockedError(category, currentMode, context);
  }
}

// Host -> category classification for the appFetch backstop, so even a call that
// forgot its explicit assert is still gated by hostname. A LOOPBACK host is
// always on-device (never the internet), so it is exempt from classification and
// allowed in every mode (Ollama, a local server). Anything not matched here is
// "misc", which the privacy modes deny by default.
const HOST_CATEGORY: Array<[RegExp, NetworkCategory]> = [
  [/(^|\.)themoviedb\.org$/i, "metadata"],
  [/(^|\.)tmdb\.org$/i, "images"],
  [/(^|\.)omdbapi\.com$/i, "ratings"],
  [/(^|\.)real-debrid\.com$/i, "debrid"],
  [/(^|\.)alldebrid\.com$/i, "debrid"],
  [/(^|\.)premiumize\.me$/i, "debrid"],
  [/(^|\.)torbox\.app$/i, "debrid"],
  [/(^|\.)strem\.fun$/i, "indexers"],
  [/(^|\.)apibay\.org$/i, "indexers"],
  [/(^|\.)yts\.mx$/i, "indexers"],
  [/(^|\.)eztv\.(wf|to|re)$/i, "indexers"],
  [/(^|\.)opensubtitles\.com$/i, "subtitles"],
  [/(^|\.)anthropic\.com$/i, "aiExternal"],
  [/(^|\.)openai\.com$/i, "aiExternal"],
  [/(^|\.)googleapis\.com$/i, "aiExternal"],
  [/(^|\.)openrouter\.ai$/i, "aiExternal"],
  [/(^|\.)groq\.com$/i, "aiExternal"],
  [/(^|\.)mistral\.ai$/i, "aiExternal"],
  [/(^|\.)deepseek\.com$/i, "aiExternal"],
  [/(^|\.)x\.ai$/i, "aiExternal"],
  [/(^|\.)trakt\.tv$/i, "misc"],
  [/(^|\.)youtube(-nocookie)?\.com$/i, "trailer"],
  [/(^|\.)github\.com$/i, "updates"],
];

const LOOPBACK = /^(localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0)$/i;

/** Classify a URL into a category. Returns null for on-device loopback hosts
 *  (always allowed). Unrecognized internet hosts classify as "misc". */
export function categoryForUrl(url: string): NetworkCategory | null {
  let host: string;
  try {
    // Parse as an ABSOLUTE URL. Do NOT supply a loopback base: that would make
    // an unparseable/relative URL resolve to "localhost" and be treated as
    // always-allowed on-device traffic. A malformed URL denies by default.
    host = new URL(url).hostname;
  } catch {
    return "misc";
  }
  if (LOOPBACK.test(host)) return null; // on-device, never gated
  for (const [pattern, category] of HOST_CATEGORY) {
    if (pattern.test(host)) return category;
  }
  return "misc";
}

/** True if a fully-qualified URL is permitted right now (loopback always is). */
export function isUrlAllowed(url: string): boolean {
  const category = categoryForUrl(url);
  return category == null || isNetworkAllowed(category);
}

/** A request is exempt from the gate when it targets an on-device loopback host
 *  (Ollama, a local companion server). Loopback is never "the internet", so it
 *  stays reachable in every mode, including Offline. This module stays free of a
 *  serverMode dependency; the configured (LAN/tailnet) companion server host is
 *  exempted separately inside appFetch, which already knows that URL. */
export function isRequestExempt(url: string): boolean {
  return categoryForUrl(url) === null; // loopback / on-device
}
