// Mirrors the Swift TMDBService tests:
//  - Tests/.../TMDBServiceNetworkTests.swift (request shape, 401 mapping)
//  - Tests/.../TMDBCacheAndCreditsTests.swift (getCast, getRecommendations, TTL cache)
//  - Tests/.../TMDBServiceTests.swift (toMediaPreview / toMediaItem mapping)
//
// The Swift tests stub the network with a MockURLProtocol handler keyed per
// session, counting hits to prove a memoized read issues exactly one request.
// Here we inject a `FetchImpl` stub that plays the same role: it captures the
// requested URL and counts calls.

import { describe, expect, it } from "vitest";
import { type FetchImpl, TMDBService } from "./TMDBService";

// MARK: - fetch stub (mirrors MockURLProtocol + makeMockSession)

interface MockResponse {
  status: number;
  body: string;
}

interface MockFetch {
  fetchImpl: FetchImpl;
  /** The last URL requested, parsed. */
  lastURL: () => URL | null;
  /** Number of times the stub was invoked. */
  hits: () => number;
}

/** Builds a fetch stub from a handler `(url) => MockResponse`. */
function makeMockFetch(handler: (url: URL) => MockResponse): MockFetch {
  let count = 0;
  let captured: URL | null = null;
  const fetchImpl: FetchImpl = async (url) => {
    count += 1;
    const parsed = new URL(url);
    captured = parsed;
    const { status, body } = handler(parsed);
    return {
      status,
      text: async () => body,
    };
  };
  return {
    fetchImpl,
    lastURL: () => captured,
    hits: () => count,
  };
}

const ok = (body: string): MockResponse => ({ status: 200, body });
const serverError = (body: string): MockResponse => ({ status: 500, body });

// MARK: - Canned JSON (same shapes as the Swift tests)

const searchBody = JSON.stringify({
  page: 1,
  results: [
    {
      id: 550,
      title: "Fight Club",
      media_type: "movie",
      overview: "desc",
      poster_path: "/fc.jpg",
      backdrop_path: "/fc-backdrop.jpg",
      release_date: "1999-10-15",
      vote_average: 8.4,
    },
  ],
  total_pages: 1,
  total_results: 1,
});

const creditsBody = JSON.stringify({
  id: 550,
  cast: [
    {
      id: 819,
      name: "Edward Norton",
      character: "The Narrator",
      profile_path: "/norton.jpg",
    },
    {
      id: 287,
      name: "Brad Pitt",
      character: "Tyler Durden",
      profile_path: "/pitt.jpg",
    },
  ],
});

const recommendationsBody = JSON.stringify({
  page: 1,
  results: [
    {
      id: 807,
      title: "Se7en",
      media_type: "movie",
      overview: "Two detectives hunt a serial killer.",
      poster_path: "/se7en.jpg",
      release_date: "1995-09-22",
      vote_average: 8.4,
    },
    {
      id: 1422,
      title: "The Departed",
      media_type: "movie",
      overview: "An undercover cop and a mole.",
      poster_path: "/departed.jpg",
      release_date: "2006-10-06",
      vote_average: 8.2,
    },
  ],
  total_pages: 1,
  total_results: 2,
});

const movieDetailBody = JSON.stringify({
  id: 12345,
  title: "Test Movie",
  overview: "Great movie",
  poster_path: "/poster.jpg",
  backdrop_path: "/backdrop.jpg",
  release_date: "2024-06-15",
  vote_average: 8.5,
  runtime: 142,
  status: "Released",
  genres: [
    { id: 28, name: "Action" },
    { id: 35, name: "Comedy" },
  ],
  external_ids: { imdb_id: "tt1234567", tvdb_id: null },
});

const tvDetailBody = JSON.stringify({
  id: 54321,
  name: "Test Show",
  overview: "Good show",
  first_air_date: "2023-03-20",
  vote_average: 9.1,
  episode_run_time: [45],
  status: "Returning Series",
  genres: [{ id: 18, name: "Drama" }],
  external_ids: { imdb_id: null, tvdb_id: null },
});

