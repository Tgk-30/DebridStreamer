// @vitest-environment jsdom
//
// Render/behavior tests for OmdbRatings: the two key-source paths (BYOK client
// key vs server "hidden key" proxy), the null/empty short-circuits, and the
// rendered rating-chip structure.

import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import type { OMDBRatings } from "../services/metadata/OMDBService";

// --- Mockable state pulled from the module-level fns the component reads. ---
let mockServices: { omdb: { fetchRatings: (id: string) => Promise<OMDBRatings | null> } | null } = {
  omdb: null,
};
let mockOmdbProxy = false;
let mockServerMode = false;

const fetchServerOmdb = vi.fn<(imdbId: string) => Promise<OMDBRatings | null>>();

vi.mock("../store/AppStore", () => ({
  useAppStore: () => ({ services: mockServices }),
}));
vi.mock("../lib/ServerSessionContext", () => ({
  useOmdbProxy: () => mockOmdbProxy,
}));
vi.mock("../lib/serverMode", () => ({
  isServerMode: () => mockServerMode,
}));
vi.mock("../lib/serverApi", () => ({
  fetchServerOmdb: (id: string) => fetchServerOmdb(id),
}));

import { OmdbRatings } from "./OmdbRatings";

function fakeOmdb(ratings: OMDBRatings | null) {
  return { fetchRatings: vi.fn().mockResolvedValue(ratings) };
}

afterEach(() => {
  mockServices = { omdb: null };
  mockOmdbProxy = false;
  mockServerMode = false;
  fetchServerOmdb.mockReset();
  vi.clearAllMocks();
});

