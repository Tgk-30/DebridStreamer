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
    expect(mock.hits()).toBe(1);
  });

  it("drops zero/empty hashes and dead torrents, and parses sizes", async () => {
    const mock = makeMockFetch((url) =>
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
    expect(mock.hits()).toBe(1);
  });

  it("throws badServerResponse for non-2xx", async () => {
    const mock = makeMockFetch(() => ({ status: 500, body: "boom" }));
    const indexer = new APIBayIndexer(mock.fetchImpl);

    await expect(indexer.search("tt1", "movie", null, null)).rejects.toMatchObject({
      kind: "badServerResponse",
      statusCode: 500,
    });
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
    expect(firstCall.searchParams.get("cat")).toBe("201");
    expect(secondCall.searchParams.get("cat")).toBe("205");
    expect(movie).toHaveLength(1);
    expect(series[0]?.infoHash).toBe("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");

    expect(series).toHaveLength(1);
    expect(series[0]?.title).toBe("A");
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
