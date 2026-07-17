// Mirrors the Swift indexer tests:
//  - Tests/.../Services/Indexers/BuiltInIndexerTests.swift
//      (APIBay/YTS/EZTV non-2xx -> throw, 200-but-empty -> [], APIBay anchored
//       SxxEyy filter)
//  - Tests/.../Services/Indexers/TorznabIndexerTests.swift
//      (Torznab XML parse, X-Api-Key header mode, non-2xx throw,
//       IndexerFactory.testConnection)
//  - Tests/.../Services/Indexers/IndexerManagerTests.swift
//      (dedup keep-higher-seeders, quality-then-seeders sort, lastSearchErrors)
//
// The Swift tests stub the network with a per-session MockURLProtocol handler.
// Here we inject a `FetchImpl` stub playing the same role: it captures the last
// URL + headers and counts calls. The canned JSON/XML bodies reuse the exact
// shapes from the Swift test files.

import { describe, expect, it } from "vitest";
import { APIBayIndexer } from "./APIBayIndexer";
import { EZTVIndexer } from "./EZTVIndexer";
import { IndexerFactory } from "./IndexerFactory";
import { IndexerManager } from "./IndexerManager";
import {
  AudioFormat as AF,
  SourceType as ST,
  TorrentResult,
  VideoCodec as VC,
  type VideoQuality,
  VideoQuality as VQ,
} from "./models";
import { parseTorznabFeed, TorznabIndexer } from "./TorznabIndexer";
import { YTSIndexer } from "./YTSIndexer";
import {
  type FetchImpl,
  makeIndexerConfig,
  type TorrentIndexer,
} from "./types";

// MARK: - fetch stub (mirrors MockURLProtocol + makeMockSession)

interface MockResponse {
  status: number;
  body: string;
}

interface MockFetch {
  fetchImpl: FetchImpl;
  lastURL: () => URL | null;
  lastHeaders: () => Record<string, string> | undefined;
  hits: () => number;
}

function makeMockFetch(
  handler: (url: URL, hit: number) => MockResponse,
): MockFetch {
  let count = 0;
  let captured: URL | null = null;
  let capturedHeaders: Record<string, string> | undefined;
  const fetchImpl: FetchImpl = async (url, init) => {
    count += 1;
    const parsed = new URL(url);
    captured = parsed;
    capturedHeaders = init?.headers;
    const { status, body } = handler(parsed, count);
    return { status, text: async () => body };
  };
  return {
    fetchImpl,
    lastURL: () => captured,
    lastHeaders: () => capturedHeaders,
    hits: () => count,
  };
}

const ok = (body: string): MockResponse => ({ status: 200, body });

// ============================================================================
// Built-in indexers (BuiltInIndexerTests)
// ============================================================================

