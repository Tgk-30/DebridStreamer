// @vitest-environment jsdom
//
// Render tests for the Library screen. It loads favorites entries + folders from
// the Store, renders a folder chip strip that filters a MediaGrid, and falls
// back to the watchlist when the library proper is empty. In Server Mode it also
// surfaces a shared "Requested" rail.
//
// Heavy deps are mocked: the app store (watchlist + nav callbacks), the storage
// Store (getStore), serverMode/serverApi, and MediaGrid/Rail (rendered as simple
// stubs so we assert on item lists without MediaCard's image plumbing).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { MediaPreview } from "../models/media";
import type {
  LibraryEntryRecord,
  LibraryFolderRecord,
} from "../storage/models";

// --- mutable mock state -----------------------------------------------------

const openDetail = vi.fn();
const openBrowse = vi.fn();
const navigate = vi.fn();
let mockWatchlist: MediaPreview[] = [];

const ensureSystemFolders = vi.fn(async () => {});
let listFoldersImpl: () => Promise<LibraryFolderRecord[]>;
let listLibraryImpl: () => Promise<LibraryEntryRecord[]>;

let mockServerMode = false;
const listRequested = vi.fn(async () => ({ items: [] as { preview: MediaPreview }[] }));

vi.mock("../store/AppStore", () => ({
  useAppStore: () => ({
    watchlist: mockWatchlist,
    openDetail,
    openBrowse,
    navigate,
  }),
}));

vi.mock("../storage", () => ({
  getStore: () => ({
    ensureSystemFolders,
    listFolders: () => listFoldersImpl(),
    listLibrary: () => listLibraryImpl(),
  }),
}));

vi.mock("../lib/serverMode", () => ({
  isServerMode: () => mockServerMode,
}));

vi.mock("../lib/serverApi", () => ({
  listRequested: () => listRequested(),
}));

vi.mock("../components/MediaGrid", () => ({
  MediaGrid: (props: { items: MediaPreview[]; onSelect?: (i: MediaPreview) => void }) => (
    <div data-testid="media-grid">
      {props.items.map((i) => (
        <button key={i.id} type="button" onClick={() => props.onSelect?.(i)}>
          grid:{i.title}
        </button>
      ))}
    </div>
  ),
}));

vi.mock("../components/Rail", () => ({
  Rail: (props: { title: string; items: MediaPreview[] }) =>
    props.items.length === 0 ? null : (
      <div data-testid="rail">
        {props.title}:{props.items.map((i) => i.title).join(",")}
      </div>
    ),
}));

import { Library } from "./Library";

// --- helpers ----------------------------------------------------------------

function preview(id: string, title: string): MediaPreview {
  return { id, type: "movie", title };
}

function folder(id: string, name: string, kind: LibraryFolderRecord["folderKind"] = "manual"): LibraryFolderRecord {
  return {
    id,
    name,
    parentId: null,
    listType: "favorites",
    folderKind: kind,
    isSystem: kind === "system_root",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  };
}

function entry(id: string, folderId: string | null, p: MediaPreview): LibraryEntryRecord {
  return {
    id,
    mediaId: p.id,
    folderId,
    listType: "favorites",
    addedAt: "2026-01-01T00:00:00Z",
    customListName: null,
    releaseDateHint: null,
    renewalStatus: null,
    preview: p,
  };
}

