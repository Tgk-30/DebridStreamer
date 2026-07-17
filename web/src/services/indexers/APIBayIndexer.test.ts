import { describe, expect, it } from "vitest";
import { APIBayIndexer } from "./APIBayIndexer";
import { type FetchImpl } from "./types";

interface MockResponse {
  status: number;
  body: string;
}

interface MockFetch {
  fetchImpl: FetchImpl;
  lastURL: () => string | null;
  urls: () => string[];
  hits: () => number;
}

function makeMockFetch(handler: (url: string) => MockResponse): MockFetch {
  let count = 0;
  let captured: string | null = null;
  const urls: string[] = [];
  const fetchImpl: FetchImpl = async (url) => {
    count += 1;
    captured = url;
    urls.push(url);
    const { status, body } = handler(url);
    return { status, text: async () => body };
  };
  return {
    fetchImpl,
    lastURL: () => captured,
    urls: () => urls,
    hits: () => count,
  };
}

function body(items: unknown): MockResponse {
  return { status: 200, body: JSON.stringify(items) };
}

describe("APIBayIndexer.search", () => {
  it("returns [] without fetching when imdbId is whitespace-only", async () => {
    const mock = makeMockFetch(() =>
      body([
        {
          id: "1",
          name: "Should never fetch",
          info_hash: "a".repeat(40),
          seeders: "10",
          leechers: "1",
          size: "1",
        },
      ]),
    );
    const indexer = new APIBayIndexer(mock.fetchImpl);
    const results = await indexer.search("   ", "movie", null, null);

    expect(results).toEqual([]);
    expect(mock.hits()).toBe(0);
  });

  it("returns [] without fetching when searchByQuery is whitespace-only", async () => {
    const mock = makeMockFetch(() =>
      body([
        {
          id: "1",
          name: "Should never fetch",
          info_hash: "a".repeat(40),
          seeders: "10",
          leechers: "1",
          size: "1",
        },
      ]),
    );
    const indexer = new APIBayIndexer(mock.fetchImpl);

    const results = await indexer.searchByQuery("   ", "movie");
    expect(results).toEqual([]);
    expect(mock.hits()).toBe(0);
  });

  it("drops a result with an empty hash", async () => {
    const mock = makeMockFetch(() =>
      body([
        {
          id: "1",
          name: "Missing hash",
          info_hash: "",
          seeders: "12",
          leechers: "1",
          size: "500",
        },
      ]),
    );
    const indexer = new APIBayIndexer(mock.fetchImpl);
    const results = await indexer.search("tt000", "movie", null, null);

    expect(results).toEqual([]);
    expect(mock.hits()).toBe(6);
  });

  it("drops zero/empty hashes and dead torrents, and parses sizes", async () => {
    const mock = makeMockFetch((_url) =>
      body([
        {
          id: "1",
          name: "Good Movie",
          info_hash: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          seeders: "0",
          leechers: "2",
          size: "500000000",
        },
        {
          id: "2",
          name: "All zero hash",
          info_hash: "0000000000000000000000000000000000000000",
          seeders: "10",
          leechers: "2",
          size: "1000000",
        },
        {
          id: "3",
          name: "Good one",
          info_hash: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
          seeders: "12",
          leechers: "0",
          size: "abc",
        },
      ]),
    );

    const indexer = new APIBayIndexer(mock.fetchImpl);
    const results = await indexer.search("tt1234", "movie", null, null);

    expect(mock.hits()).toBe(1);
    expect(mock.lastURL()).toContain("/q.php?q=tt1234&cat=207");
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      infoHash: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      sizeBytes: 0,
    });
  });

  it("keeps only results matching requested season+episode token", async () => {
    const mock = makeMockFetch(() =>
      body([
        {
          id: "1",
          name: "Show.S01E01.720p.REPACK",
          info_hash: "cccccccccccccccccccccccccccccccccccccccc",
          seeders: "10",
          leechers: "1",
          size: "10",
        },
        {
          id: "2",
          name: "Show.S01E01xExtra",
          info_hash: "dddddddddddddddddddddddddddddddddddddddd",
          seeders: "15",
          leechers: "1",
          size: "20",
        },
        {
          id: "3",
          name: "Show S01 E05",
          info_hash: "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
          seeders: "8",
          leechers: "1",
          size: "30",
        },
      ]),
    );

    const indexer = new APIBayIndexer(mock.fetchImpl);
    const results = await indexer.search("tt9999", "series", 1, 1);

    expect(results).toHaveLength(2);
    expect(results[0]?.infoHash).toBe("cccccccccccccccccccccccccccccccccccccccc");
    expect(results[1]?.infoHash).toBe("dddddddddddddddddddddddddddddddddddddddd");
  });

  it("uses a fallback path when the query endpoint returns no results", async () => {
    const mock = makeMockFetch(() => body([{ name: "No results returned", id: "0", info_hash: "", seeders: "0", leechers: "0", size: "0" }]));
    const indexer = new APIBayIndexer(mock.fetchImpl);

    const results = await indexer.search("tt0", "movie", null, null);
    expect(results).toEqual([]);
    expect(mock.hits()).toBe(6);
  });

  it("falls back from tt-prefixed imdb to numeric id", async () => {
    const seen: string[] = [];
    const mock = makeMockFetch((url) => {
      const params = new URL(url).searchParams;
      seen.push(params.get("q") ?? "");
      if ((params.get("q") ?? "") === "tt987") {
        return body([{ name: "No results returned", id: "0", info_hash: "", seeders: "0", leechers: "0", size: "0" }]);
      }

      return body([
        {
          id: "1",
          name: "Fallback Movie",
          info_hash: "a".repeat(40),
          seeders: "9",
          leechers: "1",
          size: "10",
        },
      ]);
    });

    const indexer = new APIBayIndexer(mock.fetchImpl);
    const results = await indexer.search("tt987", "movie", null, null);

    expect(results).toHaveLength(1);
    expect(seen).toContain("tt987");
    expect(seen).toContain("987");
    expect(results[0]?.infoHash).toBe("a".repeat(40));
  });

  it("falls back from uppercase TT-prefixed imdb IDs", async () => {
    const seen: string[] = [];
    const mock = makeMockFetch((url) => {
      const params = new URL(url).searchParams;
      const query = params.get("q") ?? "";
      seen.push(query);

      if (query === "TT987") {
        return body([{ name: "No results returned", id: "0", info_hash: "", seeders: "0", leechers: "0", size: "0" }]);
      }

      if (query === "987") {
        return body([
          {
            id: "1",
            name: "Fallback Movie",
            info_hash: "b".repeat(40),
            seeders: "12",
            leechers: "0",
            size: "1",
          },
        ]);
      }

      return body([{
        id: "2",
        name: "Ignored",
        info_hash: "c".repeat(40),
        seeders: "99",
        leechers: "0",
        size: "1",
      }]);
    });

    const indexer = new APIBayIndexer(mock.fetchImpl);
    const results = await indexer.search("TT987", "movie", null, null);

    expect(results).toHaveLength(1);
    expect(seen).toContain("TT987");
    expect(seen).toContain("987");
    expect(results[0]?.infoHash).toBe("b".repeat(40));
  });

  it("does not fallback when the imdb ID is already numeric", async () => {
    const seen: string[] = [];
    const mock = makeMockFetch((url) => {
      const params = new URL(url).searchParams;
      const query = params.get("q") ?? "";
      seen.push(query);

      if (query === "1234") {
        return body([
          {
            id: "1",
            name: "Numeric ID Movie",
            info_hash: "f".repeat(40),
            seeders: "6",
            leechers: "0",
            size: "50",
          },
        ]);
      }

      return body([{ name: "No results returned", id: "0", info_hash: "", seeders: "0", leechers: "0", size: "0" }]);
    });

    const indexer = new APIBayIndexer(mock.fetchImpl);
    const results = await indexer.search("1234", "movie", null, null);

    expect(results).toHaveLength(1);
    expect(seen).toEqual(["1234"]);
    expect(results[0]?.infoHash).toBe("f".repeat(40));
  });

  it("does not create a numeric fallback for bare 'tt' IDs", async () => {
    const mock = makeMockFetch(() =>
      body([
        {
          id: "0",
          name: "No results returned",
          info_hash: "",
          seeders: "0",
          leechers: "0",
          size: "0",
        },
      ]),
    );
    const indexer = new APIBayIndexer(mock.fetchImpl);

    const results = await indexer.search("tt", "movie", null, null);

    expect(results).toEqual([]);
    expect(mock.hits()).toBe(3);
  });

  it("falls back to broader categories if the preferred HD category has no hit list", async () => {
    const mock = makeMockFetch((url) => {
      const params = new URL(url).searchParams;
      if (params.get("cat") === "207") {
        return body([{ name: "No results returned", id: "0", info_hash: "", seeders: "0", leechers: "0", size: "0" }]);
      }

      if (params.get("cat") === "201") {
        return body([
          {
            id: "1",
            name: "Fallback Movie",
            info_hash: "f".repeat(40),
            seeders: "12",
            leechers: "0",
            size: "1",
          },
        ]);
      }

      return body([{
        id: "2",
        name: "Should not run on failure mode",
        info_hash: "e".repeat(40),
        seeders: "99",
        leechers: "0",
        size: "1",
      }]);
    });

    const indexer = new APIBayIndexer(mock.fetchImpl);

    const results = await indexer.search("tt0", "movie", null, null);
    expect(mock.hits()).toBe(3);
    expect(results).toHaveLength(1);
    expect(results[0]!.infoHash).toBe("f".repeat(40));
  });

  it("deduplicates duplicate hashes while searching by IMDB ID", async () => {
    const mock = makeMockFetch(() =>
      body([
        {
          id: "1",
          name: "First Copy",
          info_hash: "A".repeat(40),
          seeders: "10",
          leechers: "1",
          size: "11",
        },
        {
          id: "2",
          name: "Second Copy",
          info_hash: "a".repeat(40),
          seeders: "12",
          leechers: "0",
          size: "12",
        },
        {
          id: "3",
          name: "Fallback Duplicate",
          info_hash: "A".repeat(40),
          seeders: "20",
          leechers: "1",
          size: "13",
        },
      ]),
    );
    const indexer = new APIBayIndexer(mock.fetchImpl);

    const results = await indexer.search("tt123", "movie", null, null);

    expect(mock.hits()).toBe(1);
    expect(results).toHaveLength(1);
    expect(results[0]?.seeders).toBe(10);
  });

  it("throws badServerResponse for non-2xx", async () => {
    const mock = makeMockFetch(() => ({ status: 500, body: "boom" }));
    const indexer = new APIBayIndexer(mock.fetchImpl);

    await expect(indexer.search("tt1", "movie", null, null)).rejects.toMatchObject({
      kind: "badServerResponse",
      statusCode: 500,
    });
  });

  it("matches common one-digit and x-formatted season/episode patterns", async () => {
    const mock = makeMockFetch((url) => {
      const params = new URL(url).searchParams;
      if (params.get("cat") !== "208") return body([]);
      return body([
        {
          id: "1",
          name: "Show.S1E1.REPACK",
          info_hash: "c".repeat(40),
          seeders: "10",
          leechers: "1",
          size: "10",
        },
        {
          id: "2",
          name: "Show 1x01",
          info_hash: "d".repeat(40),
          seeders: "10",
          leechers: "1",
          size: "10",
        },
        {
          id: "3",
          name: "Show S01-01",
          info_hash: "e".repeat(40),
          seeders: "10",
          leechers: "1",
          size: "10",
        },
      ]);
    });

    const indexer = new APIBayIndexer(mock.fetchImpl);
    const results = await indexer.search("tt9999", "series", 1, 1);

    expect(results).toHaveLength(2);
    expect(results.map((r) => r.infoHash)).toEqual([
      "c".repeat(40),
      "d".repeat(40),
    ]);
  });

  it("falls back to broader series categories when the HD TV category is empty", async () => {
    const mock = makeMockFetch((url) => {
      const params = new URL(url).searchParams;
      if (params.get("cat") === "208") {
        return body([{ name: "No results returned", id: "0", info_hash: "", seeders: "0", leechers: "0", size: "0" }]);
      }
      if (params.get("cat") === "205") {
        return body([
          {
            id: "1",
            name: "Fallback.Series",
            info_hash: "f".repeat(40),
            seeders: "11",
            leechers: "0",
            size: "1",
          },
        ]);
      }
      return body([{
        id: "2",
        name: "Ignored broad fallback",
        info_hash: "e".repeat(40),
        seeders: "12",
        leechers: "0",
        size: "1",
      }]);
    });
    const indexer = new APIBayIndexer(mock.fetchImpl);
    const results = await indexer.search("tt0", "series", null, null);

    expect(mock.hits()).toBe(3);
    expect(results).toHaveLength(1);
    expect(results[0]?.infoHash).toBe("f".repeat(40));
  });
});

