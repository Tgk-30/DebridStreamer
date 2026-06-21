// Port of Sources/DebridStreamer/Services/Indexers/TorznabIndexer.swift.
//
// A generic Torznab/Jackett/Prowlarr XML-feed indexer. Mirrors the Swift actor:
// the same query params (t=search, imdbid/season/ep or q), category + apikey
// query handling, the X-Api-Key header mode for Prowlarr, non-2xx -> throw, and
// the Torznab feed parsing (title / magnet from guid|link|enclosure / size /
// torznab:attr seeders|peers|size|infohash|magneturl), with the infoHash
// fallback extracted from the magnet `xt=urn:btih:` parameter.
//
// Swift uses Foundation's event-driven `XMLParser`; there is no DOMParser in
// Node, so `parseTorznabFeed` below is a tiny hand-rolled tokenizer that
// reproduces the exact delegate event order/semantics.

import type { MediaType } from "../../models/media";
import { TorrentResult } from "./models";
import { defaultFetchImpl, type FetchImpl, IndexerError, type TorrentIndexer } from "./types";

export interface TorznabIndexerOptions {
  name: string;
  baseURL: string;
  endpointPath: string;
  apiKey?: string | null;
  categoryFilter?: string | null;
  sendAPIKeyAsHeader?: boolean;
  fetchImpl?: FetchImpl;
}

export class TorznabIndexer implements TorrentIndexer {
  readonly name: string;
  private readonly baseURL: string;
  private readonly endpointPath: string;
  private readonly apiKey: string | null;
  private readonly categoryFilter: string | null;
  private readonly sendAPIKeyAsHeader: boolean;
  private readonly fetchImpl: FetchImpl;

  constructor(options: TorznabIndexerOptions) {
    this.name = options.name;
    this.baseURL = options.baseURL;
    this.endpointPath = options.endpointPath;
    this.apiKey = options.apiKey ?? null;
    this.categoryFilter = options.categoryFilter ?? null;
    this.sendAPIKeyAsHeader = options.sendAPIKeyAsHeader ?? false;
    this.fetchImpl = options.fetchImpl ?? defaultFetchImpl;
  }

  async search(
    imdbId: string,
    _type: MediaType,
    season: number | null,
    episode: number | null,
  ): Promise<TorrentResult[]> {
    const params: Record<string, string> = {
      t: "search",
      imdbid: imdbId,
    };
    if (season != null) params.season = String(season);
    if (episode != null) params.ep = String(episode);
    return this.execute(params);
  }

  async searchByQuery(query: string, _type: MediaType): Promise<TorrentResult[]> {
    const params: Record<string, string> = {
      t: "search",
      q: query,
    };
    return this.execute(params);
  }

  private async execute(
    params: Record<string, string>,
  ): Promise<TorrentResult[]> {
    const { url, headers } = this.makeRequest(params);
    const response = await this.fetchImpl(url, headers ? { headers } : undefined);
    // Throw on non-2xx (consistent with the built-in indexers) so a
    // misconfigured endpoint / bad key surfaces as a recorded indexer failure
    // instead of an indistinguishable empty result. IndexerManager.searchAll
    // catches per-indexer, so this never aborts sibling indexers.
    if (!(response.status >= 200 && response.status <= 299)) {
      throw IndexerError.badServerResponse(response.status);
    }

    const items = parseTorznabFeed(await response.text());
    const results: TorrentResult[] = [];
    for (const item of items) {
      const hash = item.infoHash ?? extractInfoHash(item.magnetURL);
      if (hash == null || hash.length === 0) continue;
      results.push(
        TorrentResult.fromSearch({
          infoHash: hash,
          title: item.title,
          sizeBytes: item.size,
          seeders: item.seeders,
          leechers: item.peers,
          indexerName: this.name,
          magnetURI: item.magnetURL ?? null,
        }),
      );
    }
    return results;
  }