describe("APIBayIndexer", () => {
  it("throws on a non-2xx response", async () => {
    const mock = makeMockFetch(() => ({ status: 503, body: "[]" }));
    const indexer = new APIBayIndexer(mock.fetchImpl);
    await expect(
      indexer.searchByQuery("anything", "movie"),
    ).rejects.toMatchObject({ kind: "badServerResponse" });
  });

  it("returns [] for the no-results sentinel with HTTP 200", async () => {
    const body = JSON.stringify([
      {
        id: "0",
        name: "No results returned",
        info_hash: "0000000000000000000000000000000000000000",
        leechers: "0",
        seeders: "0",
        num_files: "0",
        size: "0",
        username: "",
        added: "0",
        status: "",
        category: "0",
        imdb: "",
      },
    ]);
    const mock = makeMockFetch(() => ok(body));
    const indexer = new APIBayIndexer(mock.fetchImpl);
    const results = await indexer.searchByQuery("nothing", "movie");
    expect(results).toEqual([]);
  });

  it("anchored SxxEyy filter rejects non-contiguous matches and accepts dot-separated forms", async () => {
    const body = JSON.stringify([
      {
        id: "1",
        name: "Show.S01E05.x264-E01TUREL",
        info_hash: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
        leechers: "1",
        seeders: "10",
        size: "100",
        category: "208",
        imdb: "tt1",
      },
      {
        id: "2",
        name: "Show.S01.E01.1080p.WEB",
        info_hash: "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
        leechers: "1",
        seeders: "20",
        size: "200",
        category: "208",
        imdb: "tt1",
      },
    ]);
    const mock = makeMockFetch(() => ok(body));
    const indexer = new APIBayIndexer(mock.fetchImpl);

    const results = await indexer.search("tt1", "series", 1, 1);

    expect(results.length).toBe(1);
    expect(results[0]?.title).toBe("Show.S01.E01.1080p.WEB");
  });

  it("uses the HD movie category and IMDB query on search", async () => {
    const mock = makeMockFetch(() => ok("[]"));
    const indexer = new APIBayIndexer(mock.fetchImpl);
    await indexer.search("tt1234567", "movie", null, null);
    const url = mock.lastURL()!;
    expect(url.pathname).toBe("/q.php");
    expect(["tt1234567", "1234567"]).toContain(url.searchParams.get("q"));
    expect(url.searchParams.get("cat")).toBe("200"); // final fallback category
    expect(mock.hits()).toBe(6);
  });

  it("lowercases the infoHash and skips dead torrents (0 seeders)", async () => {
    const body = JSON.stringify([
      {
        id: "1",
        name: "Movie.2024.1080p.BluRay.x264",
        info_hash: "ABCDEF1234567890ABCDEF1234567890ABCDEF12",
        leechers: "2",
        seeders: "55",
        size: "2000000000",
      },
      {
        id: "2",
        name: "Dead.Torrent.720p",
        info_hash: "1111111111111111111111111111111111111111",
        leechers: "0",
        seeders: "0",
        size: "5",
      },
    ]);
    const mock = makeMockFetch(() => ok(body));
    const indexer = new APIBayIndexer(mock.fetchImpl);
    const results = await indexer.searchByQuery("movie", "movie");

    expect(results.length).toBe(1);
    expect(results[0]?.infoHash).toBe("abcdef1234567890abcdef1234567890abcdef12");
    expect(results[0]?.sizeBytes).toBe(2_000_000_000);
    expect(results[0]?.quality).toBe(VQ.hd1080p);
    expect(results[0]?.indexerName).toBe("APIBay");
  });
});

describe("YTSIndexer", () => {
  it("throws on a non-2xx response", async () => {
    const mock = makeMockFetch(() => ({ status: 500, body: "{}" }));
    const indexer = new YTSIndexer(mock.fetchImpl);
    await expect(
      indexer.searchByQuery("anything", "movie"),
    ).rejects.toMatchObject({ kind: "badServerResponse" });
  });

  it("returns [] for an empty movies list with HTTP 200", async () => {
    const body = JSON.stringify({
      status: "ok",
      data: { movie_count: 0, movies: [] },
    });
    const mock = makeMockFetch(() => ok(body));
    const indexer = new YTSIndexer(mock.fetchImpl);
    const results = await indexer.searchByQuery("nothing", "movie");
    expect(results).toEqual([]);
  });

  it("returns [] for series (movies-only indexer) without hitting the network", async () => {
    const mock = makeMockFetch(() => ok("{}"));
    const indexer = new YTSIndexer(mock.fetchImpl);
    const results = await indexer.search("tt1", "series", null, null);
    expect(results).toEqual([]);
    expect(mock.hits()).toBe(0);
  });

  it("composes the title from title_long + quality + type and reads size_bytes", async () => {
    const body = JSON.stringify({
      status: "ok",
      data: {
        movie_count: 1,
        movies: [
          {
            id: 10,
            title: "Interstellar",
            title_long: "Interstellar (2014)",
            year: 2014,
            imdb_code: "tt0816692",
            torrents: [
              {
                hash: "CAFEBABECAFEBABECAFEBABECAFEBABECAFEBABE",
                quality: "1080p",
                type: "bluray",
                seeds: 120,
                peers: 7,
                size: "2.1 GB",
                size_bytes: 2_254_857_830,
              },
            ],
          },
        ],
      },
    });
    const mock = makeMockFetch(() => ok(body));
    const indexer = new YTSIndexer(mock.fetchImpl);
    const results = await indexer.search("tt0816692", "movie", null, null);

    expect(results.length).toBe(1);
    expect(results[0]?.title).toBe("Interstellar (2014) [1080p] [bluray]");
    expect(results[0]?.sizeBytes).toBe(2_254_857_830);
    expect(results[0]?.seeders).toBe(120);
    expect(results[0]?.leechers).toBe(7);
    expect(results[0]?.infoHash).toBe(
      "cafebabecafebabecafebabecafebabecafebabe",
    );
    expect(results[0]?.quality).toBe(VQ.hd1080p);
    expect(results[0]?.source).toBe("BluRay");
    expect(results[0]?.indexerName).toBe("YTS");
  });
});

