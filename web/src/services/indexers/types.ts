// Port of the indexer protocol + config value types:
//  - TorrentIndexer protocol (Sources/.../Services/Indexers/TorrentIndexer.swift)
//  - IndexerConfig + IndexerType + ProviderSubtype (Models/DebridConfig.swift)
//  - IndexerError: a typed Error class with a `kind` discriminator, mirroring
//    the implicit URLError(.badServerResponse)/URLError(.badURL) failures the
//    Swift indexers throw (so non-2xx surfaces as a recorded indexer failure).

import type { MediaType } from "../../models/media";
import type { TorrentResult } from "./models";

// MARK: - TorrentIndexer

/**
 * A torrent indexer/scraper. Mirrors the Swift `TorrentIndexer` protocol.
 * `searchByQuery` has a default empty implementation in Swift via a protocol
 * extension; here each concrete indexer provides its own (and IndexerManager
 * tolerates a missing one by treating it as returning []).
 */
export interface TorrentIndexer {
  /** A human-readable name for this indexer. */
  readonly name: string;

  /** Search for torrents matching an IMDB ID. */
  search(
    imdbId: string,
    type: MediaType,
    season: number | null,
    episode: number | null,
  ): Promise<TorrentResult[]>;

  /** Search for torrents by text query (fallback when no IMDB ID). */
  searchByQuery(query: string, type: MediaType): Promise<TorrentResult[]>;
}

// MARK: - IndexerError

/**
 * Error kinds an indexer (or the factory) can throw. Mirrors the Swift
 * `URLError` cases the indexers raise: a non-2xx response throws
 * `badServerResponse`, an unbuildable URL throws `badURL`, and an unparseable
 * feed throws `cannotParseResponse`.
 */
export type IndexerErrorKind =
  | "badServerResponse"
  | "badURL"
  | "cannotParseResponse";

export class IndexerError extends Error {
  readonly kind: IndexerErrorKind;
  /** HTTP status code, present for `badServerResponse`. */
  readonly statusCode?: number;

  private constructor(
    kind: IndexerErrorKind,
    message: string,
    statusCode?: number,
  ) {
    super(message);
    this.name = "IndexerError";
    this.kind = kind;
    this.statusCode = statusCode;
  }

  static badServerResponse(statusCode?: number): IndexerError {
    const suffix = statusCode != null ? ` (HTTP ${statusCode})` : "";
    return new IndexerError(
      "badServerResponse",
      `Bad server response${suffix}`,
      statusCode,
    );
  }
  static badURL(url: string): IndexerError {
    return new IndexerError("badURL", `Bad URL: ${url}`);
  }
  static cannotParseResponse(): IndexerError {
    return new IndexerError("cannotParseResponse", "Cannot parse response");
  }
}

// MARK: - IndexerConfig (the subset the factory consumes)

/** Indexer kind. Mirrors `IndexerConfig.IndexerType`. */
export type IndexerType =
  | "jackett"
  | "prowlarr"
  | "torznab"
  | "zilean"
  | "stremio_addon"
  | "built_in";

export const IndexerType = {
  jackett: "jackett" as IndexerType,
  prowlarr: "prowlarr" as IndexerType,
  torznab: "torznab" as IndexerType,
  zilean: "zilean" as IndexerType,
  stremioAddon: "stremio_addon" as IndexerType,
  builtIn: "built_in" as IndexerType,

  displayName(type: IndexerType): string {
    switch (type) {
      case "jackett":
        return "Jackett";
      case "prowlarr":
        return "Prowlarr";
      case "torznab":
        return "Torznab";
      case "zilean":
        return "Zilean";
      case "stremio_addon":
        return "Stremio Addon";
      case "built_in":
        return "Built-in Scrapers";
    }
  },

  /** Mirrors `IndexerType.defaultProviderSubtype`. */
  defaultProviderSubtype(type: IndexerType): ProviderSubtype {
    switch (type) {
      case "jackett":
        return ProviderSubtype.jackett;
      case "prowlarr":
        return ProviderSubtype.prowlarr;
      case "torznab":
      case "zilean":
        return ProviderSubtype.customTorznab;
      case "stremio_addon":
        return ProviderSubtype.stremioAddon;
      case "built_in":
        return ProviderSubtype.builtIn;
    }
  },

  /** Mirrors `IndexerType.defaultEndpointPath`. */
  defaultEndpointPath(type: IndexerType): string {
    switch (type) {
      case "jackett":
        return "/api/v2.0/indexers/all/results/torznab/api";
      case "prowlarr":
        return "/api/v1/search";
      case "torznab":
      case "zilean":
        return "/api";
      case "stremio_addon":
      case "built_in":
        return "";
    }
  },
} as const;

/** Provider subtype. Mirrors `IndexerConfig.ProviderSubtype`. */
export type ProviderSubtype =
  | "jackett"
  | "prowlarr"
  | "custom_torznab"
  | "stremio_addon"
  | "built_in";

export const ProviderSubtype = {
  jackett: "jackett" as ProviderSubtype,
  prowlarr: "prowlarr" as ProviderSubtype,
  customTorznab: "custom_torznab" as ProviderSubtype,
  stremioAddon: "stremio_addon" as ProviderSubtype,
  builtIn: "built_in" as ProviderSubtype,
} as const;

/**
 * Indexer configuration. Mirrors `IndexerConfig`, with `providerSubtype` and
 * `endpointPath` defaulted from `type` (as the Swift memberwise init does).
 */
export interface IndexerConfig {
  id: string;
  type: IndexerType;
  baseURL: string;
  apiKey?: string | null;
  isActive: boolean;
  displayName?: string | null;
  providerSubtype: ProviderSubtype;
  endpointPath: string;
  categoryFilter?: string | null;
  priority: number;
}

/** Mirrors the Swift memberwise `IndexerConfig.init` defaults. */
export function makeIndexerConfig(partial: {
  id: string;
  type: IndexerType;
  baseURL: string;
  apiKey?: string | null;
  isActive?: boolean;
  displayName?: string | null;
  providerSubtype?: ProviderSubtype | null;
  endpointPath?: string | null;
  categoryFilter?: string | null;
  priority?: number;
}): IndexerConfig {
  return {
    id: partial.id,
    type: partial.type,
    baseURL: partial.baseURL,
    apiKey: partial.apiKey ?? null,
    isActive: partial.isActive ?? true,
    displayName: partial.displayName ?? null,
    providerSubtype:
      partial.providerSubtype ?? IndexerType.defaultProviderSubtype(partial.type),
    endpointPath:
      partial.endpointPath ?? IndexerType.defaultEndpointPath(partial.type),
    categoryFilter: partial.categoryFilter ?? null,
    priority: partial.priority ?? 0,
  };
}

// MARK: - HTTP

/**
 * Injectable fetch signature (a subset of the DOM `fetch`), mirroring the
 * template's `FetchImpl`. The Swift indexers inject a `URLSession`; here tests
 * inject this to stub the network. The optional `init.headers` carries the
 * Torznab `X-Api-Key` header. The response exposes `status` plus `text()`
 * (JSON bodies) — XML bodies are also read via `text()`.
 */
export type FetchImpl = (
  url: string,
  init?: { headers?: Record<string, string> },
) => Promise<{
  status: number;
  text(): Promise<string>;
}>;

/** Default fetch that delegates to the global `fetch`. */
export const defaultFetchImpl: FetchImpl = (url, init) =>
  fetch(url, init as RequestInit);