// MARK: - Network request shape + decoding (TMDBServiceNetworkTests)

describe("TMDBService search", () => {
  it("builds correct query parameters and decodes results (incl. backdropPath)", async () => {
    const mock = makeMockFetch(() => ok(searchBody));
    const service = new TMDBService("tmdb-key", mock.fetchImpl);

    const result = await service.search("fight club", "movie", 1);

    expect(result.items.length).toBe(1);
    expect(result.items[0].title).toBe("Fight Club");
    expect(result.items[0].type).toBe("movie");
    expect(result.items[0].year).toBe(1999);
    expect(result.items[0].tmdbId).toBe(550);
    expect(result.items[0].posterPath).toBe("/fc.jpg");
    expect(result.items[0].backdropPath).toBe("/fc-backdrop.jpg");
    expect(result.items[0].imdbRating).toBe(8.4);

    const url = mock.lastURL();
    expect(url).not.toBeNull();
    expect(url!.pathname).toBe("/3/search/movie");
    const query = url!.search;
    expect(query).toContain("query=fight+club");
    expect(query).toContain("api_key=tmdb-key");
    expect(query).toContain("include_adult=false");
    expect(query).toContain("page=1");
  });

  it("maps HTTP 401 to an unauthorized error", async () => {
    const mock = makeMockFetch(() => ({ status: 401, body: "{}" }));
    const service = new TMDBService("bad-key", mock.fetchImpl);

    await expect(service.search("test", "movie", 1)).rejects.toMatchObject({
      kind: "unauthorized",
    });
  });
});

// MARK: - getTrending / getCategory / discover decode into MediaPreview

describe("TMDBService catalog reads decode into MediaPreview", () => {
  it("getTrending hits the trending path and decodes previews", async () => {
    const mock = makeMockFetch(() => ok(searchBody));
    const service = new TMDBService("tmdb-key", mock.fetchImpl);

    const result = await service.getTrending("movie", "week", 1);
    expect(result.items[0].backdropPath).toBe("/fc-backdrop.jpg");
    expect(mock.lastURL()!.pathname).toBe("/3/trending/movie/week");
  });

  it("getCategory hits the category path", async () => {
    const mock = makeMockFetch(() => ok(searchBody));
    const service = new TMDBService("tmdb-key", mock.fetchImpl);

    await service.getCategory("top_rated", "movie", 1);
    expect(mock.lastURL()!.pathname).toBe("/3/movie/top_rated");
  });

  it("discover applies filters and hits the discover path", async () => {
    const mock = makeMockFetch(() => ok(searchBody));
    const service = new TMDBService("tmdb-key", mock.fetchImpl);

    await service.discover("movie", {
      genreId: 28,
      year: 1999,
      minRating: 8,
      sortBy: "vote_average.desc",
      page: 2,
    });

    const url = mock.lastURL()!;
    expect(url.pathname).toBe("/3/discover/movie");
    expect(url.searchParams.get("with_genres")).toBe("28");
    expect(url.searchParams.get("primary_release_year")).toBe("1999");
    expect(url.searchParams.get("vote_average.gte")).toBe("8");
    expect(url.searchParams.get("vote_count.gte")).toBe("100");
    expect(url.searchParams.get("sort_by")).toBe("vote_average.desc");
    expect(url.searchParams.get("page")).toBe("2");
  });

  it("discoverWithParams forwards a raw param map to the discover path", async () => {
    const mock = makeMockFetch(() => ok(searchBody));
    const service = new TMDBService("tmdb-key", mock.fetchImpl);

    const result = await service.discoverWithParams("series", {
      page: "3",
      sort_by: "popularity.desc",
      with_genres: "18,80",
      "first_air_date.gte": "2015-01-01",
      "vote_count.gte": "500",
      with_original_language: "ko",
    });

    const url = mock.lastURL()!;
    expect(url.pathname).toBe("/3/discover/tv");
    expect(url.searchParams.get("with_genres")).toBe("18,80");
    expect(url.searchParams.get("first_air_date.gte")).toBe("2015-01-01");
    expect(url.searchParams.get("vote_count.gte")).toBe("500");
    expect(url.searchParams.get("with_original_language")).toBe("ko");
    expect(url.searchParams.get("page")).toBe("3");
    expect(result.items).toHaveLength(1);
  });

  it("discoverWithParams memoizes identical param maps", async () => {
    const mock = makeMockFetch(() => ok(searchBody));
    const service = new TMDBService("tmdb-key", mock.fetchImpl);

    const params = { page: "1", sort_by: "popularity.desc", with_genres: "28" };
    await service.discoverWithParams("movie", params);
    await service.discoverWithParams("movie", { ...params });
    expect(mock.hits()).toBe(1);
  });
});

