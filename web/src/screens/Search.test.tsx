// @vitest-environment jsdom
//
// Render/interaction tests for the Search screen.
//
// Search reads `services`/`pendingSearch`/`consumePendingSearch`/`openDetail`/
// `openBrowse` off the app store and runs `services.tmdb.search` on submit. We
// mock the store (with a controllable tmdb search spy), serverMode (Local Mode),
// the fixtures starters, and child grids so we can drive the screen's branches:
// the idle state (categories + trending), the type-filter chips, running a
// search via Enter / clear, the results head + "See all", the empty state, and
// the error path.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { MediaPreview } from "../models/media";

// --- mutable mock state -----------------------------------------------------

const STARTERS: MediaPreview[] = [
  { id: "s1", type: "movie", title: "Inception" },
  { id: "s2", type: "series", title: "Severance" },
];

const tmdbSearch = vi.fn();
let mockPendingSearch: string | null = null;
const consumePendingSearch = vi.fn();
const openDetail = vi.fn();
const openBrowse = vi.fn();
let mockServices: { tmdb: { search: typeof tmdbSearch } | null } = {
  tmdb: { search: tmdbSearch },
};

vi.mock("../store/AppStore", () => ({
  useAppStore: () => ({
    services: mockServices,
    pendingSearch: mockPendingSearch,
    consumePendingSearch,
    openDetail,
    openBrowse,
  }),
}));

let mockServerMode = false;
vi.mock("../lib/serverMode", () => ({
  isServerMode: () => mockServerMode,
}));

const searchServerMedia = vi.fn();
vi.mock("../lib/serverApi", () => ({
  searchServerMedia: (...a: unknown[]) => searchServerMedia(...a),
}));

vi.mock("../data/fixtures", () => ({
  loadDiscoverFixtures: () => ({
    trendingMovies: [STARTERS[0]],
    trendingTV: [STARTERS[1]],
  }),
}));

// Child grids reduced to inspectable shells.
vi.mock("../components/MediaGrid", () => ({
  MediaGrid: ({
    items,
    onSelect,
    empty,
  }: {
    items: MediaPreview[];
    onSelect: (i: MediaPreview) => void;
    empty?: React.ReactNode;
  }) =>
    items.length === 0 ? (
      <div data-testid="media-grid-empty">{empty}</div>
    ) : (
      <div data-testid="media-grid">
        {items.map((i) => (
          <button key={i.id} onClick={() => onSelect(i)}>
            {i.title}
          </button>
        ))}
      </div>
    ),
}));

vi.mock("../components/GenreCatalogGrid", () => ({
  GenreCatalogGrid: ({ type }: { type: string }) => (
    <div data-testid="genre-catalog" data-type={type} />
  ),
}));

vi.mock("../components/EmptyState", () => ({
  EmptyState: ({ title, subtitle }: { title: string; subtitle?: string }) => (
    <div data-testid="empty-state">
      {title}
      {subtitle}
    </div>
  ),
}));

vi.mock("../components/Icon", () => ({
  Icon: ({ name }: { name: string }) => <span data-icon={name} />,
}));

import { Search } from "./Search";

function fieldInput() {
  return screen.getByLabelText("Search movies and shows") as HTMLInputElement;
}

beforeEach(() => {
  mockPendingSearch = null;
  mockServerMode = false;
  mockServices = { tmdb: { search: tmdbSearch } };
  vi.clearAllMocks();
  tmdbSearch.mockResolvedValue({
    items: [
      { id: "r1", type: "movie", title: "Dune" },
      { id: "r2", type: "series", title: "Dune: Prophecy" },
    ],
  });
});

afterEach(() => cleanup());

describe("Search — idle state", () => {
  it("shows categories + trending starters when no query has run", () => {
    render(<Search />);
    expect(screen.getByRole("heading", { name: "Search" })).toBeInTheDocument();
    expect(screen.getByText("Browse categories")).toBeInTheDocument();
    expect(screen.getByTestId("genre-catalog")).toHaveAttribute(
      "data-type",
      "movie",
    );
    expect(screen.getByText("Trending now")).toBeInTheDocument();
    // Both starters render in the trending grid.
    expect(screen.getByText("Inception")).toBeInTheDocument();
    expect(screen.getByText("Severance")).toBeInTheDocument();
  });

  it("clicking a trending starter opens Detail", async () => {
    render(<Search />);
    await userEvent.click(screen.getByText("Inception"));
    expect(openDetail).toHaveBeenCalledWith(STARTERS[0]);
  });

  it("does not show a clear button when the field is empty", () => {
    render(<Search />);
    expect(screen.queryByRole("button", { name: "Clear" })).not.toBeInTheDocument();
  });
});