  /** Builds the request URL + optional header map. Mirrors Swift `makeRequest`,
   * incl. the `normalizedPath` join and the apikey-in-query vs X-Api-Key-header
   * split. Throws `IndexerError.badURL` when the base URL is unparseable. */
  private makeRequest(params: Record<string, string>): {
    url: string;
    headers: Record<string, string> | null;
  } {
    let url: URL;
    try {
      url = new URL(this.baseURL);
    } catch {
      throw IndexerError.badURL(this.baseURL);
    }

    if (this.endpointPath.length > 0) {
      url.pathname = normalizedPath(url.pathname, this.endpointPath);
    }

    for (const [k, v] of Object.entries(params)) {
      url.searchParams.append(k, v);
    }
    if (this.categoryFilter != null && this.categoryFilter.length > 0) {
      url.searchParams.append("cat", this.categoryFilter);
    }
    if (
      this.apiKey != null &&
      this.apiKey.length > 0 &&
      !this.sendAPIKeyAsHeader
    ) {
      url.searchParams.append("apikey", this.apiKey);
    }

    let headers: Record<string, string> | null = null;
    if (
      this.apiKey != null &&
      this.apiKey.length > 0 &&
      this.sendAPIKeyAsHeader
    ) {
      headers = { "X-Api-Key": this.apiKey };
    }

    return { url: url.toString(), headers };
  }
}

// MARK: - Path normalization (mirrors Swift `normalizedPath`)

/** Joins a base path with an endpoint, trimming slashes. Mirrors the Swift
 * `normalizedPath`. The DOM `URL` reports an empty path as "/", so the empty
 * base path is treated the same as Swift's empty string. */
function normalizedPath(currentPath: string, endpoint: string): string {
  const current = trimSlashes(currentPath);
  const append = trimSlashes(endpoint);
  if (current.length === 0) {
    return `/${append}`;
  }
  if (append.length === 0) {
    return `/${current}`;
  }
  return `/${current}/${append}`;
}

function trimSlashes(s: string): string {
  return s.replace(/^\/+/, "").replace(/\/+$/, "");
}

// MARK: - Magnet infoHash extraction (mirrors Swift `extractInfoHash`)

/** Pulls the btih hash out of a magnet URI's `xt=urn:btih:<hash>` param.
 * Mirrors Swift `extractInfoHash`. */
function extractInfoHash(magnetURL: string | null | undefined): string | null {
  if (magnetURL == null) return null;
  let components: URL;
  try {
    components = new URL(magnetURL);
  } catch {
    return null;
  }
  let xt: string | null = null;
  for (const [name, value] of components.searchParams) {
    if (name.toLowerCase() === "xt") {
      xt = value;
      break;
    }
  }
  if (xt == null) return null;
  const prefix = "urn:btih:";
  if (!xt.toLowerCase().startsWith(prefix)) return null;
  return xt.slice(prefix.length);
}

// MARK: - Torznab feed parser

interface TorznabFeedItem {
  title: string;
  magnetURL: string | null;
  infoHash: string | null;
  size: number;
  seeders: number;
  peers: number;
}

interface MutableItem {
  title: string;
  magnetURL: string | null;
  infoHash: string | null;
  size: number;
  seeders: number;
  peers: number;
}

/**
 * Parses a Torznab/RSS feed into items. Reproduces the exact event semantics of
 * the Swift `TorznabXMLDelegate`:
 *  - start `<item>` opens a fresh accumulator (and resets text);
 *  - `<enclosure url="...">` and `<torznab:attr name=.. value=..>` are read at
 *    start-element time (seeders/peers/size/infohash/magneturl);
 *  - text content is captured and, at end-element, applied to title /
 *    guid|link (magnet:? only) / size; `</item>` finalizes the item.
 */
export function parseTorznabFeed(xml: string): TorznabFeedItem[] {
  const items: TorznabFeedItem[] = [];
  let current: MutableItem | null = null;
  let currentText = "";

  const onStart = (
    name: string,
    attrs: Record<string, string>,
  ): void => {
    const element = name.toLowerCase();
    currentText = "";

    if (element === "item") {
      current = {
        title: "",
        magnetURL: null,
        infoHash: null,
        size: 0,
        seeders: 0,
        peers: 0,
      };
      return;
    }

    if (current == null) return;

    if (element === "enclosure" && attrs.url != null) {
      current.magnetURL = attrs.url;
    } else if (element === "torznab:attr") {
      const attrName = (attrs.name ?? "").toLowerCase();
      const value = attrs.value ?? "";
      switch (attrName) {
        case "seeders": {
          const n = Number.parseInt(value, 10);
          current.seeders = Number.isNaN(n) ? current.seeders : n;
          break;
        }
        case "peers": {
          const n = Number.parseInt(value, 10);
          current.peers = Number.isNaN(n) ? current.peers : n;
          break;
        }
        case "size": {
          const n = Number.parseInt(value, 10);
          current.size = Number.isNaN(n) ? current.size : n;
          break;
        }
        case "infohash":
          current.infoHash = value;
          break;
        case "magneturl":
          current.magnetURL = value;
          break;
        default:
          break;
      }
    }
  };

  const onEnd = (name: string): void => {
    const element = name.toLowerCase();
    if (current == null) return;
    const value = currentText.trim();

    switch (element) {
      case "title":
        current.title = value;
        break;
      case "guid":
      case "link":
        if (value.toLowerCase().startsWith("magnet:?")) {
          current.magnetURL = value;
        }
        break;
      case "size": {
        const n = Number.parseInt(value, 10);
        current.size = Number.isNaN(n) ? current.size : n;
        break;
      }
      case "item": {
        const title = current.title.length === 0 ? "Unknown" : current.title;
        items.push({
          title,
          magnetURL: current.magnetURL,
          infoHash: current.infoHash,
          size: current.size,
          seeders: current.seeders,
          peers: current.peers,
        });
        current = null;
        break;
      }
      default:
        break;
    }
  };

  tokenizeXML(xml, onStart, onEnd, (text) => {
    currentText += text;
  });

  return items;
}

