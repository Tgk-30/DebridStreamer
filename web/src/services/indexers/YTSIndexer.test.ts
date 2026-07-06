import { describe, expect, it } from "vitest";
import { YTSIndexer } from "./YTSIndexer";
import type { FetchImpl } from "./types";

interface MockResponse {
  status: number;
  body: string;
}

interface MockFetch {
  fetchImpl: FetchImpl;
  urls: () => string[];
  hits: () => number;
}

function makeMockFetch(handler: (url: string) => MockResponse): MockFetch {
  const urls: string[] = [];
  let count = 0;
  const fetchImpl: FetchImpl = async (url) => {
    urls.push(url);
    count += 1;
    const { status, body } = handler(url);
    return { status, text: async () => body };
  };
  return {
    fetchImpl,
    urls: () => urls,
    hits: () => count,
  };
}

const ok = (body: string): MockResponse => ({ status: 200, body });

describe("YTSIndexer", () => {
  it("returns [] for non-movie media in both entry points", async () => {
    const mock = makeMockFetch(() => ok('{"data":{"movies":null}}'));
    const indexer = new YTSIndexer(mock.fetchImpl);

    expect(await indexer.search("tt123", "series", null, null)).toEqual([]);
    expect(await indexer.searchByQuery("anything", "series")).toEqual([]);
    expect(mock.hits()).toBe(0);
  });

  it("queries YTS with the right endpoint for search and searchByQuery", async () => {
    const mock = makeMockFetch(() =>
      ok('{"data":{"movies":[{"title_long":"Film X","torrents":[]}]}}'),
    );
    const indexer = new YTSIndexer(mock.fetchImpl);

    await indexer.search("tt1234", "movie", null, null);
    await indexer.searchByQuery("Dune: Part Two", "movie");

    const [searchURL, queryURL] = mock.urls().map((u) => new URL(u));
    expect(searchURL.pathname).toBe("/api/v2/list_movies.json");
    expect(searchURL.searchParams.get("query_term")).toBe("tt1234");
    expect(queryURL.searchParams.get("query_term")).toBe("Dune: Part Two");
    expect(queryURL.searchParams.get("limit")).toBe("20");
  });

  it("throws a badServerResponse error on non-2xx", async () => {
    const mock = makeMockFetch(() => ({ status: 418, body: "teapot" }));
    const indexer = new YTSIndexer(mock.fetchImpl);

    await expect(indexer.search("tt1", "movie", null, null)).rejects.toMatchObject({
      kind: "badServerResponse",
      statusCode: 418,
    });
  });

  it("maps torrents, preserving defaults for missing optional fields", async () => {
    const mock = makeMockFetch(() =>
      ok(
        JSON.stringify({
          data: {
            movie_count: 1,
            movies: [
              {
                title_long: null,
                title: null,
                torrents: [
                  {
                    hash: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                    quality: undefined,
                    type: null,
                    seeds: null,
                    peers: null,
                    size_bytes: null,
                  },
                  {
                    hash: "",
                    quality: "1080p",
                    type: "web",
                    seeds: 12,
                    peers: 3,
                    size_bytes: 111,
                  },
                ],
              },
            ],
          },
        }),
      ),
    );

    const indexer = new YTSIndexer(mock.fetchImpl);
    const results = await indexer.search("tt9", "movie", null, null);

    expect(results).toHaveLength(1);
    expect(results[0]?.title).toBe("Unknown [?] []");
    expect(results[0]?.sizeBytes).toBe(0);
    expect(results[0]?.seeders).toBe(0);
    expect(results[0]?.leechers).toBe(0);
    expect(results[0]?.indexerName).toBe("YTS");
  });

  it("returns [] when movies are missing or empty", async () => {
    const mock = makeMockFetch(() => ok('{"data":{"movies":null}}'));
    const indexer = new YTSIndexer(mock.fetchImpl);
    expect(await indexer.search("tt0", "movie", null, null)).toEqual([]);
    expect(await indexer.searchByQuery("missing", "movie")).toEqual([]);
  });

  it("skips movie entries that have no torrent array", async () => {
    const mock = makeMockFetch(() =>
      ok(
        JSON.stringify({
          data: {
            movie_count: 2,
            movies: [
              { title: "No Torrents", title_long: "No Torrents", torrents: null },
              {
                title: "Has Torrent",
                torrents: [{ hash: "feedface", quality: "720p", type: "web" }],
              },
            ],
          },
        }),
      ),
    );
    const indexer = new YTSIndexer(mock.fetchImpl);

    const results = await indexer.search("tt9", "movie", null, null);
    expect(results).toHaveLength(1);
    expect(results[0]?.title).toBe("Has Torrent [720p] [web]");
  });
});