// MARK: - getDetail mapping (TMDBDetailResponseTests + getDetail path)

describe("TMDBService getDetail", () => {
  it("maps a movie detail into MediaItem using the IMDB id, runtime, genres", async () => {
    const mock = makeMockFetch(() => ok(movieDetailBody));
    const service = new TMDBService("tmdb-key", mock.fetchImpl);

    const item = await service.getDetail("tmdb-12345", "movie");

    expect(item.id).toBe("tt1234567"); // Uses IMDB ID
    expect(item.title).toBe("Test Movie");
    expect(item.year).toBe(2024);
    expect(item.runtime).toBe(142);
    expect(item.genres).toEqual(["Action", "Comedy"]);
    expect(item.imdbRating).toBe(8.5);
    expect(item.tmdbId).toBe(12345);
    expect(item.backdropPath).toBe("/backdrop.jpg");

    const url = mock.lastURL()!;
    expect(url.pathname).toBe("/3/movie/12345");
    expect(url.searchParams.get("append_to_response")).toBe("external_ids");
  });

  it("falls back to tmdb-{id} when there is no IMDB id, and uses episode runtime for TV", async () => {
    const mock = makeMockFetch(() => ok(tvDetailBody));
    const service = new TMDBService("tmdb-key", mock.fetchImpl);

    const item = await service.getDetail("54321", "series");

    expect(item.id).toBe("tmdb-54321"); // no imdb id -> tmdb fallback
    expect(item.runtime).toBe(45); // episode_run_time[0]
    expect(item.year).toBe(2023);
    expect(item.status).toBe("Returning Series");
    expect(mock.lastURL()!.pathname).toBe("/3/tv/54321");
  });
});

// MARK: - getCast decoding (TMDBServiceGetCastTests)

describe("TMDBService getCast", () => {
  it("decodes cast name/character and builds the w185 profile URL", async () => {
    const mock = makeMockFetch(() => ok(creditsBody));
    const service = new TMDBService("tmdb-key", mock.fetchImpl);

    const cast = await service.getCast(550, "movie");

    expect(cast.length).toBe(2);
    expect(cast[0].id).toBe(819);
    expect(cast[0].name).toBe("Edward Norton");
    expect(cast[0].character).toBe("The Narrator");
    expect(cast[0].profileURL).toBe(
      "https://image.tmdb.org/t/p/w185/norton.jpg",
    );
    expect(cast[1].name).toBe("Brad Pitt");
    expect(cast[1].character).toBe("Tyler Durden");
    expect(cast[1].profileURL).toBe("https://image.tmdb.org/t/p/w185/pitt.jpg");

    expect(mock.lastURL()!.pathname).toBe("/3/movie/550/credits");
  });

  it("maps a missing character to '' and a null profile to a null URL", async () => {
    const body = JSON.stringify({
      id: 1399,
      cast: [{ id: 12, name: "No Character Actor", profile_path: null }],
    });
    const mock = makeMockFetch(() => ok(body));
    const service = new TMDBService("tmdb-key", mock.fetchImpl);

    const cast = await service.getCast(1399, "series");

    expect(cast[0].character).toBe("");
    expect(cast[0].profileURL).toBeNull();
  });

  it("uses the tv path segment for series", async () => {
    const mock = makeMockFetch(() => ok(JSON.stringify({ id: 1399, cast: [] })));
    const service = new TMDBService("tmdb-key", mock.fetchImpl);

    const cast = await service.getCast(1399, "series");

    expect(cast.length).toBe(0);
    expect(mock.lastURL()!.pathname).toBe("/3/tv/1399/credits");
  });
});