// MARK: - Minimal streaming XML tokenizer

/**
 * A tiny SAX-style scanner: emits start-element (with parsed attributes),
 * end-element, and character events in document order. Handles self-closing
 * tags (emitting start then end), skips the XML declaration / comments / CDATA
 * boundaries, and decodes the common XML entities. This is deliberately small —
 * just enough to drive `parseTorznabFeed` the way Foundation's XMLParser drives
 * the Swift delegate.
 */
function tokenizeXML(
  xml: string,
  onStart: (name: string, attrs: Record<string, string>) => void,
  onEnd: (name: string) => void,
  onText: (text: string) => void,
): void {
  let i = 0;
  const n = xml.length;

  while (i < n) {
    const lt = xml.indexOf("<", i);
    if (lt === -1) {
      if (i < n) onText(decodeEntities(xml.slice(i)));
      break;
    }
    if (lt > i) {
      onText(decodeEntities(xml.slice(i, lt)));
    }

    // Declaration / processing instruction / comment / DOCTYPE / CDATA.
    if (xml.startsWith("<?", lt)) {
      const close = xml.indexOf("?>", lt);
      i = close === -1 ? n : close + 2;
      continue;
    }
    if (xml.startsWith("<!--", lt)) {
      const close = xml.indexOf("-->", lt);
      i = close === -1 ? n : close + 3;
      continue;
    }
    if (xml.startsWith("<![CDATA[", lt)) {
      const close = xml.indexOf("]]>", lt);
      const inner = xml.slice(lt + 9, close === -1 ? n : close);
      onText(inner); // CDATA is literal — no entity decoding.
      i = close === -1 ? n : close + 3;
      continue;
    }
    if (xml.startsWith("<!", lt)) {
      const close = xml.indexOf(">", lt);
      i = close === -1 ? n : close + 1;
      continue;
    }

    const gt = xml.indexOf(">", lt);
    if (gt === -1) {
      // Malformed trailing "<...": treat the rest as text.
      onText(decodeEntities(xml.slice(lt)));
      break;
    }

    let raw = xml.slice(lt + 1, gt);
    i = gt + 1;

    if (raw.startsWith("/")) {
      // End tag.
      const name = raw.slice(1).trim().split(/\s+/)[0];
      if (name.length > 0) onEnd(name);
      continue;
    }

    const selfClosing = raw.endsWith("/");
    if (selfClosing) raw = raw.slice(0, -1);

    const { name, attrs } = parseTag(raw);
    if (name.length === 0) continue;
    onStart(name, attrs);
    if (selfClosing) onEnd(name);
  }
}

/** Splits a tag body "name attr=\"v\" ..." into a name + attribute map. */
function parseTag(raw: string): { name: string; attrs: Record<string, string> } {
  const trimmed = raw.trim();
  const nameMatch = /^([^\s/>]+)/.exec(trimmed);
  if (nameMatch == null) return { name: "", attrs: {} };
  const name = nameMatch[1];
  const attrs: Record<string, string> = {};

  const attrRe = /([^\s=/]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
  let m: RegExpExecArray | null;
  attrRe.lastIndex = nameMatch[0].length;
  while ((m = attrRe.exec(trimmed)) != null) {
    const key = m[1];
    const value = m[3] != null ? m[3] : (m[4] ?? "");
    attrs[key] = decodeEntities(value);
  }
  return { name, attrs };
}

/** Decodes the handful of XML entities that appear in feed text/attrs. */
function decodeEntities(s: string): string {
  if (!s.includes("&")) return s;
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h: string) =>
      String.fromCodePoint(Number.parseInt(h, 16)),
    )
    .replace(/&amp;/g, "&");
}
