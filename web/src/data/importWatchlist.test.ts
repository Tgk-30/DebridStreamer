import { describe, expect, it } from "vitest";
import {
  dedupeEntries,
  parseCsvLine,
  parseImportEntries,
  pickBestMatch,
  resolveEntry,
  type ImportEntry,
} from "./importWatchlist";
import type { MediaPreview } from "../models/media";

function preview(over: Partial<MediaPreview> & { id: string }): MediaPreview {
  return { type: "movie", title: "X", ...over };
}

describe("parseCsvLine", () => {
  it("splits plain fields", () => {
    expect(parseCsvLine("a,b,c")).toEqual(["a", "b", "c"]);
  });
  it("honours quoted fields containing commas and escaped quotes", () => {
    expect(parseCsvLine('tt1,"Dune: Part Two, Extended","a ""quote"""')).toEqual([
      "tt1",
      "Dune: Part Two, Extended",
      'a "quote"',
    ]);
  });
});

describe("parseImportEntries — IMDb CSV", () => {
  it("maps Title / Year / Title Type columns and normalises the type", () => {
    const csv = [
      "Const,Title,Year,Title Type",
      "tt0111161,The Shawshank Redemption,1994,movie",
      "tt0903747,Breaking Bad,2008,tvSeries",
    ].join("\n");
    expect(parseImportEntries(csv)).toEqual([
      { title: "The Shawshank Redemption", year: 1994, type: "movie" },
      { title: "Breaking Bad", year: 2008, type: "series" },
    ]);
  });
});

describe("parseImportEntries — Letterboxd CSV", () => {
  it("maps Name / Year and leaves the type unset", () => {
    const csv = [
      "Date,Name,Year,Letterboxd URI",
      "2024-01-02,Parasite,2019,https://letterboxd.com/film/parasite/",
    ].join("\n");
    expect(parseImportEntries(csv)).toEqual([
      { title: "Parasite", year: 2019, type: null },
    ]);
  });
});

describe("parseImportEntries — plain list", () => {
  it("parses '(year)', ', year', and bare titles, de-duplicating", () => {
    const text = ["The Matrix (1999)", "Dune", "Parasite, 2019", "Dune"].join("\n");
    expect(parseImportEntries(text)).toEqual([
      { title: "The Matrix", year: 1999, type: null },
      { title: "Dune", year: null, type: null },
      { title: "Parasite", year: 2019, type: null },
    ]);
  });
  it("returns nothing for blank input", () => {
    expect(parseImportEntries("   \n\n")).toEqual([]);
  });
});

describe("dedupeEntries", () => {
  it("collapses same title+year (case-insensitive)", () => {
    const entries: ImportEntry[] = [
      { title: "Dune", year: 2021, type: null },
      { title: "dune", year: 2021, type: "movie" },
      { title: "Dune", year: null, type: null },
    ];
    expect(dedupeEntries(entries)).toHaveLength(2);
  });
});

describe("pickBestMatch", () => {
  it("prefers an exact title + year match over a closer-listed result", () => {
    const entry: ImportEntry = { title: "Dune", year: 1984, type: "movie" };
    const best = pickBestMatch(entry, [
      preview({ id: "a", title: "Dune", year: 2021 }),
      preview({ id: "b", title: "Dune", year: 1984 }),
    ]);
    expect(best?.id).toBe("b");
  });
  it("falls back to the first (most-relevant) result when nothing scores", () => {
    const entry: ImportEntry = { title: "Some Obscure Film", year: null, type: null };
    const best = pickBestMatch(entry, [
      preview({ id: "first", title: "Unrelated A" }),
      preview({ id: "second", title: "Unrelated B" }),
    ]);
    expect(best?.id).toBe("first");
  });
  it("returns null when there are no candidates", () => {
    expect(
      pickBestMatch({ title: "x", year: null, type: null }, []),
    ).toBeNull();
  });

  it("adds a bonus for near-year matches when exact year is not present", () => {
    const entry: ImportEntry = { title: "Dune", year: 2000, type: "movie" };
    const best = pickBestMatch(entry, [
      preview({ id: "near", title: "Dune", year: 2001, type: "movie" }),
      preview({ id: "far", title: "Dune", year: 2004, type: "movie" }),
    ]);
    expect(best?.id).toBe("near");
  });
});

describe("resolveEntry", () => {
  it("searches by title and returns the best match", async () => {
    const entry: ImportEntry = { title: "Heat", year: 1995, type: "movie" };
    const search = async (query: string) => {
      expect(query).toBe("Heat");
      return [
        preview({ id: "wrong", title: "Heat", year: 1986 }),
        preview({ id: "right", title: "Heat", year: 1995 }),
      ];
    };
    const match = await resolveEntry(entry, search);
    expect(match?.id).toBe("right");
  });
  it("returns null when the search yields nothing", async () => {
    const match = await resolveEntry(
      { title: "Nope", year: null, type: null },
      async () => [],
    );
    expect(match).toBeNull();
  });

  it("preserves explicit tv/movie hints from IMDb title type", async () => {
    const searchCalls: Array<{ query: string; type: "movie" | "series" | null }> = [];
    const match = await resolveEntry({ title: "Heat", year: 1990, type: "series" }, async (query, type) => {
      searchCalls.push({ query, type });
      return [preview({ id: "series-match", title: "Heat", year: 1990, type: "series" })];
    });
    expect(match?.id).toBe("series-match");
    expect(searchCalls).toEqual([{ query: "Heat", type: "series" }]);
  });
});

describe("parseImportEntries — edge coverage", () => {
  it("accepts IMDb rows with missing year/type columns and dedupes repeated titles", () => {
    const csv = [
      "Const,Title,Year,Title Type",
      "tt1,Duplicate Title,,movie",
      "tt2,,2001,movie",
      "tt3,Duplicate Title,1900,video",
      "tt4,Duplicate Title,1900,movie",
    ].join("\n");

    expect(parseImportEntries(csv)).toEqual([
      { title: "Duplicate Title", year: null, type: "movie" },
      { title: "Duplicate Title", year: 1900, type: "movie" },
    ]);
  });

  it("maps out-of-range parsed years to null in IMDb import mode", () => {
    const csv = [
      "Title,Year,Title Type,Const",
      "Too Far Future,3001,movie,tt9999999",
      "Too Far Past,1000,short,tt8888888",
      "Bad Year,bad,video,tt7777777",
    ].join("\n");
    expect(parseImportEntries(csv)).toEqual([
      { title: "Too Far Future", year: null, type: "movie" },
      { title: "Too Far Past", year: null, type: "movie" },
      { title: "Bad Year", year: null, type: "movie" },
    ]);
  });
});