describe("EZTVIndexer", () => {
  it("throws on a non-2xx response", async () => {
    const mock = makeMockFetch(() => ({ status: 502, body: "{}" }));
    const indexer = new EZTVIndexer(mock.fetchImpl);
    await expect(
      indexer.searchByQuery("anything", "series"),
    ).rejects.toMatchObject({ kind: "badServerResponse" });
  });

  it("returns [] for an empty torrents list with HTTP 200", async () => {
    const body = JSON.stringify({
      torrents_count: 0,
      page: 1,
      torrents: [],
    });
    const mock = makeMockFetch(() => ok(body));
    const indexer = new EZTVIndexer(mock.fetchImpl);
    const results = await indexer.searchByQuery("nothing", "series");
    expect(results).toEqual([]);
  });

  it("returns [] for movies (series-only indexer) without hitting the network", async () => {
    const mock = makeMockFetch(() => ok("{}"));
    const indexer = new EZTVIndexer(mock.fetchImpl);
    const results = await indexer.search("tt1", "movie", null, null);
    expect(results).toEqual([]);
    expect(mock.hits()).toBe(0);
  });

  it("strips the tt prefix, decodes torrents, and filters by season/episode", async () => {
    const body = JSON.stringify({
      torrents_count: 2,
      page: 1,
      torrents: [
        {
          id: 1,
          hash: "DEADBEEFDEADBEEFDEADBEEFDEADBEEFDEADBEEF0",
          filename: "Show.S01E01.720p.HDTV.x264",
          title: "Show S01E01 720p HDTV x264",
          season: "1",
          episode: "1",
          seeds: 30,
          peers: 4,
          size_bytes: "500000000",
          magnet_url: "magnet:?xt=urn:btih:DEADBEEF",
        },
        {
          id: 2,
          hash: "FEEDFACEFEEDFACEFEEDFACEFEEDFACEFEEDFACE0",
          filename: "Show.S01E02.720p.HDTV.x264",
          title: "Show S01E02 720p HDTV x264",
          season: "1",
          episode: "2",
          seeds: 22,
          peers: 1,
          size_bytes: "510000000",
          magnet_url: "magnet:?xt=urn:btih:FEEDFACE",
        },
      ],
    });
    const mock = makeMockFetch(() => ok(body));
    const indexer = new EZTVIndexer(mock.fetchImpl);

    const results = await indexer.search("tt1234567", "series", 1, 1);

    // Only S01E01 survives the season/episode filter.
    expect(results.length).toBe(1);
    expect(results[0]?.infoHash).toBe(
      "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef0",
    );
    expect(results[0]?.sizeBytes).toBe(500_000_000);
    expect(results[0]?.magnetURI).toBe("magnet:?xt=urn:btih:DEADBEEF");
    expect(results[0]?.indexerName).toBe("EZTV");

    // The numeric id is passed without the "tt".
    expect(mock.lastURL()!.searchParams.get("imdb_id")).toBe("1234567");
  });
});

