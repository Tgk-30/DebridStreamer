// Mirrors the EZTV portions of the Swift indexer tests (BuiltInIndexerTests),
// focused on the JSON `get-torrents` API: the series-only gate, the "tt"-prefix
// stripping + numeric IMDB id, the paginated get-torrents loop (max 3 pages,
// stop when a page is short of the 100-item PAGE_LIMIT), season/episode string
// filtering, hash/title/size parsing, and non-2xx / empty / malformed bodies.
//
// As in indexers.test.ts and StremioAddonIndexer.test.ts, the network is stubbed
// with an injected `FetchImpl` that captures URLs and counts calls.

import { describe, expect, it } from "vitest";
import { EZTVIndexer } from "./EZTVIndexer";
import { type FetchImpl } from "./types";

interface MockResponse {
  status: number;
  body: string;
}

interface MockFetch {
  fetchImpl: FetchImpl;
  lastURL: () => URL | null;
  urls: () => URL[];
  hits: () => number;
}

function makeMockFetch(
  handler: (url: URL, hit: number) => MockResponse,
): MockFetch {
  let count = 0;
  let captured: URL | null = null;
  const all: URL[] = [];
  const fetchImpl: FetchImpl = async (url) => {
    count += 1;
    const parsed = new URL(url);
    captured = parsed;
    all.push(parsed);
    const { status, body } = handler(parsed, count);
    return { status, text: async () => body };
  };
  return {
    fetchImpl,
    lastURL: () => captured,
    urls: () => all,
    hits: () => count,
  };
}

const ok = (body: string): MockResponse => ({ status: 200, body });

/** Build an EZTV API response body with `count` torrents, each with a unique
 * 40-char hash + filename. Season/episode default to "1"/index. */
function makePage(count: number, startId = 1): string {
  const torrents = Array.from({ length: count }, (_, i) => {
    const id = startId + i;
    const hash = id.toString(16).padStart(40, "0");
    return {
      id,
      hash,
      filename: `Show.S01E${String(id).padStart(2, "0")}.720p.HDTV.x264`,
      title: `Show S01E${String(id).padStart(2, "0")} 720p HDTV`,
      season: "1",
      episode: String(id),
      seeds: 10,
      peers: 1,
      size_bytes: "500000000",
      magnet_url: `magnet:?xt=urn:btih:${hash}`,
    };
  });
  return JSON.stringify({ torrents_count: count, page: 1, torrents });
}

describe("EZTVIndexer.search (series-only gate)", () => {
  it("returns [] for movies without hitting the network", async () => {
    const mock = makeMockFetch(() => ok("{}"));
    const indexer = new EZTVIndexer(mock.fetchImpl);
    const results = await indexer.search("tt1234567", "movie", null, null);
    expect(results).toEqual([]);
    expect(mock.hits()).toBe(0);
  });

  it("returns [] when the IMDB id is only the 'tt' prefix (empty numeric id)", async () => {
    const mock = makeMockFetch(() => ok(makePage(1)));
    const indexer = new EZTVIndexer(mock.fetchImpl);
    const results = await indexer.search("tt", "series", null, null);
    expect(results).toEqual([]);
    expect(mock.hits()).toBe(0);
  });

  it("strips the 'tt' prefix and passes the numeric id + page + limit", async () => {
    const mock = makeMockFetch(() => ok(JSON.stringify({ torrents: [] })));
    const indexer = new EZTVIndexer(mock.fetchImpl);
    await indexer.search("tt1234567", "series", null, null);

    const url = mock.lastURL()!;
    expect(url.pathname).toBe("/api/get-torrents");
    expect(url.searchParams.get("imdb_id")).toBe("1234567");
    expect(url.searchParams.get("page")).toBe("1");
    expect(url.searchParams.get("limit")).toBe("100");
  });

  it("removes every 'tt' occurrence in the id (replaceAll semantics)", async () => {
    // replaceAll("tt", "") strips ALL "tt" substrings, not just a leading one.
    const mock = makeMockFetch(() => ok(JSON.stringify({ torrents: [] })));
    const indexer = new EZTVIndexer(mock.fetchImpl);
    await indexer.search("tt12tt34", "series", null, null);
    expect(mock.lastURL()!.searchParams.get("imdb_id")).toBe("1234");
  });
});

