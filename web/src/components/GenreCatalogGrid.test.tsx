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

  it("renders two cross-fade layers behind a tile that has artwork", async () => {
    const preview = (backdropPath: string) => ({
      items: [{ id: "1", type: "movie" as const, title: "X", backdropPath }],
      page: 1,
      totalPages: 1,
      totalResults: 1,
    });
    const tmdb = {
      discover: vi.fn(async () => preview("/g.jpg")),
      getCategory: vi.fn(async () => preview("/c.jpg")),
    } as unknown as MetadataProvider;

    const { container } = render(
      <GenreCatalogGrid type="movie" onOpen={() => {}} tmdb={tmdb} />,
    );
    await waitFor(() => {
      expect(
        container.querySelector(".genre-tile.has-art .genre-tile-arts"),
      ).not.toBeNull();
    });
    // Two layered <img>s per art tile enable the rotating cross-fade.
    const arts = container.querySelector(
      ".genre-tile.has-art .genre-tile-arts",
    ) as HTMLElement;
    expect(arts.querySelectorAll("img.genre-tile-art")).toHaveLength(2);
  });

  // Regression: on a real boot the grid first mounts with tmdb=null (services
  // aren't built until the TMDB key hydrates from Dexie), then the prop flips to
  // a real provider. The effect's [type, tmdb] deps must re-fire on that flip so
  // artwork actually loads - not stay blank because it only saw null at mount.
  it("loads artwork after tmdb transitions from null to a real provider (boot path)", async () => {
    const preview = (backdropPath: string) => ({
      items: [{ id: "1", type: "movie" as const, title: "X", backdropPath }],
      page: 1,
      totalPages: 1,
      totalResults: 1,
    });
    const tmdb = {
      discover: vi.fn(async () => preview("/late.jpg")),
      getCategory: vi.fn(async () => preview("/late-cat.jpg")),
    } as unknown as MetadataProvider;

    // First render: no provider yet (mid-boot). No artwork, no lookups.
    const { container, rerender } = render(
      <GenreCatalogGrid type="movie" onOpen={() => {}} tmdb={null} />,
    );
    expect(container.querySelectorAll("img.genre-tile-art").length).toBe(0);
    expect(tmdb.discover).not.toHaveBeenCalled();

    // Key hydrates → services rebuild → provider prop flips null → real.
    rerender(<GenreCatalogGrid type="movie" onOpen={() => {}} tmdb={tmdb} />);
    await waitFor(() => {
      expect(container.querySelectorAll("img.genre-tile-art").length).toBeGreaterThan(0);
    });
    expect(tmdb.discover).toHaveBeenCalled();
  });
});