// ============================================================================
// Torznab indexer + factory (TorznabIndexerTests)
// ============================================================================

const torznabFeedXML = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:torznab="http://torznab.com/schemas/2015/feed">
  <channel>
    <item>
      <title>Example.Movie.2026.1080p.WEB-DL</title>
      <guid isPermaLink="true">magnet:?xt=urn:btih:ABCDEF1234567890ABCDEF1234567890ABCDEF12</guid>
      <size>1500000000</size>
      <torznab:attr name="seeders" value="123"/>
      <torznab:attr name="peers" value="4"/>
      <torznab:attr name="infohash" value="ABCDEF1234567890ABCDEF1234567890ABCDEF12"/>
    </item>
  </channel>
</rss>`;

describe("TorznabIndexer", () => {
  it("parses a Torznab XML feed into torrent results", async () => {
    const mock = makeMockFetch(() => ok(torznabFeedXML));
    const indexer = new TorznabIndexer({
      name: "Jackett",
      baseURL: "http://localhost:9117",
      endpointPath: "/api/v2.0/indexers/all/results/torznab/api",
      apiKey: "abc123",
      categoryFilter: null,
      sendAPIKeyAsHeader: false,
      fetchImpl: mock.fetchImpl,
    });

    const results = await indexer.searchByQuery("Example Movie", "movie");

    expect(results.length).toBe(1);
    expect(results[0]?.infoHash).toBe(
      "abcdef1234567890abcdef1234567890abcdef12",
    );
    expect(results[0]?.seeders).toBe(123);
    expect(results[0]?.sizeBytes).toBe(1_500_000_000);
    expect(results[0]?.indexerName).toBe("Jackett");
  });

  it("builds the joined path and sends apikey in the query by default", async () => {
    const mock = makeMockFetch(() => ok(torznabFeedXML));
    const indexer = new TorznabIndexer({
      name: "Jackett",
      baseURL: "http://localhost:9117",
      endpointPath: "/api/v2.0/indexers/all/results/torznab/api",
      apiKey: "abc123",
      sendAPIKeyAsHeader: false,
      fetchImpl: mock.fetchImpl,
    });
    await indexer.searchByQuery("test", "movie");
    const url = mock.lastURL()!;
    expect(url.pathname).toBe("/api/v2.0/indexers/all/results/torznab/api");
    expect(url.searchParams.get("t")).toBe("search");
    expect(url.searchParams.get("q")).toBe("test");
    expect(url.searchParams.get("apikey")).toBe("abc123");
    expect(mock.lastHeaders()).toBeUndefined();
  });

  it("sends the API key in the X-Api-Key header for Prowlarr-style endpoints", async () => {
    const mock = makeMockFetch(() => ok("<rss><channel></channel></rss>"));
    const indexer = new TorznabIndexer({
      name: "Prowlarr",
      baseURL: "http://localhost:9696",
      endpointPath: "/api/v1/search",
      apiKey: "header-token",
      categoryFilter: null,
      sendAPIKeyAsHeader: true,
      fetchImpl: mock.fetchImpl,
    });

    await indexer.searchByQuery("test", "movie");
    expect(mock.lastHeaders()?.["X-Api-Key"]).toBe("header-token");
    // In header mode the apikey must NOT also be in the query.
    expect(mock.lastURL()!.searchParams.get("apikey")).toBeNull();
  });

  it("throws on a non-2xx HTTP status", async () => {
    const mock = makeMockFetch(() => ({ status: 500, body: "server error" }));
    const indexer = new TorznabIndexer({
      name: "Jackett",
      baseURL: "http://localhost:9117",
      endpointPath: "/api/v2.0/indexers/all/results/torznab/api",
      apiKey: "abc123",
      sendAPIKeyAsHeader: false,
      fetchImpl: mock.fetchImpl,
    });
    await expect(indexer.searchByQuery("test", "movie")).rejects.toMatchObject({
      kind: "badServerResponse",
    });
  });

  it("falls back to the magnet xt=urn:btih hash when no infohash attr is present", async () => {
    const xml = `<?xml version="1.0"?>