describe("EZTVIndexer.search (decoding + filtering)", () => {
  it("decodes torrents, lowercases the hash, and parses size_bytes", async () => {
    const body = JSON.stringify({
      torrents_count: 1,
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
      ],
    });
    const mock = makeMockFetch(() => ok(body));
    const indexer = new EZTVIndexer(mock.fetchImpl);

    const results = await indexer.search("tt1234567", "series", null, null);

    expect(results.length).toBe(1);
    expect(results[0]?.infoHash).toBe(
      "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef0",
    );
    expect(results[0]?.title).toBe("Show S01E01 720p HDTV x264");
    expect(results[0]?.sizeBytes).toBe(500_000_000);
    expect(results[0]?.seeders).toBe(30);
    expect(results[0]?.leechers).toBe(4);
    expect(results[0]?.magnetURI).toBe("magnet:?xt=urn:btih:DEADBEEF");
    expect(results[0]?.indexerName).toBe("EZTV");
  });

  it("filters by season AND episode using string equality", async () => {
    const body = JSON.stringify({
      torrents: [
        {
          id: 1,
          hash: "1111111111111111111111111111111111111111",
          title: "Show S01E01",
          season: "1",
          episode: "1",
          seeds: 5,
          size_bytes: "1",
        },
        {
          id: 2,
          hash: "2222222222222222222222222222222222222222",
          title: "Show S01E02",
          season: "1",
          episode: "2",
          seeds: 5,
          size_bytes: "1",
        },
      ],
    });
    const mock = makeMockFetch(() => ok(body));
    const indexer = new EZTVIndexer(mock.fetchImpl);

    const results = await indexer.search("tt1", "series", 1, 1);
    expect(results.length).toBe(1);
    expect(results[0]?.infoHash).toBe(
      "1111111111111111111111111111111111111111",
    );
  });

  it("keeps a torrent whose season field is null even when a season filter is set", async () => {
    // The filter only applies when BOTH the requested season AND torrent.season
    // are non-null; a null torrent.season bypasses the season check.
    const body = JSON.stringify({
      torrents: [
        {
          id: 1,
          hash: "3333333333333333333333333333333333333333",
          title: "Show full season pack",
          season: null,
          episode: null,
          seeds: 5,
          size_bytes: "1",
        },
      ],
    });
    const mock = makeMockFetch(() => ok(body));
    const indexer = new EZTVIndexer(mock.fetchImpl);

    const results = await indexer.search("tt1", "series", 2, 9);
    expect(results.length).toBe(1);
    expect(results[0]?.infoHash).toBe(
      "3333333333333333333333333333333333333333",
    );
  });

  it("returns all torrents when season/episode are null (no filtering)", async () => {
    const body = JSON.stringify({
      torrents: [
        {
          id: 1,
          hash: "4444444444444444444444444444444444444444",
          title: "A",
          season: "1",
          episode: "1",
          seeds: 1,
          size_bytes: "1",
        },
        {
          id: 2,
          hash: "5555555555555555555555555555555555555555",
          title: "B",
          season: "2",
          episode: "5",
          seeds: 1,
          size_bytes: "1",
        },
      ],
    });
    const mock = makeMockFetch(() => ok(body));
    const indexer = new EZTVIndexer(mock.fetchImpl);

    const results = await indexer.search("tt1", "series", null, null);
    expect(results.length).toBe(2);
  });

  it("skips torrents with a null or empty hash", async () => {
    const body = JSON.stringify({
      torrents: [
        { id: 1, hash: null, title: "no hash", seeds: 1, size_bytes: "1" },
        { id: 2, hash: "", title: "empty hash", seeds: 1, size_bytes: "1" },
        {
          id: 3,
          hash: "6666666666666666666666666666666666666666",
          title: "good",
          seeds: 1,
          size_bytes: "1",
        },
      ],
    });
    const mock = makeMockFetch(() => ok(body));
    const indexer = new EZTVIndexer(mock.fetchImpl);

    const results = await indexer.search("tt1", "series", null, null);
    expect(results.length).toBe(1);
    expect(results[0]?.infoHash).toBe(
      "6666666666666666666666666666666666666666",
    );
  });

  it("falls back to filename then 'Unknown' when title is absent", async () => {
    const body = JSON.stringify({
      torrents: [
        {
          id: 1,
          hash: "7777777777777777777777777777777777777777",
          filename: "From.Filename.720p",
          seeds: 1,
          size_bytes: "1",
        },
        {
          id: 2,
          hash: "8888888888888888888888888888888888888888",
          seeds: 1,
          size_bytes: "1",
        },
      ],
    });
    const mock = makeMockFetch(() => ok(body));
    const indexer = new EZTVIndexer(mock.fetchImpl);

    const results = await indexer.search("tt1", "series", null, null);
    expect(results.length).toBe(2);
    const fromFilename = results.find(
      (r) => r.infoHash === "7777777777777777777777777777777777777777",
    );
    const unknown = results.find(
      (r) => r.infoHash === "8888888888888888888888888888888888888888",
    );
    expect(fromFilename?.title).toBe("From.Filename.720p");
    expect(unknown?.title).toBe("Unknown");
  });

  it("defaults size to 0 when size_bytes is missing and 0 for unparseable size", async () => {
    const body = JSON.stringify({
      torrents: [
        {
          id: 1,
          hash: "9999999999999999999999999999999999999999",
          title: "no size",
          seeds: 1,
        },
        {
          id: 2,
          hash: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          title: "garbage size",
          seeds: 1,
          size_bytes: "not-a-number",
        },
      ],
    });
    const mock = makeMockFetch(() => ok(body));
    const indexer = new EZTVIndexer(mock.fetchImpl);

    const results = await indexer.search("tt1", "series", null, null);
    expect(results.length).toBe(2);
    for (const r of results) {
      expect(r.sizeBytes).toBe(0);
    }
  });

  it("defaults seeders/leechers to 0 when seeds/peers are absent", async () => {
    const body = JSON.stringify({
      torrents: [
        {
          id: 1,
          hash: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
          title: "no seeds",
          size_bytes: "1",
        },
      ],
    });
    const mock = makeMockFetch(() => ok(body));
    const indexer = new EZTVIndexer(mock.fetchImpl);

    const results = await indexer.search("tt1", "series", null, null);
    expect(results[0]?.seeders).toBe(0);
    expect(results[0]?.leechers).toBe(0);
  });

  it("sets magnetURI to null when magnet_url is absent", async () => {
    const body = JSON.stringify({
      torrents: [
        {
          id: 1,
          hash: "cccccccccccccccccccccccccccccccccccccccc",
          title: "no magnet",
          seeds: 1,
          size_bytes: "1",
        },
      ],
    });
    const mock = makeMockFetch(() => ok(body));
    const indexer = new EZTVIndexer(mock.fetchImpl);

    const results = await indexer.search("tt1", "series", null, null);
    expect(results[0]?.magnetURI).toBeNull();
  });
});

