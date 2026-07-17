// @vitest-environment jsdom
//
// Targeted branch tests for edge paths in GenreCatalogGrid:
// - genreName with a null genre id for a non-category tile
// - fallback genre name behavior when fallbackGenres has no match
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { GenreCatalogGrid } from "./GenreCatalogGrid";

type TestMode = "nullGenre" | "missingFallbackName";

const state = { mode: "nullGenre" as TestMode };

const nullGenreTile = {
  id: "ghost",
  label: "Ghost Genre",
  glyph: "👻",
  accent: ["rgba(200, 200, 200, 0.5)", "rgba(80, 80, 80, 0.5)"] as [
    string,
    string,
  ],
  movieGenreId: null,
  tvGenreId: null,
};

const missingFallbackTile = {
  id: "missing-fallback",
  label: "Obscure",
  glyph: "🔍",
  accent: ["rgba(120, 80, 220, 0.5)", "rgba(90, 40, 190, 0.5)"] as [
    string,
    string,
  ],
  movieGenreId: 9999,
  tvGenreId: 8888,
};

vi.mock("../data/genreCatalog", () => {
  const tileGenreId = (tile: { movieGenreId: number | null; tvGenreId: number | null }) =>
    tile.movieGenreId;

  return {
    tileGenreId,
    catalogTilesFor: () => {
      if (state.mode === "nullGenre") return [nullGenreTile];
      return [missingFallbackTile];
    },
  };
});

vi.mock("../data/genres", () => ({
  fallbackGenres: () => [],
}));

describe("GenreCatalogGrid edge behavior", () => {
  afterEach(() => {
    state.mode = "nullGenre";
  });

  it("does not navigate when a non-category tile has a null genre id", async () => {
    const onOpen = vi.fn();
    render(<GenreCatalogGrid type="movie" onOpen={onOpen} />);

    await userEvent.click(screen.getByRole("button", { name: "Browse Ghost Genre" }));
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("falls back to the tile label when fallback genres do not include the id", async () => {
    state.mode = "missingFallbackName";
    const onOpen = vi.fn();
    render(<GenreCatalogGrid type="movie" onOpen={onOpen} />);

    await userEvent.click(
      screen.getByRole("button", { name: "Browse Obscure" }),
    );
    expect(onOpen).toHaveBeenCalledWith({
      kind: "genre",
      type: "movie",
      genreId: 9999,
      genreName: "Obscure",
    });
  });
});
