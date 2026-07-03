// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { GenreCatalogGrid } from "./GenreCatalogGrid";
import { catalogTilesFor } from "../data/genreCatalog";
import type { MetadataProvider } from "../services/metadata/types";

describe("GenreCatalogGrid", () => {
  it("renders a tile button per catalog entry for movies including special tiles", () => {
    render(<GenreCatalogGrid type="movie" onOpen={() => {}} />);
    const items = screen.getAllByRole("button");
    // One button per catalog tile for movies.
    expect(items).toHaveLength(catalogTilesFor("movie").length);
    // Special tiles always present.
    expect(
      screen.getByRole("button", { name: "Browse New Releases" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Browse Coming Soon" }),
    ).toBeInTheDocument();
  });

  it("renders fewer tiles for series (TV-incompatible genres are filtered out)", () => {
    render(<GenreCatalogGrid type="series" onOpen={() => {}} />);
    const items = screen.getAllByRole("button");
    expect(items).toHaveLength(catalogTilesFor("series").length);
    // Horror has no TV genre id → no Horror tile for series.
    expect(
      screen.queryByRole("button", { name: "Browse Horror" }),
    ).not.toBeInTheDocument();
  });

  it("opens a genre browse context with the canonical TMDB name when a genre tile is clicked", async () => {
    const onOpen = vi.fn();
    render(<GenreCatalogGrid type="movie" onOpen={onOpen} />);
    await userEvent.click(
      screen.getByRole("button", { name: "Browse Action" }),
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
      screen.getByRole("button", { name: "Browse New Releases" }),
    );
    expect(onOpen).toHaveBeenCalledWith({
      kind: "category",
      type: "movie",
      category: "now_playing",
    });
  });

  it("applies the per-tile accent gradient CSS variables", () => {
    render(<GenreCatalogGrid type="movie" onOpen={() => {}} />);
    const action = screen.getByRole("button", { name: "Browse Action" });
    expect(action.getAttribute("style")).toContain("--tile-a");
    expect(action.getAttribute("style")).toContain("--tile-b");
  });

  it("fills tiles with a live TMDB backdrop when a metadata provider is supplied", async () => {
    const preview = (backdropPath: string) => ({
      items: [{ id: "1", type: "movie" as const, title: "X", backdropPath }],
      page: 1,
      totalPages: 1,
      totalResults: 1,
    });
    const tmdb = {
      discover: vi.fn(async () => preview("/genre.jpg")),
      getCategory: vi.fn(async () => preview("/cat.jpg")),
    } as unknown as MetadataProvider;

    const { container } = render(
      <GenreCatalogGrid type="movie" onOpen={() => {}} tmdb={tmdb} />,
    );

    await waitFor(() => {
      expect(container.querySelectorAll("img.genre-tile-art").length).toBeGreaterThan(0);
    });
    const img = container.querySelector("img.genre-tile-art") as HTMLImageElement;
    // w780 sizing + the returned backdrop path.
    expect(img.getAttribute("src")).toContain("/w780/");
    expect(tmdb.discover).toHaveBeenCalled();
    // Special "New Releases" tile is a category lookup, not a genre discover.
    expect(tmdb.getCategory).toHaveBeenCalled();
  });
});