describe("EZTVIndexer.search (pagination)", () => {
  it("stops after the first page when it is short of PAGE_LIMIT", async () => {
    const mock = makeMockFetch(() => ok(makePage(3)));
    const indexer = new EZTVIndexer(mock.fetchImpl);

    const results = await indexer.search("tt1", "series", null, null);
    expect(results.length).toBe(3);
    expect(mock.hits()).toBe(1);
  });

  it("stops on an empty torrents page", async () => {
    const mock = makeMockFetch(() =>
      ok(JSON.stringify({ torrents_count: 0, page: 1, torrents: [] })),
    );
    const indexer = new EZTVIndexer(mock.fetchImpl);

    const results = await indexer.search("tt1", "series", null, null);
    expect(results).toEqual([]);
    expect(mock.hits()).toBe(1);
  });

  it("stops on a null torrents field", async () => {
    const mock = makeMockFetch(() => ok(JSON.stringify({ torrents_count: 0 })));
    const indexer = new EZTVIndexer(mock.fetchImpl);

    const results = await indexer.search("tt1", "series", null, null);
    expect(results).toEqual([]);
    expect(mock.hits()).toBe(1);
  });

  it("requests subsequent pages while each page is full (PAGE_LIMIT items)", async () => {
    // First two pages full (100 each) -> a short third page ends the loop.
    const mock = makeMockFetch((url) => {
      const page = Number(url.searchParams.get("page"));
      if (page === 1) return ok(makePage(100, 1));
      if (page === 2) return ok(makePage(100, 101));
      return ok(makePage(5, 201));
    });
    const indexer = new EZTVIndexer(mock.fetchImpl);

    const results = await indexer.search("tt1", "series", null, null);
    expect(mock.hits()).toBe(3);
    expect(results.length).toBe(205);
    // Pages were requested in ascending order.
    expect(mock.urls().map((u) => u.searchParams.get("page"))).toEqual([
      "1",
      "2",
      "3",
    ]);
  });

  it("stops at MAX_PAGES (3) even when every page is full", async () => {
    // Every page returns a full PAGE_LIMIT, so only the MAX_PAGES cap halts it.
    const mock = makeMockFetch((url) => {
      const page = Number(url.searchParams.get("page"));
      return ok(makePage(100, 1 + (page - 1) * 100));
    });
    const indexer = new EZTVIndexer(mock.fetchImpl);

    const results = await indexer.search("tt1", "series", null, null);
    expect(mock.hits()).toBe(3);
    expect(results.length).toBe(300);
  });
});

