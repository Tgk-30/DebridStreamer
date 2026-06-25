// @vitest-environment jsdom
//
// Render tests for the Watchlist screen. It reads `watchlist` (saved previews)
// and `cachedResolutions` (id -> cached resolution) from the store. The subtitle
// gains a "N ready to play instantly." hint counting items with a cached
// resolution; each card has a Remove button wired to removeFromWatchlist. When
// empty it shows an empty-state with Browse / Search CTAs.
//
// The store is mocked for data + callbacks; MediaCard is stubbed so we can assert
// on the `ready` prop and item title without the real image plumbing.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { MediaPreview } from "../models/media";
import type {
  CachedResolutionRecord,
  WatchHistoryRecord,
} from "../storage/models";

// --- mutable mock state -----------------------------------------------------

const openDetail = vi.fn();
const openBrowse = vi.fn();
const navigate = vi.fn();
const removeFromWatchlist = vi.fn();
let mockWatchlist: MediaPreview[] = [];
let mockCachedResolutions: Record<string, CachedResolutionRecord> = {};
let mockContinueWatching: WatchHistoryRecord[] = [];

vi.mock("../store/AppStore", () => ({
  useAppStore: () => ({
    watchlist: mockWatchlist,
    openDetail,
    removeFromWatchlist,
    cachedResolutions: mockCachedResolutions,
    continueWatching: mockContinueWatching,
    openBrowse,
    navigate,
  }),
}));

vi.mock("../components/MediaCard", () => ({
  MediaCard: (props: {
    item: MediaPreview;
    onSelect?: (i: MediaPreview) => void;
    ready?: boolean;
    progress?: number;
  }) => (
    <button
      type="button"
      data-ready={props.ready ? "yes" : "no"}
      data-progress={props.progress ?? ""}
      onClick={() => props.onSelect?.(props.item)}
    >
      card:{props.item.title}
    </button>
  ),
}));

import { Watchlist } from "./Watchlist";

// --- helpers ----------------------------------------------------------------

function preview(id: string, title: string): MediaPreview {
  return { id, type: "movie", title };
}

function resolution(): CachedResolutionRecord {
  return {} as CachedResolutionRecord;
}

beforeEach(() => {
  openDetail.mockClear();
  openBrowse.mockClear();
  navigate.mockClear();
  removeFromWatchlist.mockClear();
  mockWatchlist = [];
  mockCachedResolutions = {};
  mockContinueWatching = [];
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Watchlist — empty", () => {
  it("renders the empty-state with Browse + Search CTAs", async () => {
    render(<Watchlist />);
    expect(screen.getByText("Your watchlist is empty")).toBeInTheDocument();
    expect(screen.queryByText(/card:/)).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /browse trending/i }));
    expect(openBrowse).toHaveBeenCalledWith({
      kind: "category",
      type: "movie",
      category: "trending",
    });

    await userEvent.click(screen.getByRole("button", { name: /search catalog/i }));
    expect(navigate).toHaveBeenCalledWith("search");
  });

  it("does not show the ready-to-play hint when empty", () => {
    render(<Watchlist />);
    expect(screen.queryByText(/ready to play instantly/i)).not.toBeInTheDocument();
  });
});

describe("Watchlist — populated", () => {
  it("renders a card per item and opens detail on select", async () => {
    mockWatchlist = [preview("m1", "Tenet"), preview("m2", "Dune")];
    render(<Watchlist />);
    expect(screen.getByText("card:Tenet")).toBeInTheDocument();
    expect(screen.getByText("card:Dune")).toBeInTheDocument();

    await userEvent.click(screen.getByText("card:Dune"));
    expect(openDetail).toHaveBeenCalledWith(
      expect.objectContaining({ id: "m2" }),
    );
  });

  it("marks cards ready and shows the ready-to-play count hint", () => {
    mockWatchlist = [preview("m1", "Tenet"), preview("m2", "Dune")];
    mockCachedResolutions = { m1: resolution() };
    render(<Watchlist />);

    expect(screen.getByText(/1 ready to play instantly/i)).toBeInTheDocument();
    expect(screen.getByText("card:Tenet")).toHaveAttribute("data-ready", "yes");
    expect(screen.getByText("card:Dune")).toHaveAttribute("data-ready", "no");
  });

  it("removes an item via its Remove button", async () => {
    mockWatchlist = [preview("m1", "Tenet")];
    render(<Watchlist />);

    const removeBtn = screen.getByRole("button", {
      name: /Remove Tenet from watchlist/i,
    });
    await userEvent.click(removeBtn);
    expect(removeFromWatchlist).toHaveBeenCalledWith("m1");
  });

  it("shows a resume bar on an in-progress watchlisted title", () => {
    mockWatchlist = [preview("m1", "Tenet"), preview("m2", "Dune")];
    mockContinueWatching = [
      {
        id: "m1:",
        mediaId: "m1",
        episodeId: null,
        progressSeconds: 50,
        durationSeconds: 100,
        completed: false,
        lastWatched: "2020-01-01T00:00:00Z",
        streamQuality: null,
        preview: preview("m1", "Tenet"),
      },
    ];
    render(<Watchlist />);
    expect(screen.getByText("card:Tenet")).toHaveAttribute("data-progress", "0.5");
    expect(screen.getByText("card:Dune")).toHaveAttribute("data-progress", "");
  });
});
