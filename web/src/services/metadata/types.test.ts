// Unit tests for the metadata value-type helpers in ./types.ts:
//  - SortOption enum-object (displayName, allCases, constants)
//  - makeDiscoverFilters (memberwise-init defaults + null coalescing)
//  - TrendingWindow constants
//  - MediaCategory enum-object (displayName, categories, constants)
//  - TMDBError factory methods (kind / message / statusCode mapping)
//
// The module is otherwise type-only; we exercise every runtime branch.

import { describe, expect, it } from "vitest";
import { MediaType } from "../../models/media";
import {
  makeDiscoverFilters,
  MediaCategory,
  SortOption,
  TMDBError,
  TrendingWindow,
} from "./types";

// MARK: - SortOption

describe("SortOption", () => {
  it("exposes the expected string constants", () => {
    expect(SortOption.popularityDesc).toBe("popularity.desc");
    expect(SortOption.popularityAsc).toBe("popularity.asc");
    expect(SortOption.ratingDesc).toBe("vote_average.desc");
    expect(SortOption.ratingAsc).toBe("vote_average.asc");
    expect(SortOption.releaseDateDesc).toBe("primary_release_date.desc");
    expect(SortOption.releaseDateAsc).toBe("primary_release_date.asc");
    expect(SortOption.titleAsc).toBe("title.asc");
  });

  describe("displayName", () => {
    const cases: Array<[Parameters<typeof SortOption.displayName>[0], string]> =
      [
        ["popularity.desc", "Most Popular"],
        ["popularity.asc", "Least Popular"],
        ["vote_average.desc", "Highest Rated"],
        ["vote_average.asc", "Lowest Rated"],
        ["primary_release_date.desc", "Newest"],
        ["primary_release_date.asc", "Oldest"],
        ["title.asc", "Title A-Z"],
      ];

    it.each(cases)("maps %s -> %s", (option, label) => {
      expect(SortOption.displayName(option)).toBe(label);
    });

    it("covers every allCases value with a display name", () => {
      for (const option of SortOption.allCases()) {
        expect(typeof SortOption.displayName(option)).toBe("string");
        expect(SortOption.displayName(option).length).toBeGreaterThan(0);
      }
    });
  });

  describe("allCases", () => {
    it("returns all seven options in declaration order", () => {
      expect(SortOption.allCases()).toEqual([
        "popularity.desc",
        "popularity.asc",
        "vote_average.desc",
        "vote_average.asc",
        "primary_release_date.desc",
        "primary_release_date.asc",
        "title.asc",
      ]);
    });

    it("returns a fresh array each call (no shared mutable state)", () => {
      const a = SortOption.allCases();
      const b = SortOption.allCases();
      expect(a).not.toBe(b);
      expect(a).toEqual(b);
    });

    it("has no duplicate entries", () => {
      const all = SortOption.allCases();
      expect(new Set(all).size).toBe(all.length);
    });
  });
});

// MARK: - makeDiscoverFilters

describe("makeDiscoverFilters", () => {
  it("applies all defaults when given no partial", () => {
    expect(makeDiscoverFilters()).toEqual({
      genreId: null,
      year: null,
      minRating: null,
      sortBy: SortOption.popularityDesc,
      page: 1,
    });
  });

  it("applies all defaults when given an empty object", () => {
    expect(makeDiscoverFilters({})).toEqual({
      genreId: null,
      year: null,
      minRating: null,
      sortBy: "popularity.desc",
      page: 1,
    });
  });

  it("passes through fully-specified values", () => {
    const result = makeDiscoverFilters({
      genreId: 28,
      year: 2021,
      minRating: 7.5,
      sortBy: SortOption.ratingDesc,
      page: 3,
    });
    expect(result).toEqual({
      genreId: 28,
      year: 2021,
      minRating: 7.5,
      sortBy: "vote_average.desc",
      page: 3,
    });
  });

  it("coalesces explicit null genreId/year/minRating to null", () => {
    const result = makeDiscoverFilters({
      genreId: null,
      year: null,
      minRating: null,
    });
    expect(result.genreId).toBeNull();
    expect(result.year).toBeNull();
    expect(result.minRating).toBeNull();
  });

  it("coalesces explicit undefined fields to defaults", () => {
    const result = makeDiscoverFilters({
      genreId: undefined,
      year: undefined,
      minRating: undefined,
      sortBy: undefined,
      page: undefined,
    });
    expect(result).toEqual({
      genreId: null,
      year: null,
      minRating: null,
      sortBy: "popularity.desc",
      page: 1,
    });
  });

  it("preserves the falsy-but-valid value 0 for numeric fields (?? not ||)", () => {
    const result = makeDiscoverFilters({
      genreId: 0,
      year: 0,
      minRating: 0,
      page: 0,
    });
    expect(result.genreId).toBe(0);
    expect(result.year).toBe(0);
    expect(result.minRating).toBe(0);
    // page 0 is falsy but defined; ?? keeps it (does NOT fall back to 1)
    expect(result.page).toBe(0);
  });

  it("preserves negative numeric values", () => {
    const result = makeDiscoverFilters({
      year: -1,
      minRating: -5,
      genreId: -10,
      page: -2,
    });
    expect(result.year).toBe(-1);
    expect(result.minRating).toBe(-5);
    expect(result.genreId).toBe(-10);
    expect(result.page).toBe(-2);
  });

  it("respects a provided sortBy while defaulting the rest", () => {
    const result = makeDiscoverFilters({ sortBy: SortOption.titleAsc });
    expect(result.sortBy).toBe("title.asc");
    expect(result.page).toBe(1);
    expect(result.genreId).toBeNull();
  });

  it("returns a new object, not the supplied partial", () => {
    const partial = { page: 2 };
    const result = makeDiscoverFilters(partial);
    expect(result).not.toBe(partial);
  });
});