describe("EZTVIndexer.searchByQuery", () => {
  it("returns [] for movies without hitting the network", async () => {
    const mock = makeMockFetch(() => ok("{}"));
    const indexer = new EZTVIndexer(mock.fetchImpl);
    const results = await indexer.searchByQuery("anything", "movie");
    expect(results).toEqual([]);
    expect(mock.hits()).toBe(0);
  });

  it("encodes the query and uses a single page (no pagination, no imdb_id)", async () => {
    const mock = makeMockFetch(() => ok(JSON.stringify({ torrents: [] })));
    const indexer = new EZTVIndexer(mock.fetchImpl);

    await indexer.searchByQuery("the office", "series");
    expect(mock.hits()).toBe(1);
    const url = mock.lastURL()!;
    expect(url.pathname).toBe("/api/get-torrents");
    expect(url.searchParams.get("search")).toBe("the office");
    expect(url.searchParams.get("limit")).toBe("100");
    expect(url.searchParams.get("imdb_id")).toBeNull();
    expect(url.searchParams.get("page")).toBeNull();
  });

  it("does not apply season/episode filtering and decodes all torrents", async () => {
    const body = JSON.stringify({
      torrents: [
        {
          id: 1,
          hash: "dddddddddddddddddddddddddddddddddddddddd",
          title: "Show S01E01",
          season: "1",
          episode: "1",
          seeds: 9,
          size_bytes: "1000",
          magnet_url: "magnet:?xt=urn:btih:DDDD",
        },
        {
          id: 2,
          hash: "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
          title: "Show S03E07",
          season: "3",
          episode: "7",
          seeds: 2,
          size_bytes: "2000",
        },
      ],
    });
    const mock = makeMockFetch(() => ok(body));
    const indexer = new EZTVIndexer(mock.fetchImpl);

    const results = await indexer.searchByQuery("show", "series");
    expect(results.length).toBe(2);
    expect(results[0]?.sizeBytes).toBe(1000);
    expect(results[0]?.magnetURI).toBe("magnet:?xt=urn:btih:DDDD");
  });

  it("skips torrents with an empty hash", async () => {
    const body = JSON.stringify({
      torrents: [
        { id: 1, hash: "", title: "skip", seeds: 1, size_bytes: "1" },
        {
          id: 2,
          hash: "ffffffffffffffffffffffffffffffffffffffff",
          title: "keep",
          seeds: 1,
          size_bytes: "1",
        },
      ],
    });
    const mock = makeMockFetch(() => ok(body));
    const indexer = new EZTVIndexer(mock.fetchImpl);

    const results = await indexer.searchByQuery("x", "series");
    expect(results.length).toBe(1);
    expect(results[0]?.infoHash).toBe(
      "ffffffffffffffffffffffffffffffffffffffff",
    );
  });

  it("returns [] for an empty torrents list with HTTP 200", async () => {
    const mock = makeMockFetch(() =>
      ok(JSON.stringify({ torrents_count: 0, page: 1, torrents: [] })),
    );
    const indexer = new EZTVIndexer(mock.fetchImpl);
    const results = await indexer.searchByQuery("nothing", "series");
    expect(results).toEqual([]);
  });

  it("returns [] for a null torrents field with HTTP 200", async () => {
    const mock = makeMockFetch(() => ok(JSON.stringify({ torrents_count: 0 })));
    const indexer = new EZTVIndexer(mock.fetchImpl);
    const results = await indexer.searchByQuery("nothing", "series");
    expect(results).toEqual([]);
  });
});

describe("EZTVIndexer (error / malformed responses)", () => {
  it("throws badServerResponse on a non-2xx response (search)", async () => {
    const mock = makeMockFetch(() => ({ status: 502, body: "{}" }));
    const indexer = new EZTVIndexer(mock.fetchImpl);
    await expect(
      indexer.search("tt1", "series", null, null),
    ).rejects.toMatchObject({ kind: "badServerResponse", statusCode: 502 });
  });

  it("throws badServerResponse on a non-2xx response (searchByQuery)", async () => {
    const mock = makeMockFetch(() => ({ status: 503, body: "{}" }));
    const indexer = new EZTVIndexer(mock.fetchImpl);
    await expect(
      indexer.searchByQuery("anything", "series"),
    ).rejects.toMatchObject({ kind: "badServerResponse", statusCode: 503 });
  });

  it("throws on malformed JSON (unparseable body)", async () => {
    const mock = makeMockFetch(() => ok("this is not json"));
    const indexer = new EZTVIndexer(mock.fetchImpl);
    await expect(
      indexer.search("tt1", "series", null, null),
    ).rejects.toThrow();
  });
});
