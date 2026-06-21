import { describe, expect, it } from "vitest";
import { GENRE_CATALOG, catalogTilesFor, tileGenreId } from "./genreCatalog";

describe("genreCatalog", () => {
  it("genre tiles carry at least one genre id; special tiles carry a category", () => {
    for (const t of GENRE_CATALOG) {
      if (t.category != null) {
        expect(t.movieGenreId).toBeNull();
        expect(t.tvGenreId).toBeNull();
      } else {
        expect(t.movieGenreId != null || t.tvGenreId != null).toBe(true);
      }
    }
  });

  it("catalogTilesFor('movie') includes movie genres and the special tiles", () => {
    const tiles = catalogTilesFor("movie");
    expect(tiles.find((t) => t.id === "action")).toBeDefined();
    expect(tiles.find((t) => t.id === "new-releases")).toBeDefined();
    expect(tiles.find((t) => t.id === "coming-soon")).toBeDefined();
  });

  it("catalogTilesFor('series') drops genres with no TV id but keeps specials", () => {
    const tiles = catalogTilesFor("series");
    // Horror has no TMDB TV genre, so it must not render for series.
    expect(tiles.find((t) => t.id === "horror")).toBeUndefined();
    expect(tiles.find((t) => t.id === "comedy")).toBeDefined();
    expect(tiles.find((t) => t.id === "new-releases")).toBeDefined();
  });

  it("tileGenreId returns the type-appropriate TMDB id", () => {
    const action = GENRE_CATALOG.find((t) => t.id === "action")!;
    expect(tileGenreId(action, "movie")).toBe(28);
    expect(tileGenreId(action, "series")).toBe(10759);
  });
});