describe("Search — type filter chips", () => {
  it("highlights the active filter; All is default", async () => {
    render(<Search />);
    expect(screen.getByRole("button", { name: "All" }).className).toContain(
      "is-active",
    );
    await userEvent.click(screen.getByRole("button", { name: "TV" }));
    expect(screen.getByRole("button", { name: "TV" }).className).toContain(
      "is-active",
    );
    // Switching to TV flips the idle genre catalog to series.
    expect(screen.getByTestId("genre-catalog")).toHaveAttribute(
      "data-type",
      "series",
    );
  });
});

describe("Search — running a search", () => {
  it("runs on Enter and renders the results grid + heading", async () => {
    render(<Search />);
    const input = fieldInput();
    await userEvent.type(input, "dune");
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() =>
      expect(tmdbSearch).toHaveBeenCalledWith("dune", null),
    );
    await screen.findByTestId("media-grid");
    expect(screen.getByText(/Results for/)).toHaveTextContent("dune");
    expect(screen.getByText("Dune")).toBeInTheDocument();
    expect(screen.getByText("Dune: Prophecy")).toBeInTheDocument();
    // Idle sections are gone.
    expect(screen.queryByText("Trending now")).not.toBeInTheDocument();
  });

  it("passes the active type filter and filters mixed results", async () => {
    render(<Search />);
    await userEvent.click(screen.getByRole("button", { name: "Movies" }));
    const input = fieldInput();
    await userEvent.type(input, "dune");
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() =>
      expect(tmdbSearch).toHaveBeenCalledWith("dune", "movie"),
    );
    await screen.findByTestId("media-grid");
    // Only the movie result survives the type filter.
    expect(screen.getByText("Dune")).toBeInTheDocument();
    expect(screen.queryByText("Dune: Prophecy")).not.toBeInTheDocument();
  });

  it("clicking 'See all' opens Browse with a search target", async () => {
    render(<Search />);
    const input = fieldInput();
    await userEvent.type(input, "dune");
    fireEvent.keyDown(input, { key: "Enter" });
    await screen.findByText("See all");

    await userEvent.click(screen.getByText("See all"));
    expect(openBrowse).toHaveBeenCalledWith({
      kind: "search",
      type: null,
      query: "dune",
    });
  });

  it("renders the empty state when a search returns nothing", async () => {
    tmdbSearch.mockResolvedValue({ items: [] });
    render(<Search />);
    const input = fieldInput();
    await userEvent.type(input, "zzzz");
    fireEvent.keyDown(input, { key: "Enter" });

    await screen.findByTestId("media-grid-empty");
    expect(screen.getByTestId("empty-state")).toHaveTextContent("No results");
  });
});

describe("Search — clear", () => {
  it("clears the query and results, returning to idle", async () => {
    render(<Search />);
    const input = fieldInput();
    await userEvent.type(input, "dune");
    fireEvent.keyDown(input, { key: "Enter" });
    await screen.findByTestId("media-grid");

    await userEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(input.value).toBe("");
    // Back to the idle trending section.
    expect(screen.getByText("Trending now")).toBeInTheDocument();
  });
});

describe("Search — error path", () => {
  it("renders the error message and an empty results grid", async () => {
    tmdbSearch.mockRejectedValue(new Error("boom"));
    render(<Search />);
    const input = fieldInput();
    await userEvent.type(input, "dune");
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => expect(screen.getByText("boom")).toBeInTheDocument());
    expect(screen.getByTestId("media-grid-empty")).toBeInTheDocument();
  });
});

describe("Search — pending search handoff", () => {
  it("runs a pending query from the global field and consumes it", async () => {
    mockPendingSearch = "matrix";
    render(<Search />);
    await waitFor(() =>
      expect(tmdbSearch).toHaveBeenCalledWith("matrix", null),
    );
    expect(consumePendingSearch).toHaveBeenCalledTimes(1);
    expect(fieldInput().value).toBe("matrix");
  });
});

describe("Search — no TMDB key fallback", () => {
  it("filters the bundled starters locally when there is no tmdb service", async () => {
    mockServices = { tmdb: null };
    render(<Search />);
    const input = fieldInput();
    await userEvent.type(input, "incep");
    fireEvent.keyDown(input, { key: "Enter" });

    await screen.findByTestId("media-grid");
    expect(screen.getByText("Inception")).toBeInTheDocument();
    expect(screen.queryByText("Severance")).not.toBeInTheDocument();
    // No live service was hit.
    expect(tmdbSearch).not.toHaveBeenCalled();
  });
});

describe("Search — server mode", () => {
  it("searches via the server proxy when in server mode", async () => {
    mockServerMode = true;
    mockServices = { tmdb: null };
    searchServerMedia.mockResolvedValue({
      items: [{ id: "sv1", type: "movie", title: "Server Hit" }],
    });
    render(<Search />);
    const input = fieldInput();
    await userEvent.type(input, "hit");
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() =>
      expect(searchServerMedia).toHaveBeenCalledWith({
        query: "hit",
        type: null,
      }),
    );
    await screen.findByText("Server Hit");
  });
});