<rss xmlns:torznab="http://torznab.com/schemas/2015/feed"><channel>
  <item>
    <title>No.Infohash.Attr.1080p</title>
    <link>magnet:?xt=urn:btih:0123456789ABCDEF0123456789ABCDEF01234567&dn=x</link>
    <torznab:attr name="seeders" value="9"/>
    <torznab:attr name="size" value="42"/>
  </item>
</channel></rss>`;
    const mock = makeMockFetch(() => ok(xml));
    const indexer = new TorznabIndexer({
      name: "Jackett",
      baseURL: "http://localhost:9117",
      endpointPath: "",
      apiKey: null,
      fetchImpl: mock.fetchImpl,
    });
    const results = await indexer.searchByQuery("x", "movie");
    expect(results.length).toBe(1);
    expect(results[0]?.infoHash).toBe(
      "0123456789abcdef0123456789abcdef01234567",
    );
    expect(results[0]?.seeders).toBe(9);
    expect(results[0]?.sizeBytes).toBe(42);
  });

  it("passes season/ep params through on an IMDB search", async () => {
    const mock = makeMockFetch(() =>
      ok(
        `<rss xmlns:torznab="http://torznab.com/schemas/2015/feed"><channel><item>` +
          `<title>Any</title>` +
          `<size>1</size>` +
          `<guid>magnet:?xt=urn:btih:1111111111111111111111111111111111111111</guid>` +
          `</item></channel></rss>`,
      ),
    );
    const indexer = new TorznabIndexer({
      name: "Jackett",
      baseURL: "http://localhost:9117",
      endpointPath: "/api",
      apiKey: "k",
      fetchImpl: mock.fetchImpl,
    });
    await indexer.search("tt9999999", "series", 3, 7);
    const url = mock.lastURL()!;
    expect(url.searchParams.get("imdbid")).toBe("tt9999999");
    expect(url.searchParams.get("season")).toBe("3");
    expect(url.searchParams.get("ep")).toBe("7");
  });
});

// MARK: - parseTorznabFeed unit coverage

describe("parseTorznabFeed", () => {
  it("defaults a missing title to 'Unknown'", () => {
    const xml =
      '<rss xmlns:torznab="http://torznab.com/schemas/2015/feed"><channel>' +
      '<item><torznab:attr name="infohash" value="ABC"/></item>' +
      "</channel></rss>";
    const items = parseTorznabFeed(xml);
    expect(items.length).toBe(1);
    expect(items[0]?.title).toBe("Unknown");
    expect(items[0]?.infoHash).toBe("ABC");
  });

  it("does not discard the whole feed on an out-of-range numeric entity (regression)", () => {
    const xml =
      "<rss><channel><item>" +
      "<title>Bad &#1114112; Title</title>" + // > 0x10FFFF - must not throw
      "<size>500</size>" +
      "</item></channel></rss>";
    let items: ReturnType<typeof parseTorznabFeed> = [];
    expect(() => {
      items = parseTorznabFeed(xml);
    }).not.toThrow();
    expect(items.length).toBe(1);
    expect(items[0]?.title).toContain("Bad");
    expect(items[0]?.size).toBe(500);
  });

  it("reads the magnet URL from an enclosure url attribute", () => {
    const xml =
      "<rss><channel><item>" +
      "<title>X</title>" +
      '<enclosure url="magnet:?xt=urn:btih:ZZ" type="application/x-bittorrent"/>' +
      "</item></channel></rss>";
    const items = parseTorznabFeed(xml);
    expect(items[0]?.magnetURL).toBe("magnet:?xt=urn:btih:ZZ");
  });

  it("reads size from a torznab:attr and a plain <size> element", () => {
    const attrXml =
      '<rss xmlns:torznab="x"><channel><item><title>A</title>' +
      '<torznab:attr name="size" value="777"/></item></channel></rss>';
    expect(parseTorznabFeed(attrXml)[0]?.size).toBe(777);

    const elemXml =
      "<rss><channel><item><title>A</title><size>888</size></item></channel></rss>";
    expect(parseTorznabFeed(elemXml)[0]?.size).toBe(888);
  });
});

// ============================================================================
// IndexerFactory.testConnection (TorznabIndexerTests)
// ============================================================================

describe("IndexerFactory.testConnection", () => {
  it("returns false on a non-2xx HTTP status", async () => {
    const mock = makeMockFetch(() => ({ status: 401, body: "unauthorized" }));
    const config = makeIndexerConfig({
      id: "t1",
      type: "jackett",
      baseURL: "http://localhost:9117",
      apiKey: "badkey",
    });
    const okResult = await IndexerFactory.testConnection(config, mock.fetchImpl);
    expect(okResult).toBe(false);
  });

  it("returns false on a Torznab error envelope with HTTP 200", async () => {
    const xml =
      '<?xml version="1.0"?><error code="100" description="Incorrect user credentials"/>';
    const mock = makeMockFetch(() => ok(xml));
    const config = makeIndexerConfig({
      id: "t2",
      type: "jackett",
      baseURL: "http://localhost:9117",
      apiKey: "abc123",
    });
    const okResult = await IndexerFactory.testConnection(config, mock.fetchImpl);
    expect(okResult).toBe(false);
  });

  it("returns true on a valid empty Torznab feed", async () => {
    const xml = '<?xml version="1.0"?><rss version="2.0"><channel></channel></rss>';
    const mock = makeMockFetch(() => ok(xml));
    const config = makeIndexerConfig({
      id: "t3",
      type: "jackett",
      baseURL: "http://localhost:9117",
      apiKey: "abc123",
    });
    const okResult = await IndexerFactory.testConnection(config, mock.fetchImpl);
    expect(okResult).toBe(true);
  });

  it("returns true for built-in indexers without probing", async () => {
    const mock = makeMockFetch(() => ok("nope"));
    const config = makeIndexerConfig({
      id: "builtin",
      type: "built_in",
      baseURL: "",
    });
    const okResult = await IndexerFactory.testConnection(config, mock.fetchImpl);
    expect(okResult).toBe(true);
    expect(mock.hits()).toBe(0);
  });
});

// MARK: - IndexerFactory.buildIndexers

describe("IndexerFactory.buildIndexers", () => {
  it("defaults to the built-in scrapers (Torrentio-first) when no configs are given", () => {
    const indexers = IndexerFactory.buildIndexers([]);
    expect(indexers.map((i) => i.name)).toEqual(["Torrentio", "APIBay", "YTS", "EZTV"]);
  });

  it("omits built-ins when a built_in config is inactive and adds external indexers by priority", () => {
    const indexers = IndexerFactory.buildIndexers([
      makeIndexerConfig({ id: "b", type: "built_in", baseURL: "", isActive: false }),
      makeIndexerConfig({
        id: "p2",
        type: "torznab",
        baseURL: "http://h2",
        displayName: "Second",
        priority: 2,
      }),
      makeIndexerConfig({
        id: "p1",
        type: "jackett",
        baseURL: "http://h1",
        displayName: "First",
        priority: 1,
      }),
    ]);
    // Built-ins omitted; external sorted by ascending priority.
    expect(indexers.map((i) => i.name)).toEqual(["First", "Second"]);
  });
});

// ============================================================================
// IndexerManager dedup/sort (IndexerManagerTests)
// ============================================================================

/** A canned TorrentResult built directly (mirrors the Swift memberwise init in
 * the test, which sets `quality`/`seeders` exactly rather than parsing a title). */
function makeResult(args: {
  infoHash: string;
  title?: string;
  quality: VideoQuality;
  seeders: number;
  indexerName: string;
}): TorrentResult {
  const infoHash = args.infoHash;
  return {
    get id() {
      return infoHash;
    },
    infoHash,
    title: args.title ?? "Some.Release.1080p",
    sizeBytes: 1_000_000,
    quality: args.quality,
    codec: VC.unknown,
    audio: AF.unknown,
    source: ST.unknown,
    seeders: args.seeders,
    leechers: 0,
    indexerName: args.indexerName,
    magnetURI: null,
    isCached: false,
    cachedOn: null,
  };
}

/** A configurable stub indexer (mirrors the Swift `StubIndexer`): returns its
 * canned results for both search paths, or throws a fixed error. */
function stubIndexer(args: {
  name: string;
  results?: TorrentResult[];
  error?: Error;
}): TorrentIndexer {
  const results = args.results ?? [];
  return {
    name: args.name,
    async search() {
      if (args.error) throw args.error;
      return results;
    },
    async searchByQuery() {
      if (args.error) throw args.error;
      return results;
    },
  };
}

describe("IndexerManager dedup/sort", () => {
  it("searchAll keeps the higher-seeder copy of a duplicate infoHash", async () => {
    const dupHash = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const lowSeed = makeResult({
      infoHash: dupHash,
      quality: VQ.hd1080p,
      seeders: 5,
      indexerName: "Low",
    });
    const highSeed = makeResult({
      infoHash: dupHash,
      quality: VQ.hd1080p,
      seeders: 42,
      indexerName: "High",
    });

    const manager = new IndexerManager();
    manager.setIndexers([
      stubIndexer({ name: "Low", results: [lowSeed] }),
      stubIndexer({ name: "High", results: [highSeed] }),
    ]);

    const merged = await manager.searchAll("tt0001", "movie");

    expect(merged.length).toBe(1);
    expect(merged[0]?.infoHash).toBe(dupHash);
    expect(merged[0]?.seeders).toBe(42);
    expect(merged[0]?.indexerName).toBe("High");
  });

  it("searchAll orders by quality first, then seeders within a quality tier", async () => {
    const uhd = makeResult({
      infoHash: "1111111111111111111111111111111111111111",
      quality: VQ.uhd4k,
      seeders: 1,
      indexerName: "A",
    });
    const hd1080Low = makeResult({
      infoHash: "2222222222222222222222222222222222222222",
      quality: VQ.hd1080p,
      seeders: 3,
      indexerName: "A",
    });
    const hd1080High = makeResult({
      infoHash: "3333333333333333333333333333333333333333",
      quality: VQ.hd1080p,
      seeders: 99,
      indexerName: "A",
    });
    const hd720 = makeResult({
      infoHash: "4444444444444444444444444444444444444444",
      quality: VQ.hd720p,
      seeders: 500,
      indexerName: "A",
    });

    const manager = new IndexerManager();
    manager.setIndexers([
      stubIndexer({ name: "A", results: [hd720, hd1080Low, uhd, hd1080High] }),
    ]);

    const merged = await manager.searchAll("tt0002", "movie");

    expect(merged.length).toBe(4);
    expect(merged[0]?.quality).toBe(VQ.uhd4k);
    expect(merged[1]?.quality).toBe(VQ.hd1080p);
    expect(merged[1]?.seeders).toBe(99);
    expect(merged[2]?.quality).toBe(VQ.hd1080p);
    expect(merged[2]?.seeders).toBe(3);
    expect(merged[3]?.quality).toBe(VQ.hd720p);
    expect(merged[3]?.seeders).toBe(500);
  });

  it("searchAll records a throwing indexer in lastSearchErrors without dropping good results", async () => {
    const good = makeResult({
      infoHash: "5555555555555555555555555555555555555555",
      quality: VQ.hd1080p,
      seeders: 10,
      indexerName: "Good",
    });

    const manager = new IndexerManager();
    manager.setIndexers([
      stubIndexer({ name: "Good", results: [good] }),
      stubIndexer({ name: "Broken", error: new Error("boom") }),
    ]);

    const merged = await manager.searchAll("tt0003", "movie");

    expect(merged.length).toBe(1);
    expect(merged[0]?.indexerName).toBe("Good");

    const errors = manager.lastSearchErrors;
    expect(errors.length).toBe(1);
    expect(errors[0]?.indexer).toBe("Broken");
    expect(errors[0]?.error.length).toBeGreaterThan(0);
  });

  it("a fully successful searchAll clears lastSearchErrors", async () => {
    const good = makeResult({
      infoHash: "6666666666666666666666666666666666666666",
      quality: VQ.hd720p,
      seeders: 7,
      indexerName: "Good",
    });

    const manager = new IndexerManager();
    manager.setIndexers([stubIndexer({ name: "Good", results: [good] })]);

    await manager.searchAll("tt0004", "movie");

    expect(manager.lastSearchErrors).toEqual([]);
  });

  it("searchByQuery dedups, sorts, and captures errors just like searchAll", async () => {
    const dupHash = "7777777777777777777777777777777777777777";
    const lowSeed = makeResult({
      infoHash: dupHash,
      quality: VQ.hd1080p,
      seeders: 2,
      indexerName: "Low",
    });
    const highSeed = makeResult({
      infoHash: dupHash,
      quality: VQ.hd1080p,
      seeders: 80,
      indexerName: "High",
    });
    const uniqueUHD = makeResult({
      infoHash: "8888888888888888888888888888888888888888",
      quality: VQ.uhd4k,
      seeders: 1,
      indexerName: "High",
    });

    const manager = new IndexerManager();
    manager.setIndexers([
      stubIndexer({ name: "Low", results: [lowSeed] }),
      stubIndexer({ name: "High", results: [highSeed, uniqueUHD] }),
      stubIndexer({ name: "Broken", error: new Error("kaput") }),
    ]);

    const merged = await manager.searchByQuery("the matrix", "movie");

    expect(merged.length).toBe(2);
    expect(merged[0]?.quality).toBe(VQ.uhd4k);
    expect(merged[1]?.quality).toBe(VQ.hd1080p);
    expect(merged[1]?.seeders).toBe(80);

    const errors = manager.lastSearchErrors;
    expect(errors.length).toBe(1);
    expect(errors[0]?.indexer).toBe("Broken");
  });

  it("setIndexers replaces the active indexer set", async () => {
    const manager = new IndexerManager();
    manager.setIndexers([
      stubIndexer({ name: "First" }),
      stubIndexer({ name: "Second" }),
    ]);
    expect(manager.activeIndexers).toEqual(["First", "Second"]);
  });
});

// MARK: - TorrentResult title parsing (covers fromSearch's quality/codec/etc.)

describe("TorrentResult.fromSearch", () => {
  it("parses quality/codec/source/audio from the title and lowercases the hash", () => {
    const r = TorrentResult.fromSearch({
      infoHash: "ABCDEF",
      title: "Movie.2024.2160p.BluRay.x265.TrueHD.Atmos",
      sizeBytes: 1234,
      seeders: 50,
      leechers: 2,
      indexerName: "T",
    });
    expect(r.infoHash).toBe("abcdef");
    expect(r.id).toBe("abcdef");
    expect(r.quality).toBe(VQ.uhd4k);
    expect(r.codec).toBe("H.265");
    expect(r.source).toBe("BluRay");
    expect(r.audio).toBe("Atmos");
    expect(TorrentResult.qualityLabel(r)).toBe("4K · H.265 · BluRay · Atmos");
  });
});