beforeEach(() => {
  openDetail.mockClear();
  openBrowse.mockClear();
  navigate.mockClear();
  ensureSystemFolders.mockClear();
  listRequested.mockClear();
  mockWatchlist = [];
  mockServerMode = false;
  listFoldersImpl = async () => [];
  listLibraryImpl = async () => [];
  listRequested.mockResolvedValue({ items: [] });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Library — loading + empty", () => {
  it("shows a loading line first, then resolves", async () => {
    let resolve!: (v: LibraryEntryRecord[]) => void;
    const pending = new Promise<LibraryEntryRecord[]>((r) => (resolve = r));
    listLibraryImpl = () => pending;
    render(<Library />);
    expect(screen.getByText("Loading your library…")).toBeInTheDocument();
    resolve([]);
    await waitFor(() => {
      expect(screen.queryByText("Loading your library…")).not.toBeInTheDocument();
    });
  });

  it("renders the empty state with Browse + Search CTAs when nothing saved", async () => {
    render(<Library />);
    expect(await screen.findByText("Your library is empty")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /browse trending/i }));
    expect(openBrowse).toHaveBeenCalledWith({
      kind: "category",
      type: "movie",
      category: "trending",
    });

    await userEvent.click(screen.getByRole("button", { name: /search catalog/i }));
    expect(navigate).toHaveBeenCalledWith("search");
  });
});

describe("Library — error", () => {
  it("renders the error empty-state with the failure note", async () => {
    listLibraryImpl = async () => {
      throw new Error("disk gone");
    };
    render(<Library />);
    expect(
      await screen.findByText("Couldn't load your library"),
    ).toBeInTheDocument();
    expect(screen.getByText("disk gone")).toBeInTheDocument();
  });
});

describe("Library — folders + grid filtering", () => {
  it("renders a chip per non-root folder and filters the grid by folder", async () => {
    listFoldersImpl = async () => [
      folder("__root__", "Root", "system_root"),
      folder("f-action", "Action"),
      folder("f-scifi", "Sci-Fi"),
    ];
    listLibraryImpl = async () => [
      entry("e1", "f-action", preview("m1", "Die Hard")),
      entry("e2", "f-scifi", preview("m2", "Blade Runner")),
    ];
    render(<Library />);

    // All saved shows both; root folder chip is filtered out.
    await screen.findByText("grid:Die Hard");
    expect(screen.getByText("grid:Blade Runner")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Root" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Action" })).toBeInTheDocument();

    // Selecting "Sci-Fi" narrows to that folder's entries.
    await userEvent.click(screen.getByRole("button", { name: "Sci-Fi" }));
    expect(screen.getByText("grid:Blade Runner")).toBeInTheDocument();
    expect(screen.queryByText("grid:Die Hard")).not.toBeInTheDocument();
  });

  it("clicking a grid card opens the detail", async () => {
    listLibraryImpl = async () => [entry("e1", null, preview("m1", "Heat"))];
    render(<Library />);
    await userEvent.click(await screen.findByText("grid:Heat"));
    expect(openDetail).toHaveBeenCalledWith(
      expect.objectContaining({ id: "m1", title: "Heat" }),
    );
  });
});

describe("Library — watchlist fallback", () => {
  it("falls back to the watchlist with a hint when the library is empty", async () => {
    mockWatchlist = [preview("w1", "Tenet")];
    render(<Library />);
    expect(await screen.findByText("grid:Tenet")).toBeInTheDocument();
    expect(
      screen.getByText(/Showing your watchlist/i),
    ).toBeInTheDocument();
  });
});

describe("Library — requested rail (Server Mode)", () => {
  it("does not fetch or show the rail in local mode", async () => {
    mockServerMode = false;
    render(<Library />);
    await screen.findByText("Your library is empty");
    expect(listRequested).not.toHaveBeenCalled();
    expect(screen.queryByTestId("rail")).not.toBeInTheDocument();
  });

  it("shows the requested rail in Server Mode", async () => {
    mockServerMode = true;
    listRequested.mockResolvedValue({
      items: [{ preview: preview("r1", "Dune") }],
    });
    render(<Library />);
    await waitFor(() => {
      expect(screen.getByTestId("rail")).toHaveTextContent("Dune");
    });
  });

  it("degrades silently to no rail when the requested fetch fails", async () => {
    mockServerMode = true;
    listRequested.mockRejectedValue(new Error("offline"));
    render(<Library />);
    await screen.findByText("Your library is empty");
    expect(screen.queryByTestId("rail")).not.toBeInTheDocument();
  });
});
