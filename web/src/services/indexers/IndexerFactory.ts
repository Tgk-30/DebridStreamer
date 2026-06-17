// Port of Sources/DebridStreamer/Services/Indexers/IndexerFactory.swift.
//
// Builds the active indexer set from a list of IndexerConfigs (built-in
// APIBay/YTS/EZTV when enabled, plus priority-sorted external Torznab indexers)
// and validates an external endpoint via `testConnection` (2xx + a positive
// Torznab/RSS feed without an `<error>` envelope).

import { APIBayIndexer } from "./APIBayIndexer";
import { EZTVIndexer } from "./EZTVIndexer";
import {
  defaultFetchImpl,
  type FetchImpl,
  type IndexerConfig,
  ProviderSubtype,
  type TorrentIndexer,
} from "./types";
import { TorznabIndexer } from "./TorznabIndexer";
import { YTSIndexer } from "./YTSIndexer";

export const IndexerFactory = {
  /** Builds the active indexer list. Built-in scrapers come first (enabled
   * unless a `built_in` config is explicitly inactive), then active external
   * indexers sorted by ascending priority. Mirrors `buildIndexers`. */
  buildIndexers(
    configs: IndexerConfig[],
    fetchImpl: FetchImpl = defaultFetchImpl,
  ): TorrentIndexer[] {
    const result: TorrentIndexer[] = [];

    const builtInConfig = configs.find((c) => c.type === "built_in");
    const builtInEnabled = builtInConfig?.isActive ?? true;
    if (builtInEnabled) {
      result.push(new APIBayIndexer(fetchImpl));
      result.push(new YTSIndexer(fetchImpl));
      result.push(new EZTVIndexer(fetchImpl));
    }

    const activeExternal = configs
      .filter((c) => c.isActive && c.type !== "built_in")
      .sort((a, b) => a.priority - b.priority);

    for (const config of activeExternal) {
      const indexer = makeExternalIndexer(config, fetchImpl);
      if (indexer == null) continue;
      result.push(indexer);
    }

    return result;
  },

  /** Validates an external indexer endpoint. Built-in always passes; otherwise
   * requires 2xx AND a positive Torznab/RSS feed (no `<error>` envelope).
   * Mirrors `testConnection`. */
  async testConnection(
    config: IndexerConfig,
    fetchImpl: FetchImpl = defaultFetchImpl,
  ): Promise<boolean> {
    if (config.type === "built_in") {
      // Built-in indexers have no user-configured endpoint to validate.
      return true;
    }

    const probe = makeTorznabProbeRequest(config);
    if (probe == null) return false;

    try {
      const response = await fetchImpl(
        probe.url,
        probe.headers ? { headers: probe.headers } : undefined,
      );
      if (!(response.status >= 200 && response.status <= 299)) {
        return false;
      }
      return isPositiveTorznabResponse(await response.text());
    } catch {
      return false;
    }
  },
} as const;

/** Builds a minimal Torznab search probe (url + optional headers).
 * Mirrors `makeTorznabProbeRequest`. */
function makeTorznabProbeRequest(
  config: IndexerConfig,
): { url: string; headers: Record<string, string> | null } | null {
  let url: URL;
  try {
    url = new URL(config.baseURL);
  } catch {
    return null;
  }

  if (config.endpointPath.length > 0) {
    const current = trimSlashes(url.pathname);
    const append = trimSlashes(config.endpointPath);
    if (current.length === 0) {
      url.pathname = `/${append}`;
    } else if (append.length === 0) {
      url.pathname = `/${current}`;
    } else {
      url.pathname = `/${current}/${append}`;
    }
  }

  const sendAPIKeyAsHeader = config.providerSubtype === ProviderSubtype.prowlarr;
  url.searchParams.append("t", "search");
  url.searchParams.append("q", "test");
  if (config.categoryFilter != null && config.categoryFilter.length > 0) {
    url.searchParams.append("cat", config.categoryFilter);
  }
  if (
    config.apiKey != null &&
    config.apiKey.length > 0 &&
    !sendAPIKeyAsHeader
  ) {
    url.searchParams.append("apikey", config.apiKey);
  }

  let headers: Record<string, string> | null = null;
  if (
    config.apiKey != null &&
    config.apiKey.length > 0 &&
    sendAPIKeyAsHeader
  ) {
    headers = { "X-Api-Key": config.apiKey };
  }

  return { url: url.toString(), headers };
}

/** True only when the body looks like a valid Torznab/RSS feed and is not a
 * Torznab error envelope (`<error code=... />`). Mirrors
 * `isPositiveTorznabResponse`. */
function isPositiveTorznabResponse(body: string): boolean {
  const lower = body.toLowerCase();
  // A Torznab error envelope is a negative signal even with HTTP 200.
  if (lower.includes("<error")) {
    return false;
  }
  // Require a recognizable feed root; a valid empty feed still passes.
  return lower.includes("<rss") || lower.includes("<?xml");
}

/** Builds an external (Torznab-family) indexer from a config, or null for
 * built-in. Mirrors `makeExternalIndexer`. */
function makeExternalIndexer(
  config: IndexerConfig,
  fetchImpl: FetchImpl,
): TorrentIndexer | null {
  switch (config.type) {
    case "jackett":
    case "prowlarr":
    case "torznab":
    case "zilean": {
      const displayName = config.displayName?.trim();
      const name =
        displayName != null && displayName.length > 0
          ? displayName
          : indexerTypeDisplayName(config.type);
      const sendAPIKeyAsHeader =
        config.providerSubtype === ProviderSubtype.prowlarr;
      return new TorznabIndexer({
        name,
        baseURL: config.baseURL,
        endpointPath: config.endpointPath,
        apiKey: config.apiKey,
        categoryFilter: config.categoryFilter,
        sendAPIKeyAsHeader,
        fetchImpl,
      });
    }
    case "built_in":
      return null;
  }
}

function indexerTypeDisplayName(type: IndexerConfig["type"]): string {
  switch (type) {
    case "jackett":
      return "Jackett";
    case "prowlarr":
      return "Prowlarr";
    case "torznab":
      return "Torznab";
    case "zilean":
      return "Zilean";
    case "built_in":
      return "Built-in Scrapers";
  }
}

function trimSlashes(s: string): string {
  return s.replace(/^\/+/, "").replace(/\/+$/, "");
}