describe("APIBayIndexer.searchByQuery", () => {
  it("maps movie vs series categories into the query parameter", async () => {
    const mock = makeMockFetch(() =>
      body([{ id: "1", name: "A", info_hash: "a".repeat(40), seeders: "1", leechers: "0", size: "1" }]),
    );
    const indexer = new APIBayIndexer(mock.fetchImpl);

    const movie = await indexer.searchByQuery("My Movie", "movie");
    const series = await indexer.searchByQuery("My Show", "series");

    const [firstCall, secondCall] = mock.urls().map((u) => new URL(u));
    expect(firstCall.pathname).toBe("/q.php");
    expect(firstCall.searchParams.get("q")).toBe("My Movie");
    expect(firstCall.searchParams.get("cat")).toBe("207");
    expect(secondCall.searchParams.get("cat")).toBe("208");
    expect(movie).toHaveLength(1);
    expect(series[0]?.infoHash).toBe("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");

    expect(series).toHaveLength(1);
    expect(series[0]?.title).toBe("A");
  });

  it("deduplicates duplicate hashes in query search", async () => {
    const mock = makeMockFetch(() =>
      body([
        {
          id: "1",
          name: "First Copy",
          info_hash: "B".repeat(40),
          seeders: "10",
          leechers: "1",
          size: "11",
        },
        {
          id: "2",
          name: "Second Duplicate",
          info_hash: "b".repeat(40),
          seeders: "9",
          leechers: "2",
          size: "12",
        },
        {
          id: "3",
          name: "Duplicate Skipped",
          info_hash: "B".repeat(40),
          seeders: "20",
          leechers: "3",
          size: "13",
        },
      ]),
    );
    const indexer = new APIBayIndexer(mock.fetchImpl);
    const results = await indexer.searchByQuery("My Query", "movie");

    expect(results).toHaveLength(1);
    expect(results[0]?.infoHash).toBe("b".repeat(40));
  });

  it("falls back to broader categories in query search when the first category has no hits", async () => {
    const mock = makeMockFetch((url) => {
      const params = new URL(url).searchParams;
      if (params.get("cat") === "207") {
        return body([{ name: "No results returned", id: "0", info_hash: "", seeders: "0", leechers: "0", size: "0" }]);
      }
      if (params.get("cat") === "201") {
        return body([
          {
            id: "1",
            name: "Fallback Movie",
            info_hash: "c".repeat(40),
            seeders: "8",
            leechers: "0",
            size: "1",
          },
        ]);
      }
      return body([]);
    });
    const indexer = new APIBayIndexer(mock.fetchImpl);
    const results = await indexer.searchByQuery("my movie", "movie");

    expect(mock.hits()).toBe(2);
    expect(results).toHaveLength(1);
    expect(results[0]?.infoHash).toBe("c".repeat(40));
  });

  it("defaults malformed seeders/leechers/size values to 0", async () => {
    const mock = makeMockFetch(() =>
      body([
        {
          id: "1",
          name: "A",
          info_hash: "f".repeat(40),
          seeders: "NaN",
          leechers: "",
          size: "garbage",
        },
      ]),
    );
    const indexer = new APIBayIndexer(mock.fetchImpl);
    const results = await indexer.searchByQuery("x", "series");

    expect(results).toEqual([]);
  });

  it("skips entries with empty hashes in query search", async () => {
    const mock = makeMockFetch(() =>
      body([
        {
          id: "1",
          name: "Missing hash",
          info_hash: "",
          seeders: "10",
          leechers: "1",
          size: "500",
        },
        {
          id: "2",
          name: "Kept title",
          info_hash: "b".repeat(40),
          seeders: "12",
          leechers: "0",
          size: "100",
        },
      ]),
    );
    const indexer = new APIBayIndexer(mock.fetchImpl);
    const results = await indexer.searchByQuery("q", "movie");

    expect(results).toHaveLength(1);
    expect(results[0]?.infoHash).toBe("b".repeat(40));
  });
});
