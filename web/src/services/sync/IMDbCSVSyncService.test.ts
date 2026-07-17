// Mirrors the DB-free assertions of
//   Tests/DebridStreamerTests/Services/Sync/IMDbCSVSyncServiceTests.swift
// and adds focused coverage for the pure parse/slug/fallback-id logic.
//
// The Swift import/export-with-database tests (importIdempotent,
// watchlistImportUsesRoot, exportFolderTreeCSV) exercise a `DatabaseManager`
// that is not yet ported to web, so the DB orchestration in `importCSV`/
// `exportCSV(database:)` is OMITTED from the port. Here we test the pure pieces
// those methods are built on: `parseCSV`, `normalizedSlug`, `fallbackMediaID`
// (the synthesized dedup key), and `exportCSV(mediaItems:)`. The slug/export
// canned data is reused verbatim from the Swift tests.

import { describe, expect, it } from "vitest";
import type { MediaItem } from "../../models/media";
import { IMDbCSVSyncService } from "./IMDbCSVSyncService";

function makeMedia(id: string, title: string, year: number | null): MediaItem {
  return {
    id,
    type: "movie",
    title,
    year,
    genres: [],
    lastFetched: new Date().toISOString(),
  };
}

// MARK: - normalizedSlug (normalizedSlugHelper)

describe("IMDbCSVSyncService.normalizedSlug", () => {
  it("collapses punctuation and strips diacritics", () => {
    const service = new IMDbCSVSyncService();
    expect(service.normalizedSlug("Amélie: Le Café!")).toBe("amelie-le-cafe");
    expect(service.normalizedSlug("  Spaced   Out  ")).toBe("spaced-out");
    expect(service.normalizedSlug("WALL·E")).toBe("wall-e");
  });
});

// MARK: - exportCSV(mediaItems:) (exportCSV)

describe("IMDbCSVSyncService.exportCSV", () => {
  it("emits CSV with the Const,Title,Year header and rows", () => {
    const service = new IMDbCSVSyncService();
    const output = service.exportCSV([
      makeMedia("tt123", "Movie A", 2024),
      makeMedia("tt456", "Movie B", 2025),
    ]);

    expect(output).toContain("Const,Title,Year");
    expect(output).toContain("tt123,Movie A,2024");
    expect(output).toContain("tt456,Movie B,2025");
  });

  it("emits an empty Year cell when year is null", () => {
    const service = new IMDbCSVSyncService();
    const output = service.exportCSV([makeMedia("tt789", "No Year", null)]);
    expect(output).toContain("tt789,No Year,");
  });

  it("quotes cells containing commas (round-trip safe)", () => {
    const service = new IMDbCSVSyncService();
    const output = service.exportCSV([makeMedia("tt1", "Hello, World", 2000)]);
    expect(output).toContain('tt1,"Hello, World",2000');
  });
});

// MARK: - parseCSV

describe("IMDbCSVSyncService.parseCSV", () => {
  it("reads Const/Title/Year case-insensitively and trims cells", () => {
    const service = new IMDbCSVSyncService();
    const csv = ["Const,Title,Year", "tt1234567,Example Movie,2026"].join("\n");

    const entries = service.parseCSV(csv, "favorites");
    expect(entries.length).toBe(1);
    expect(entries[0]).toEqual({
      imdbID: "tt1234567",
      title: "Example Movie",
      year: 2026,
      listType: "favorites",
    });
  });

  it("skips rows with an empty title", () => {
    const service = new IMDbCSVSyncService();
    const csv = ["Const,Title,Year", "tt1,,2020", "tt2,Real Movie,2021"].join(
      "\n",
    );

    const entries = service.parseCSV(csv, "watchlist");
    expect(entries.length).toBe(1);
    expect(entries[0].title).toBe("Real Movie");
  });

  it("treats a missing Const cell as a null imdbID", () => {
    const service = new IMDbCSVSyncService();
    const csv = ["Title,Year", "Amélie: Le Café!,2001"].join("\n");

    const entries = service.parseCSV(csv, "favorites");
    expect(entries.length).toBe(1);
    expect(entries[0].imdbID).toBeNull();
    expect(entries[0].title).toBe("Amélie: Le Café!");
    expect(entries[0].year).toBe(2001);
  });

  it("returns [] for empty input (no header)", () => {
    const service = new IMDbCSVSyncService();
    expect(service.parseCSV("", "favorites")).toEqual([]);
  });

  it("returns [] when the header has no title column", () => {
    const service = new IMDbCSVSyncService();
    const csv = ["Const,Year", "tt1,2026"].join("\n");

    expect(service.parseCSV(csv, "watchlist")).toEqual([]);
  });

  it("treats an empty Const cell as a null imdbID", () => {
    const service = new IMDbCSVSyncService();
    const csv = ["Const,Title,Year", ",Movie Title,2026"].join("\n");
    const [entry] = service.parseCSV(csv, "favorites");

    expect(entry.imdbID).toBeNull();
    expect(entry.year).toBe(2026);
  });

  it("parses year as null when the year value is non-numeric", () => {
    const service = new IMDbCSVSyncService();
    const csv = ["Const,Title,Year", "tt1,Movie Title,20x6"].join("\n");
    const [entry] = service.parseCSV(csv, "favorites");

    expect(entry.year).toBeNull();
  });

  it("parses year as null when the year field is missing in the row", () => {
    const service = new IMDbCSVSyncService();
    const csv = ["Const,Title,Year", "tt1,Movie Title"].join("\n");
    const [entry] = service.parseCSV(csv, "favorites");

    expect(entry.year).toBeNull();
    expect(entry.imdbID).toBe("tt1");
  });

  it("skips whitespace-only trailing rows", () => {
    const service = new IMDbCSVSyncService();
    const csv = ["Const,Title,Year", "tt1,Movie Title,2021", "", "  "].join(
      "\n",
    );

    expect(service.parseCSV(csv, "watchlist")).toEqual([
      {
        imdbID: "tt1",
        title: "Movie Title",
        year: 2021,
        listType: "watchlist",
      },
    ]);
  });
});

// MARK: - fallbackMediaID (the synthesized dedup key, fallbackMediaIDIsNormalized)

describe("IMDbCSVSyncService.fallbackMediaID", () => {
  it("uses the IMDb const when present", () => {
    const service = new IMDbCSVSyncService();
    const id = service.fallbackMediaID({
      imdbID: "tt1234567",
      title: "Example Movie",
      year: 2026,
      listType: "favorites",
    });
    expect(id).toBe("tt1234567");
  });

  it("synthesizes imdb-{slug}-{year} when there is no Const, never leaking the raw title", () => {
    const service = new IMDbCSVSyncService();
    // Same fixture as the Swift fallbackMediaIDIsNormalized test.
    const csv = ["Title,Year", "Amélie: Le Café!,2001"].join("\n");
    const [entry] = service.parseCSV(csv, "favorites");

    const id = service.fallbackMediaID(entry);
    expect(id).toBe("imdb-amelie-le-cafe-2001");
    expect(id).not.toContain("Amélie");
    expect(id).not.toContain(":");
    expect(id).not.toContain(" ");
  });

  it("defaults a missing year to 0 in the synthesized id", () => {
    const service = new IMDbCSVSyncService();
    const id = service.fallbackMediaID({
      imdbID: null,
      title: "No Year Movie",
      year: null,
      listType: "favorites",
    });
    expect(id).toBe("imdb-no-year-movie-0");
  });
});