// MARK: - getRecommendations decoding (TMDBServiceGetRecommendationsTests)

describe("TMDBService getRecommendations", () => {
  it("decodes paged results into a MediaPreview list", async () => {
    const mock = makeMockFetch(() => ok(recommendationsBody));
    const service = new TMDBService("tmdb-key", mock.fetchImpl);

    const previews = await service.getRecommendations(550, "movie");

    expect(previews.length).toBe(2);
    expect(previews[0].id).toBe("tmdb-807");
    expect(previews[0].tmdbId).toBe(807);
    expect(previews[0].title).toBe("Se7en");
    expect(previews[0].type).toBe("movie");
    expect(previews[0].year).toBe(1995);
    expect(previews[0].posterPath).toBe("/se7en.jpg");
    expect(previews[0].imdbRating).toBe(8.4);
    expect(previews[1].title).toBe("The Departed");
    expect(previews[1].year).toBe(2006);

    const url = mock.lastURL()!;
    expect(url.pathname).toBe("/3/movie/550/recommendations");
    expect(url.search).toContain("page=1");
  });
});

// MARK: - TTL response cache (TMDBServiceResponseCacheTests)

describe("TMDBService TTL response cache", () => {
  it("getCast memoizes within TTL — second read served from cache, no extra network hit", async () => {
    // First hit returns valid credits; any subsequent hit returns a 500 that
    // would throw if a second network read actually occurred.
    const mock = makeMockFetch(() =>
      mock.hits() === 1 ? ok(creditsBody) : serverError('{"error":"boom"}'),
    );
    const service = new TMDBService("tmdb-key", mock.fetchImpl);

    const first = await service.getCast(550, "movie");
    expect(first.length).toBe(2);
    expect(mock.hits()).toBe(1);

    const second = await service.getCast(550, "movie");
    expect(second).toEqual(first);
    expect(mock.hits()).toBe(1); // NOT hit a second time
    expect(second[0].name).toBe("Edward Norton");
  });

  it("getRecommendations memoizes within TTL — cached value persists when stub later errors", async () => {
    const mock = makeMockFetch(() =>
      mock.hits() === 1 ? ok(recommendationsBody) : serverError("{}"),
    );
    const service = new TMDBService("tmdb-key", mock.fetchImpl);

    const first = await service.getRecommendations(550, "movie");
    expect(first.length).toBe(2);
    expect(mock.hits()).toBe(1);

    const second = await service.getRecommendations(550, "movie");
    expect(second).toEqual(first);
    expect(mock.hits()).toBe(1);
    expect(second[0].title).toBe("Se7en");
  });

  it("is keyed per request — distinct tmdbIds each hit the network", async () => {
    const mock = makeMockFetch(() => ok(JSON.stringify({ id: 0, cast: [] })));
    const service = new TMDBService("tmdb-key", mock.fetchImpl);

    await service.getCast(1, "movie");
    await service.getCast(2, "movie");
    expect(mock.hits()).toBe(2); // two distinct keys -> two hits

    await service.getCast(1, "movie");
    expect(mock.hits()).toBe(2); // repeat of first id served from cache
  });

  it("genres use a long TTL and are also memoized", async () => {
    const genresBody = JSON.stringify({
      genres: [
        { id: 28, name: "Action" },
        { id: 35, name: "Comedy" },
      ],
    });
    const mock = makeMockFetch(() =>
      mock.hits() === 1 ? ok(genresBody) : serverError("{}"),
    );
    const service = new TMDBService("tmdb-key", mock.fetchImpl);

    const first = await service.getGenres("movie");
    expect(first).toEqual([
      { id: 28, name: "Action" },
      { id: 35, name: "Comedy" },
    ]);
    expect(mock.lastURL()!.pathname).toBe("/3/genre/movie/list");

    const second = await service.getGenres("movie");
    expect(second).toEqual(first);
    expect(mock.hits()).toBe(1);
  });
});
