// Extra tests for the Browse data layer - covers loadServerBrowsePage, the
// Server Mode page loader the browse.test.ts pure suite and the browse.hook
// test (which only exercises the `category` server route) leave untouched:
// the `genre`, `search`, and `discover` server routes plus their param wiring.

import { describe, expect, it, vi, beforeEach } from "vitest";
import type { MediaPreview } from "../models/media";

// Mock the server API so we can assert the exact request shape per route.
const fetchServerCategory = vi.fn();
const discoverServerMedia = vi.fn();
const searchServerMedia = vi.fn();
vi.mock("../lib/serverApi", () => ({
  fetchServerCategory: (...a: unknown[]) => fetchServerCategory(...a),
  discoverServerMedia: (...a: unknown[]) => discoverServerMedia(...a),
  searchServerMedia: (...a: unknown[]) => searchServerMedia(...a),
}));

import {
  loadServerBrowsePage,
  emptyBrowseFilters,
  type BrowseContext,
} from "./browse";

function preview(id: string): MediaPreview {
  return { id, type: "movie", title: id, year: 2020, imdbRating: 7 };
}

function serverPage(opts: { ids: string[]; page: number; totalPages: number }) {
  return {
    items: opts.ids.map(preview),
    page: opts.page,
    totalPages: opts.totalPages,
    totalResults: opts.ids.length,
  };
}

beforeEach(() => {
  fetchServerCategory.mockReset();
  discoverServerMedia.mockReset();
  searchServerMedia.mockReset();
});

describe("loadServerBrowsePage", () => {
  it("routes a category context through fetchServerCategory and maps the page", async () => {
    fetchServerCategory.mockResolvedValue(
      serverPage({ ids: ["c1"], page: 2, totalPages: 4 }),
    );
    const ctx: BrowseContext = {
      kind: "category",
      type: "movie",
      category: "popular",
    };

    const page = await loadServerBrowsePage(ctx, 2);

    expect(fetchServerCategory).toHaveBeenCalledWith({
      type: "movie",
      category: "popular",
      page: 2,
    });
    expect(page.items.map((i) => i.id)).toEqual(["c1"]);
    expect(page.page).toBe(2);
    expect(page.totalPages).toBe(4);
    expect(page.totalResults).toBe(1);
  });

  it("routes a genre context through discoverServerMedia with a single-genre param set", async () => {
    discoverServerMedia.mockResolvedValue(
      serverPage({ ids: ["g1"], page: 1, totalPages: 1 }),
    );
    const ctx: BrowseContext = {
      kind: "genre",
      type: "series",
      genreId: 35,
      genreName: "Comedy",
    };

    const page = await loadServerBrowsePage(ctx, 3);

    expect(discoverServerMedia).toHaveBeenCalledTimes(1);
    const arg = discoverServerMedia.mock.calls[0][0] as {
      type: string;
      params: Record<string, string>;
    };
    expect(arg.type).toBe("series");
    // buildDiscoverParams(series, {empty, genreIds:[35]}, 3)
    expect(arg.params.with_genres).toBe("35");
    expect(arg.params.page).toBe("3");
    expect(page.items.map((i) => i.id)).toEqual(["g1"]);
  });

  it("routes a search context through searchServerMedia with the query/type/page", async () => {
    searchServerMedia.mockResolvedValue(
      serverPage({ ids: ["s1", "s2"], page: 5, totalPages: 9 }),
    );
    const ctx: BrowseContext = {
      kind: "search",
      type: "movie",
      query: "dune",
    };

    const page = await loadServerBrowsePage(ctx, 5);

    expect(searchServerMedia).toHaveBeenCalledWith({
      query: "dune",
      type: "movie",
      page: 5,
    });
    expect(page.items.map((i) => i.id)).toEqual(["s1", "s2"]);
    expect(page.page).toBe(5);
  });

  it("routes a discover context through discoverServerMedia with the full filter params", async () => {
    discoverServerMedia.mockResolvedValue(
      serverPage({ ids: ["d1"], page: 1, totalPages: 2 }),
    );
    const ctx: BrowseContext = {
      kind: "discover",
      type: "movie",
      filters: {
        ...emptyBrowseFilters(),
        genreIds: [28, 12],
        minRating: 7,
      },
    };

    const page = await loadServerBrowsePage(ctx, 1);

    const arg = discoverServerMedia.mock.calls[0][0] as {
      type: string;
      params: Record<string, string>;
    };
    expect(arg.type).toBe("movie");
    expect(arg.params.with_genres).toBe("28,12");
    expect(arg.params["vote_average.gte"]).toBe("7");
    expect(page.items.map((i) => i.id)).toEqual(["d1"]);
    expect(page.totalPages).toBe(2);
  });
});