// MARK: - TrendingWindow

describe("TrendingWindow", () => {
  it("exposes day and week constants", () => {
    expect(TrendingWindow.day).toBe("day");
    expect(TrendingWindow.week).toBe("week");
  });
});

// MARK: - MediaCategory

describe("MediaCategory", () => {
  it("exposes the expected string constants", () => {
    expect(MediaCategory.popular).toBe("popular");
    expect(MediaCategory.topRated).toBe("top_rated");
    expect(MediaCategory.nowPlaying).toBe("now_playing");
    expect(MediaCategory.upcoming).toBe("upcoming");
    expect(MediaCategory.airingToday).toBe("airing_today");
    expect(MediaCategory.onTheAir).toBe("on_the_air");
  });

  describe("displayName", () => {
    const cases: Array<
      [Parameters<typeof MediaCategory.displayName>[0], string]
    > = [
      ["popular", "Popular"],
      ["top_rated", "Top Rated"],
      ["now_playing", "Now Playing"],
      ["upcoming", "Upcoming"],
      ["airing_today", "Airing Today"],
      ["on_the_air", "On The Air"],
    ];

    it.each(cases)("maps %s -> %s", (category, label) => {
      expect(MediaCategory.displayName(category)).toBe(label);
    });
  });

  describe("categories", () => {
    it("returns the movie-specific set for 'movie'", () => {
      expect(MediaCategory.categories(MediaType.movie)).toEqual([
        "popular",
        "top_rated",
        "now_playing",
        "upcoming",
      ]);
    });

    it("returns the series-specific set for 'series'", () => {
      expect(MediaCategory.categories(MediaType.series)).toEqual([
        "popular",
        "top_rated",
        "airing_today",
        "on_the_air",
      ]);
    });

    it("returns a display name for every movie category", () => {
      for (const c of MediaCategory.categories("movie")) {
        expect(MediaCategory.displayName(c).length).toBeGreaterThan(0);
      }
    });

    it("returns a display name for every series category", () => {
      for (const c of MediaCategory.categories("series")) {
        expect(MediaCategory.displayName(c).length).toBeGreaterThan(0);
      }
    });

    it("movie and series sets share popular/top_rated but differ otherwise", () => {
      const movie = MediaCategory.categories("movie");
      const series = MediaCategory.categories("series");
      expect(movie).toContain("popular");
      expect(series).toContain("popular");
      expect(movie).toContain("top_rated");
      expect(series).toContain("top_rated");
      expect(movie).not.toEqual(series);
    });
  });
});

// MARK: - TMDBError

describe("TMDBError", () => {
  it("is an Error subclass with name 'TMDBError'", () => {
    const err = TMDBError.invalidResponse();
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(TMDBError);
    expect(err.name).toBe("TMDBError");
  });

  it("invalidURL interpolates the path and sets kind", () => {
    const err = TMDBError.invalidURL("/movie/123");
    expect(err.kind).toBe("invalidURL");
    expect(err.message).toBe("Invalid TMDB URL: /movie/123");
    expect(err.statusCode).toBeUndefined();
  });

  it("invalidURL handles an empty path", () => {
    const err = TMDBError.invalidURL("");
    expect(err.message).toBe("Invalid TMDB URL: ");
  });

  it("invalidResponse has a fixed message and kind", () => {
    const err = TMDBError.invalidResponse();
    expect(err.kind).toBe("invalidResponse");
    expect(err.message).toBe("Invalid response from TMDB");
    expect(err.statusCode).toBeUndefined();
  });

  it("unauthorized has a fixed message and kind", () => {
    const err = TMDBError.unauthorized();
    expect(err.kind).toBe("unauthorized");
    expect(err.message).toBe("Invalid TMDB API key");
    expect(err.statusCode).toBeUndefined();
  });

  it("notFound interpolates the id and sets kind", () => {
    const err = TMDBError.notFound("tt99");
    expect(err.kind).toBe("notFound");
    expect(err.message).toBe("Not found on TMDB: tt99");
    expect(err.statusCode).toBeUndefined();
  });

  it("notFound handles an empty id", () => {
    expect(TMDBError.notFound("").message).toBe("Not found on TMDB: ");
  });

  it("rateLimited has a fixed message and kind", () => {
    const err = TMDBError.rateLimited();
    expect(err.kind).toBe("rateLimited");
    expect(err.message).toBe("TMDB rate limit exceeded. Try again shortly.");
    expect(err.statusCode).toBeUndefined();
  });

  it("httpError records the code in both message and statusCode", () => {
    const err = TMDBError.httpError(503, "Service Unavailable");
    expect(err.kind).toBe("httpError");
    expect(err.message).toBe("TMDB HTTP 503: Service Unavailable");
    expect(err.statusCode).toBe(503);
  });

  it("httpError handles an empty body", () => {
    const err = TMDBError.httpError(500, "");
    expect(err.message).toBe("TMDB HTTP 500: ");
    expect(err.statusCode).toBe(500);
  });

  it("httpError preserves a 0 status code (?? not ||)", () => {
    const err = TMDBError.httpError(0, "weird");
    expect(err.statusCode).toBe(0);
    expect(err.message).toBe("TMDB HTTP 0: weird");
  });

  it("can be thrown and caught as a TMDBError", () => {
    expect(() => {
      throw TMDBError.unauthorized();
    }).toThrow(TMDBError);
    try {
      throw TMDBError.rateLimited();
    } catch (e) {
      expect(e).toBeInstanceOf(TMDBError);
      expect((e as TMDBError).kind).toBe("rateLimited");
    }
  });
});