describe("OmdbRatings", () => {
  it("renders nothing when imdbId is null (no fetch attempted)", () => {
    const omdb = fakeOmdb({ imdbRating: 8.5 });
    mockServices = { omdb };
    const { container } = render(<OmdbRatings imdbId={null} />);
    expect(container.firstChild).toBeNull();
    expect(omdb.fetchRatings).not.toHaveBeenCalled();
  });

  it("renders nothing when no key source is available", async () => {
    // services.omdb null, not server mode, no proxy.
    const { container } = render(<OmdbRatings imdbId="tt1" />);
    // Allow the effect's async load to settle to null.
    await waitFor(() => {
      expect(container.querySelector(".omdb-ratings")).toBeNull();
    });
    expect(fetchServerOmdb).not.toHaveBeenCalled();
  });

  it("renders all three ratings from the BYOK client key, formatted", async () => {
    const omdb = fakeOmdb({ imdbRating: 8.8, rtPercent: 91, metascore: 74 });
    mockServices = { omdb };
    render(<OmdbRatings imdbId="tt1375666" />);

    await screen.findByLabelText("External ratings");
    expect(omdb.fetchRatings).toHaveBeenCalledWith("tt1375666");

    // imdbRating is toFixed(1).
    expect(screen.getByText("8.8")).toBeInTheDocument();
    expect(screen.getByText("IMDb")).toBeInTheDocument();
    // rtPercent gets a trailing %.
    expect(screen.getByText("91%")).toBeInTheDocument();
    expect(screen.getByText("Rotten Tomatoes")).toBeInTheDocument();
    // metascore is stringified as-is.
    expect(screen.getByText("74")).toBeInTheDocument();
    expect(screen.getByText("Metacritic")).toBeInTheDocument();
  });

  it("omits rating chips whose values are absent", async () => {
    const omdb = fakeOmdb({ imdbRating: 7 });
    mockServices = { omdb };
    const { container } = render(<OmdbRatings imdbId="tt1" />);

    await screen.findByLabelText("External ratings");
    const chips = container.querySelectorAll(".omdb-rating");
    expect(chips).toHaveLength(1);
    expect(container.querySelector(".omdb-rating-imdb")).not.toBeNull();
    expect(container.querySelector(".omdb-rating-rt")).toBeNull();
    expect(container.querySelector(".omdb-rating-meta")).toBeNull();
  });

  it("renders nothing when OMDb returns ratings with no usable fields", async () => {
    const omdb = fakeOmdb({});
    mockServices = { omdb };
    const { container } = render(<OmdbRatings imdbId="tt1" />);
    await waitFor(() => {
      expect(omdb.fetchRatings).toHaveBeenCalled();
    });
    // items.length === 0 -> returns null.
    expect(container.querySelector(".omdb-ratings")).toBeNull();
  });

  it("renders nothing when the BYOK fetch rejects (caught -> null)", async () => {
    const omdb = { fetchRatings: vi.fn().mockRejectedValue(new Error("boom")) };
    mockServices = { omdb };
    const { container } = render(<OmdbRatings imdbId="tt1" />);
    await waitFor(() => {
      expect(omdb.fetchRatings).toHaveBeenCalled();
    });
    expect(container.querySelector(".omdb-ratings")).toBeNull();
  });

  it("uses the server proxy when no client key and proxy is advertised in server mode", async () => {
    mockServerMode = true;
    mockOmdbProxy = true;
    fetchServerOmdb.mockResolvedValue({ imdbRating: 6.2 });
    render(<OmdbRatings imdbId="tt9" />);

    await screen.findByLabelText("External ratings");
    expect(fetchServerOmdb).toHaveBeenCalledWith("tt9");
    expect(screen.getByText("6.2")).toBeInTheDocument();
  });

  it("does not call the server proxy when the BYOK key is present (client takes precedence)", async () => {
    mockServerMode = true;
    mockOmdbProxy = true;
    const omdb = fakeOmdb({ imdbRating: 9 });
    mockServices = { omdb };
    render(<OmdbRatings imdbId="tt7" />);

    await screen.findByLabelText("External ratings");
    expect(omdb.fetchRatings).toHaveBeenCalledWith("tt7");
    expect(fetchServerOmdb).not.toHaveBeenCalled();
  });

  it("does not use the proxy when omdbProxy is false even in server mode", async () => {
    mockServerMode = true;
    mockOmdbProxy = false;
    const { container } = render(<OmdbRatings imdbId="tt1" />);
    await waitFor(() => {
      expect(container.querySelector(".omdb-ratings")).toBeNull();
    });
    expect(fetchServerOmdb).not.toHaveBeenCalled();
  });

  it("renders nothing when the server proxy rejects (caught -> null)", async () => {
    mockServerMode = true;
    mockOmdbProxy = true;
    fetchServerOmdb.mockRejectedValue(new Error("502"));
    const { container } = render(<OmdbRatings imdbId="tt1" />);
    await waitFor(() => {
      expect(fetchServerOmdb).toHaveBeenCalled();
    });
    expect(container.querySelector(".omdb-ratings")).toBeNull();
  });

  it("drops stale BYOK fetch results after an effect refresh (cleanup path)", async () => {
    let firstResolve:
      | ((value: OMDBRatings | null) => void)
      | undefined;
    let secondResolve:
      | ((value: OMDBRatings | null) => void)
      | undefined;

    const first = new Promise<OMDBRatings | null>((resolve) => {
      firstResolve = resolve;
    });
    const second = new Promise<OMDBRatings | null>((resolve) => {
      secondResolve = resolve;
    });

    const omdb = {
      fetchRatings: vi
        .fn()
        .mockReturnValueOnce(first)
        .mockReturnValueOnce(second),
    };
    mockServices = { omdb };
    const { rerender, container } = render(<OmdbRatings imdbId="tt_old" />);

    rerender(<OmdbRatings imdbId="tt_new" />);

    // Resolve the stale first request after refresh; its then branch should skip state.
    firstResolve?.({ imdbRating: 1.2 });
    await Promise.resolve();
    expect(container.querySelector(".omdb-ratings")).toBeNull();
    expect(screen.queryByText("1.2")).toBeNull();

    // Resolve the active request; now the latest id should render.
    secondResolve?.({ imdbRating: 9.9 });
    await screen.findByLabelText("External ratings");
    expect(screen.getByText("9.9")).toBeInTheDocument();
  });
});
