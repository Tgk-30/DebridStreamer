// Tests for the Browse data layer: discover-param building, context titles,
// the no-key fixture fallback, sorting, and the page-loading router. All pure
// (the live path uses a tiny fake TMDBService), matching the node test env.

import { describe, expect, it, vi } from "vitest";
import {
  type BrowseContext,
  type BrowseFilters,
  browseTitle,
  buildDiscoverParams,
  emptyBrowseFilters,
  fixtureBrowsePage,
  hasActiveFilters,
  loadBrowsePage,
  sortPreviews,
  toDiscoverFilters,
} from "./browse";
import { SortOption } from "../services/metadata/types";
import type { MediaPreview } from "../models/media";
import type { TMDBService } from "../services/metadata/TMDBService";

function filters(partial: Partial<BrowseFilters> = {}): BrowseFilters {
  return { ...emptyBrowseFilters(), ...partial };
}

function preview(partial: Partial<MediaPreview>): MediaPreview {
  return {
    id: partial.id ?? "tmdb-1",
    type: partial.type ?? "movie",
    title: partial.title ?? "Movie",
    year: partial.year ?? 2020,
    imdbRating: partial.imdbRating ?? 7,
  };
}

describe("buildDiscoverParams", () => {
  it("always sets page, sort, language, adult", () => {
    const p = buildDiscoverParams("movie", emptyBrowseFilters(), 3);
    expect(p.page).toBe("3");
    expect(p.sort_by).toBe(SortOption.popularityDesc);
    expect(p.language).toBe("en-US");
    expect(p.include_adult).toBe("false");
  });

  it("joins multi-genre with a comma (AND semantics)", () => {
    const p = buildDiscoverParams("movie", filters({ genreIds: [28, 12] }), 1);
    expect(p.with_genres).toBe("28,12");
  });

  it("maps a movie year range to primary_release_date bounds", () => {
    const p = buildDiscoverParams(
      "movie",
      filters({ yearGTE: 2000, yearLTE: 2010 }),
      1,
    );
    expect(p["primary_release_date.gte"]).toBe("2000-01-01");
    expect(p["primary_release_date.lte"]).toBe("2010-12-31");
  });

  it("maps a TV year range to first_air_date bounds", () => {
    const p = buildDiscoverParams("series", filters({ yearGTE: 2015 }), 1);
    expect(p["first_air_date.gte"]).toBe("2015-01-01");
    expect(p["primary_release_date.gte"]).toBeUndefined();
  });

  it("sets a default vote floor with a rating filter, overridable by minVotes", () => {
    const a = buildDiscoverParams("movie", filters({ minRating: 7 }), 1);
    expect(a["vote_average.gte"]).toBe("7");
    expect(a["vote_count.gte"]).toBe("50");

    const b = buildDiscoverParams(
      "movie",
      filters({ minRating: 7, minVotes: 500 }),
      1,
    );
    expect(b["vote_count.gte"]).toBe("500");
  });

  it("passes runtime and original-language when set", () => {
    const p = buildDiscoverParams(
      "movie",
      filters({ runtimeLTE: 120, originalLanguage: "ja" }),
      1,
    );
    expect(p["with_runtime.lte"]).toBe("120");
    expect(p.with_original_language).toBe("ja");
  });

  it("omits empty optional params", () => {
    const p = buildDiscoverParams("movie", emptyBrowseFilters(), 1);
    expect(p.with_genres).toBeUndefined();
    expect(p["vote_average.gte"]).toBeUndefined();
    expect(p["with_runtime.lte"]).toBeUndefined();
    expect(p.with_original_language).toBeUndefined();
  });
});

describe("hasActiveFilters", () => {
  it("is false for a blank draft", () => {
    expect(hasActiveFilters(emptyBrowseFilters())).toBe(false);
  });
  it("is true once any field constrains", () => {
    expect(hasActiveFilters(filters({ genreIds: [1] }))).toBe(true);
    expect(hasActiveFilters(filters({ minRating: 6 }))).toBe(true);
    expect(hasActiveFilters(filters({ sortBy: SortOption.ratingDesc }))).toBe(
      true,
    );
  });
});

describe("toDiscoverFilters", () => {
  it("narrows to the core discover fields (first genre, year, rating, sort)", () => {
    const df = toDiscoverFilters(
      filters({
        genreIds: [28, 12],
        yearGTE: 1999,
        minRating: 8,
        sortBy: SortOption.ratingDesc,
      }),
      2,
    );
    expect(df.genreId).toBe(28);
    expect(df.year).toBe(1999);
    expect(df.minRating).toBe(8);
    expect(df.sortBy).toBe(SortOption.ratingDesc);
    expect(df.page).toBe(2);
  });
});

describe("browseTitle", () => {
  it("titles each context kind in sentence case", () => {
    expect(
      browseTitle({ kind: "category", type: "movie", category: "popular" }),
    ).toBe("Popular movies");
    expect(
      browseTitle({ kind: "category", type: "series", category: "trending" }),
    ).toBe("Trending TV");
    expect(
      browseTitle({
        kind: "genre",
        type: "movie",
        genreId: 28,
        genreName: "Action",
      }),
    ).toBe("Action movies");
    expect(
      browseTitle({ kind: "search", type: null, query: "dune" }),
    ).toContain("dune");
    expect(
      browseTitle({
        kind: "discover",
        type: "movie",
        filters: emptyBrowseFilters(),
      }),
    ).toBe("Discover movies");
  });
});

