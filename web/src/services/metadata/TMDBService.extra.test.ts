// Extra coverage for src/services/metadata/TMDBService.ts — the branches the
// primary TMDBService.test.ts leaves uncovered:
//  - toMediaPreview's media_type:"tv" case and the title/name fallback,
//  - findByImdbId resolving from tv_results vs movie_results,
//  - the bounded cache eviction path (sweep expired + evict over-capacity),
//  - request() mapping a generic non-2xx (500) status to httpError with body,
//  - constructing the service with no injected fetch (default-fetch branch).
//
// Reuses the FetchImpl-stub pattern from TMDBService.test.ts. TESTS ONLY.

import { describe, expect, it } from "vitest";
import { type FetchImpl, TMDBService } from "./TMDBService";

interface MockFetch {
  fetchImpl: FetchImpl;
  lastURL: () => URL | null;
  hits: () => number;
}

function makeMockFetch(handler: (url: URL) => { status: number; body: string }): MockFetch {
  let count = 0;
  let captured: URL | null = null;
  const fetchImpl: FetchImpl = async (url) => {
    count += 1;
    const parsed = new URL(url);
    captured = parsed;
    const { status, body } = handler(parsed);
    return { status, text: async () => body };
  };
  return { fetchImpl, lastURL: () => captured, hits: () => count };
}

const ok = (body: string) => ({ status: 200, body });

// MARK: - toMediaPreview tv + title/name fallback

describe("TMDBService search preview mapping (tv branches)", () => {
  it("maps a media_type:'tv' result to a series preview using the name field", async () => {
    const body = JSON.stringify({
      page: 1,
      results: [
        { id: 1399, name: "Game of Thrones", media_type: "tv", first_air_date: "2011-04-17" },
      ],
      total_pages: 1,
      total_results: 1,
    });
    const mock = makeMockFetch(() => ok(body));
    const service = new TMDBService("tmdb-key", mock.fetchImpl);

    const result = await service.search("got", null, 1);

    expect(result.items).toHaveLength(1);
    expect(result.items[0].type).toBe("series");
    expect(result.items[0].title).toBe("Game of Thrones");
    expect(result.items[0].year).toBe(2011);
    expect(result.items[0].id).toBe("tmdb-1399");
  });
});

// MARK: - findByImdbId

describe("TMDBService findByImdbId", () => {
  it("returns the first movie result id for a movie lookup", async () => {
    const body = JSON.stringify({
      movie_results: [{ id: 550 }, { id: 999 }],
      tv_results: [],
    });
    const mock = makeMockFetch(() => ok(body));
    const service = new TMDBService("tmdb-key", mock.fetchImpl);

    const id = await service.findByImdbId("tt0137523", "movie");

    expect(id).toBe(550);
    const url = mock.lastURL()!;
    expect(url.pathname).toBe("/3/find/tt0137523");
    expect(url.searchParams.get("external_source")).toBe("imdb_id");
  });

  it("returns the first tv result id for a series lookup", async () => {
    const body = JSON.stringify({
      movie_results: [],
      tv_results: [{ id: 1399 }],
    });
    const mock = makeMockFetch(() => ok(body));
    const service = new TMDBService("tmdb-key", mock.fetchImpl);

    expect(await service.findByImdbId("tt0944947", "series")).toBe(1399);
  });

  it("returns null when the requested result list is empty", async () => {
    const body = JSON.stringify({ movie_results: [], tv_results: [] });
    const mock = makeMockFetch(() => ok(body));
    const service = new TMDBService("tmdb-key", mock.fetchImpl);

    expect(await service.findByImdbId("tt0000000", "movie")).toBeNull();
    expect(await service.findByImdbId("tt0000000", "series")).toBeNull();
  });
});

// MARK: - HTTP error mapping (generic non-2xx)

describe("TMDBService request error mapping", () => {
  it("maps a generic 500 status to an httpError carrying the body", async () => {
    const mock = makeMockFetch(() => ({ status: 500, body: '{"status_message":"boom"}' }));
    const service = new TMDBService("tmdb-key", mock.fetchImpl);

    await expect(service.search("x", "movie", 1)).rejects.toMatchObject({
      kind: "httpError",
      statusCode: 500,
    });
  });

  it("maps a 404 status to a notFound error", async () => {
    const mock = makeMockFetch(() => ({ status: 404, body: "{}" }));
    const service = new TMDBService("tmdb-key", mock.fetchImpl);

    await expect(service.search("x", "movie", 1)).rejects.toMatchObject({
      kind: "notFound",
    });
  });

  it("maps a 429 status to a rateLimited error", async () => {
    const mock = makeMockFetch(() => ({ status: 429, body: "{}" }));
    const service = new TMDBService("tmdb-key", mock.fetchImpl);

    await expect(service.search("x", "movie", 1)).rejects.toMatchObject({
      kind: "rateLimited",
    });
  });
});

// MARK: - Bounded cache eviction

describe("TMDBService cache eviction", () => {
  it("evicts the soonest-to-expire entries once the cache capacity is exceeded", async () => {
    // Each getCast(id) is cached under a distinct key. Filling well past the
    // 256-entry cap forces the store() eviction loop (sweep + over-capacity
    // evict). Then re-reading the very first id must hit the network again,
    // proving its entry was evicted; whereas a recently-cached id stays cached.
    const mock = makeMockFetch((url) => {
      const m = url.pathname.match(/\/movie\/(\d+)\/credits/);
      const id = m ? Number(m[1]) : 0;
      return ok(JSON.stringify({ id, cast: [] }));
    });
    const service = new TMDBService("tmdb-key", mock.fetchImpl);

    for (let id = 1; id <= 300; id += 1) {
      await service.getCast(id, "movie");
    }
    const hitsAfterFill = mock.hits();
    expect(hitsAfterFill).toBe(300);

    // The first id should have been evicted -> a fresh network read.
    await service.getCast(1, "movie");
    expect(mock.hits()).toBe(hitsAfterFill + 1);

    // A recently-cached id (still within capacity) must be served from cache.
    await service.getCast(300, "movie");
    expect(mock.hits()).toBe(hitsAfterFill + 1);
  });
});

// MARK: - Default fetch wiring

describe("TMDBService default fetch wiring", () => {
  it("constructs without an injected fetch (uses the global fetch by default)", () => {
    const service = new TMDBService("tmdb-key");
    expect(service).toBeInstanceOf(TMDBService);
  });
});
