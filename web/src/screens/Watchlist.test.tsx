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
import { render, screen, waitFor } from "@testing-library/react";
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
const listWatchlistFolders = vi.fn();
const listWatchlistRows = vi.fn();
const createWatchlistFolder = vi.fn();
const renameWatchlistFolder = vi.fn();
const deleteWatchlistFolder = vi.fn();
const assignWatchlistFolder = vi.fn();
const importToWatchlist = vi.fn();
const isTraktConnected = vi.hoisted(() => vi.fn());
const getValidAccessToken = vi.hoisted(() => vi.fn());
const fetchWatchlist = vi.hoisted(() => vi.fn());
const pushWatchlist = vi.hoisted(() => vi.fn());
const findByImdbId = vi.fn();
const getDetail = vi.fn();
const search = vi.fn();
const getExternalIds = vi.fn();
let serverMode = false;
let mockWatchlist: MediaPreview[] = [];
let mockCachedResolutions: Record<string, CachedResolutionRecord> = {};
let mockContinueWatching: WatchHistoryRecord[] = [];
const settings = { traktClientId: "trakt-client", traktClientSecret: "trakt-secret" };

vi.mock("../store/AppStore", () => ({
  useAppStore: () => ({
    watchlist: mockWatchlist,
    openDetail,
    removeFromWatchlist,
    cachedResolutions: mockCachedResolutions,
    continueWatching: mockContinueWatching,
    openBrowse,
    navigate,
    services: {
      tmdb: { findByImdbId, getDetail, search, getExternalIds },
    },
    settings,
    importToWatchlist,
  }),
}));

vi.mock("../lib/serverMode", () => ({ isServerMode: () => serverMode }));

vi.mock("../data/traktConnection", () => ({
  isTraktConnected,
  getValidAccessToken,
}));

vi.mock("../services/sync/TraktSyncService", () => ({
  TraktSyncService: class {
    fetchWatchlist(...args: unknown[]) {
      return fetchWatchlist(...args);
    }
    pushWatchlist(...args: unknown[]) {
      return pushWatchlist(...args);
    }
  },
}));

vi.mock("../storage", () => ({
  getStore: () => ({
    listWatchlistFolders: () => listWatchlistFolders(),
    listWatchlist: () => listWatchlistRows(),
    createWatchlistFolder: (name: string) => createWatchlistFolder(name),
    renameWatchlistFolder: (id: string, name: string) => renameWatchlistFolder(id, name),
    deleteWatchlistFolder: (id: string) => deleteWatchlistFolder(id),
    assignWatchlistFolder: (id: string, folderId: string | null) =>
      assignWatchlistFolder(id, folderId),
  }),
}));

vi.mock("../components/MediaCard", () => ({
  MediaCard: (props: {
    item: MediaPreview;
    onSelect?: (i: MediaPreview) => void;
    ready?: boolean;
    progress?: number;
    watched?: boolean;
  }) => (
    <button
      type="button"
      data-ready={props.ready ? "yes" : "no"}
      data-progress={props.progress ?? ""}
      data-watched={props.watched ? "yes" : "no"}
      onClick={() => props.onSelect?.(props.item)}
    >
      card:{props.item.title}
    </button>
  ),
}));

let mockWatchedIds = new Set<string>();
vi.mock("../data/useWatchedIds", () => ({
  useWatchedIds: () => mockWatchedIds,
}));

import { shouldShowTraktWatchlistSync, Watchlist } from "./Watchlist";

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
  mockWatchedIds = new Set<string>();
  serverMode = false;
  isTraktConnected.mockResolvedValue(false);
  getValidAccessToken.mockResolvedValue("access-token");
  fetchWatchlist.mockResolvedValue([]);
  pushWatchlist.mockResolvedValue({});
  findByImdbId.mockResolvedValue(null);
  getDetail.mockReset();
  search.mockResolvedValue({ items: [] });
  getExternalIds.mockResolvedValue({ imdbId: null });
  importToWatchlist.mockResolvedValue({ added: 0, skipped: 0 });
  listWatchlistFolders.mockResolvedValue([]);
  listWatchlistRows.mockResolvedValue([]);
  createWatchlistFolder.mockResolvedValue({ id: "folder-1", name: "New Folder" });
  renameWatchlistFolder.mockResolvedValue(undefined);
  deleteWatchlistFolder.mockResolvedValue(undefined);
  assignWatchlistFolder.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Watchlist - empty", () => {
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

describe("Watchlist - populated", () => {
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

  it("flags watched titles from the batched history lookup", () => {
    mockWatchlist = [preview("m1", "Tenet"), preview("m2", "Dune")];
    mockWatchedIds = new Set<string>(["m2"]);
    render(<Watchlist />);

    expect(screen.getByText("card:Tenet")).toHaveAttribute("data-watched", "no");
    expect(screen.getByText("card:Dune")).toHaveAttribute("data-watched", "yes");
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

  it("quickly filters titles in the current watchlist view", async () => {
    mockWatchlist = [preview("m1", "Tenet"), preview("m2", "Dune")];
    render(<Watchlist />);

    await userEvent.type(screen.getByRole("searchbox", { name: /search watchlist/i }), "dune");
    expect(screen.getByText("card:Dune")).toBeInTheDocument();
    expect(screen.queryByText("card:Tenet")).not.toBeInTheDocument();
  });
});

describe("Watchlist - Trakt pull", () => {
  it("imports resolved Trakt movies and reports added and skipped titles", async () => {
    isTraktConnected.mockResolvedValue(true);
    fetchWatchlist.mockResolvedValue([
      { imdbID: "tt0133093", title: "The Matrix", year: 1999 },
    ]);
    search.mockResolvedValue({
      items: [preview("tmdb-603", "The Matrix")],
    });
    importToWatchlist.mockResolvedValue({ added: 1, skipped: 2 });

    render(<Watchlist />);
    const pull = await screen.findByRole("button", { name: "Pull from Trakt" });
    await userEvent.click(pull);

    await waitFor(() =>
      expect(importToWatchlist).toHaveBeenCalledWith([
        expect.objectContaining({ id: "tmdb-603", title: "The Matrix" }),
      ]),
    );
    expect(fetchWatchlist).toHaveBeenCalledWith("trakt-client", "access-token");
    expect(screen.getByText(/Pulled from Trakt: added 1, skipped 2 already saved/i)).toBeInTheDocument();
  });

  it("hides Trakt actions in Server Mode", () => {
    expect(shouldShowTraktWatchlistSync(true, true)).toBe(false);
    expect(shouldShowTraktWatchlistSync(true, false)).toBe(true);
  });
});