describe("sortPreviews", () => {
  const items = [
    preview({ id: "a", title: "Beta", year: 2010, imdbRating: 6 }),
    preview({ id: "b", title: "Alpha", year: 2020, imdbRating: 9 }),
    preview({ id: "c", title: "Gamma", year: 2000, imdbRating: 7 }),
  ];

  it("sorts by rating desc/asc", () => {
    expect(sortPreviews(items, SortOption.ratingDesc).map((i) => i.id)).toEqual([
      "b",
      "c",
      "a",
    ]);
    expect(sortPreviews(items, SortOption.ratingAsc).map((i) => i.id)).toEqual([
      "a",
      "c",
      "b",
    ]);
  });

  it("sorts by release date and title", () => {
    expect(
      sortPreviews(items, SortOption.releaseDateDesc).map((i) => i.id),
    ).toEqual(["b", "a", "c"]);
    expect(sortPreviews(items, SortOption.titleAsc).map((i) => i.title)).toEqual(
      ["Alpha", "Beta", "Gamma"],
    );
  });

  it("keeps source order for popularity and does not mutate the input", () => {
    const original = items.map((i) => i.id);
    expect(sortPreviews(items, SortOption.popularityDesc).map((i) => i.id)).toEqual(
      original,
    );
    expect(items.map((i) => i.id)).toEqual(original);
  });
});

describe("fixtureBrowsePage", () => {
  it("filters fixtures to the context's media type for a category", () => {
    const page = fixtureBrowsePage({
      kind: "category",
      type: "series",
      category: "popular",
    });
    expect(page.items.length).toBeGreaterThan(0);
    expect(page.items.every((i) => i.type === "series")).toBe(true);
    expect(page.totalPages).toBe(1);
  });

  it("matches a free-text search against fixture titles", () => {
    const page = fixtureBrowsePage({
      kind: "search",
      type: null,
      query: "matrix",
    });
    expect(page.items.some((i) => i.title.toLowerCase().includes("matrix"))).toBe(
      true,
    );
    expect(page.items.every((i) => i.title.toLowerCase().includes("matrix"))).toBe(
      true,
    );
  });

  it("applies discover rating/sort to the fixture corpus", () => {
    const page = fixtureBrowsePage({
      kind: "discover",
      type: "movie",
      filters: filters({ minRating: 8.5, sortBy: SortOption.ratingDesc }),
    });
    expect(page.items.every((i) => (i.imdbRating ?? 0) >= 8.5)).toBe(true);
    // Sorted descending by rating.
    const ratings = page.items.map((i) => i.imdbRating ?? 0);
    expect([...ratings].sort((a, b) => b - a)).toEqual(ratings);
  });

  it("dedups titles that appear in multiple fixture rails", () => {
    const page = fixtureBrowsePage({
      kind: "category",
      type: "movie",
      category: "popular",
    });
    const ids = page.items.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("loadBrowsePage routing", () => {
  function fakeService() {
    const result = (page: number) => ({
      items: [preview({ id: `p${page}` })],
      page,
      totalPages: 5,
      totalResults: 100,
    });
    return {
      getTrending: vi.fn(async (_t, _w, page = 1) => result(page)),
      getCategory: vi.fn(async (_c, _t, page = 1) => result(page)),
      search: vi.fn(async (_q, _t, page = 1) => result(page)),
      discover: vi.fn(async (_t, f) => result(f.page)),
      discoverWithParams: vi.fn(async (_t, params) =>
        result(Number(params.page)),
      ),
    } as unknown as TMDBService & Record<string, ReturnType<typeof vi.fn>>;
  }

  it("routes trending categories to getTrending", async () => {
    const svc = fakeService();
    const ctx: BrowseContext = {
      kind: "category",
      type: "movie",
      category: "trending",
    };
    const page = await loadBrowsePage(svc, ctx, 2);
    expect((svc.getTrending as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith(
      "movie",
      "week",
      2,
    );
    expect(page.totalPages).toBe(5);
  });

  it("routes named categories to getCategory", async () => {
    const svc = fakeService();
    await loadBrowsePage(svc, { kind: "category", type: "movie", category: "top_rated" }, 1);
    expect(svc.getCategory).toHaveBeenCalledWith("top_rated", "movie", 1);
  });

  it("routes a genre context through discover", async () => {
    const svc = fakeService();
    await loadBrowsePage(
      svc,
      { kind: "genre", type: "movie", genreId: 28, genreName: "Action" },
      1,
    );
    expect(svc.discover).toHaveBeenCalledWith(
      "movie",
      expect.objectContaining({ genreId: 28, page: 1 }),
    );
  });

  it("routes a search context to search with the page", async () => {
    const svc = fakeService();
    await loadBrowsePage(svc, { kind: "search", type: "movie", query: "x" }, 3);
    expect(svc.search).toHaveBeenCalledWith("x", "movie", 3);
  });

  it("routes a discover context through discoverWithParams", async () => {
    const svc = fakeService();
    await loadBrowsePage(
      svc,
      { kind: "discover", type: "movie", filters: filters({ genreIds: [18] }) },
      4,
    );
    expect(svc.discoverWithParams).toHaveBeenCalledWith(
      "movie",
      expect.objectContaining({ page: "4", with_genres: "18" }),
    );
  });
});
