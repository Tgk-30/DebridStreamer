// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { GenreCatalogGrid } from "./GenreCatalogGrid";
import { catalogTilesFor } from "../data/genreCatalog";

describe("GenreCatalogGrid", () => {
  it("renders a list of tiles for movies including special category tiles", () => {
    render(<GenreCatalogGrid type="movie" onOpen={() => {}} />);
    const list = screen.getByRole("list");
    const items = screen.getAllByRole("listitem");
    expect(list).toHaveClass("genre-catalog");
    // One button per catalog tile for movies.
    expect(items).toHaveLength(catalogTilesFor("movie").length);
    // Special tiles always present.
    expect(
      screen.getByRole("listitem", { name: "Browse New Releases" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("listitem", { name: "Browse Coming Soon" }),
    ).toBeInTheDocument();
  });

  it("renders fewer tiles for series (TV-incompatible genres are filtered out)", () => {
    render(<GenreCatalogGrid type="series" onOpen={() => {}} />);
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(catalogTilesFor("series").length);
    // Horror has no TV genre id → no Horror tile for series.
    expect(
      screen.queryByRole("listitem", { name: "Browse Horror" }),
    ).not.toBeInTheDocument();
  });

  it("opens a genre browse context with the canonical TMDB name when a genre tile is clicked", async () => {
    const onOpen = vi.fn();
    render(<GenreCatalogGrid type="movie" onOpen={onOpen} />);
    await userEvent.click(
      screen.getByRole("listitem", { name: "Browse Action" }),
    );
    expect(onOpen).toHaveBeenCalledWith({
      kind: "genre",
      type: "movie",
      genreId: 28,
      genreName: "Action",
    });
  });

  it("opens a category browse context when a special tile is clicked", async () => {
    const onOpen = vi.fn();
    render(<GenreCatalogGrid type="movie" onOpen={onOpen} />);
    await userEvent.click(
      screen.getByRole("listitem", { name: "Browse New Releases" }),
    );
    expect(onOpen).toHaveBeenCalledWith({
      kind: "category",
      type: "movie",
      category: "now_playing",
    });
  });

  it("applies the per-tile accent gradient CSS variables", () => {
    render(<GenreCatalogGrid type="movie" onOpen={() => {}} />);
    const action = screen.getByRole("listitem", { name: "Browse Action" });
    expect(action.getAttribute("style")).toContain("--tile-a");
    expect(action.getAttribute("style")).toContain("--tile-b");
  });
});
