// @vitest-environment jsdom
//
// Render/interaction tests for the DebridLibrary screen. The screen is gated to
// Tauri + a configured debrid service, then renders a searchable/filterable
// table with single + bulk delete, a refresh button, and a hash-list dialog.
//
// Heavy deps are mocked: the app store (services.debrid + navigate), the
// useDebridLibrary data hook (whose state we drive directly), isTauri, and the
// lazy HashListDialog. formatSize is re-exported from the real module so size
// formatting in the table matches production.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { DebridTorrent } from "../services/debrid/models";
import type { DebridRow, DebridLibraryState } from "../data/debridLibrary";

// --- mutable mock state -----------------------------------------------------

const navigate = vi.fn();
const deleteTorrent = vi.fn(async () => {});
const reload = vi.fn();
let mockTauri = true;
let mockState: DebridLibraryState;
let mockDebrid: { deleteTorrent: typeof deleteTorrent } | null;

vi.mock("../store/AppStore", () => ({
  useAppStore: () => ({
    services: { debrid: mockDebrid },
    navigate,
  }),
}));

vi.mock("../lib/tauri", () => ({
  isTauri: () => mockTauri,
}));

vi.mock("../data/debridLibrary", () => ({
  useDebridLibrary: () => ({ state: mockState, reload }),
  formatSize: (bytes: number) => (bytes <= 0 ? " - " : `${bytes}B`),
}));

// The lazy dialog: a simple stub that exposes Close / Imported so we can verify
// open/close wiring without the real pako-heavy component.
vi.mock("../components/HashListDialog", () => ({
  HashListDialog: (props: {
    onClose: () => void;
    onImported: () => void;
    torrents: unknown[];
  }) => (
    <div data-testid="hashlist-dialog">
      <span>torrents:{props.torrents.length}</span>
      <button type="button" onClick={props.onClose}>
        close-dialog
      </button>
      <button type="button" onClick={props.onImported}>
        imported-dialog
      </button>
    </div>
  ),
}));

import { DebridLibrary } from "./DebridLibrary";

// --- helpers ----------------------------------------------------------------

function makeTorrent(p: Partial<DebridTorrent> & { id: string; name: string }): DebridTorrent {
  return {
    id: p.id,
    name: p.name,
    sizeBytes: p.sizeBytes ?? 1000,
    status: p.status ?? "downloaded",
    infoHash: p.infoHash ?? null,
    addedAt: p.addedAt ?? null,
    host: p.host ?? null,
    progress: p.progress ?? null,
    debridService: p.debridService ?? "RD",
  };
}

function makeRow(p: Partial<DebridTorrent> & { id: string; name: string }, isDuplicate = false): DebridRow {
  const torrent = makeTorrent(p);
  return { torrent, groupKey: `k:${torrent.id}`, isDuplicate };
}

function baseState(overrides: Partial<DebridLibraryState> = {}): DebridLibraryState {
  return {
    rows: [],
    loading: false,
    error: null,
    hasDebrid: true,
    duplicateCount: 0,
    ...overrides,
  };
}

beforeEach(() => {
  navigate.mockClear();
  deleteTorrent.mockClear();
  reload.mockClear();
  mockTauri = true;
  mockDebrid = { deleteTorrent };
  mockState = baseState();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("DebridLibrary - gated states", () => {
  it("shows the desktop-only state when not running under Tauri", () => {
    mockTauri = false;
    render(<DebridLibrary />);
    expect(
      screen.getByText("Open the desktop app to manage debrid"),
    ).toBeInTheDocument();
    // A download link to the releases page, not the table.
    const link = screen.getByRole("link", { name: /download desktop app/i });
    expect(link).toHaveAttribute(
      "href",
      "https://github.com/Tgk-30/YAWF-Stream/releases/latest",
    );
    expect(screen.queryByLabelText("Search torrents")).not.toBeInTheDocument();
  });

  it("shows the configure-debrid state when no debrid is configured", async () => {
    mockState = baseState({ hasDebrid: false });
    render(<DebridLibrary />);
    expect(screen.getByText("Configure a debrid service")).toBeInTheDocument();
    const open = screen.getByRole("button", { name: /open settings/i });
    await userEvent.click(open);
    expect(navigate).toHaveBeenCalledWith("settings");
  });
});

describe("DebridLibrary - loading / empty / error", () => {
  it("renders a busy skeleton table while loading", () => {
    mockState = baseState({ loading: true });
    render(<DebridLibrary />);
    expect(
      screen.getByLabelText("Loading your debrid library"),
    ).toHaveAttribute("aria-busy", "true");
  });

  it("renders the empty-account state with Refresh + Import actions", async () => {
    mockState = baseState({ rows: [] });
    render(<DebridLibrary />);
    expect(screen.getByText("Nothing on your account yet")).toBeInTheDocument();
    // Both the header and empty-state expose a "Refresh" button; either calls reload.
    const refreshButtons = screen.getAllByRole("button", { name: /^refresh$/i });
    expect(refreshButtons.length).toBeGreaterThanOrEqual(2);
    await userEvent.click(refreshButtons[refreshButtons.length - 1]);
    expect(reload).toHaveBeenCalled();
    // The empty-state Import button opens the hash-list dialog.
    await userEvent.click(screen.getByRole("button", { name: /import hash list/i }));
    expect(await screen.findByTestId("hashlist-dialog")).toBeInTheDocument();
  });

  it("renders the load error", () => {
    mockState = baseState({ rows: [], error: "boom" });
    render(<DebridLibrary />);
    expect(screen.getByText("boom")).toBeInTheDocument();
  });
});

describe("DebridLibrary - table render + filters", () => {
  function rowsState(): DebridLibraryState {
    return baseState({
      rows: [
        makeRow({ id: "1", name: "Alpha Movie", status: "downloaded", debridService: "RD", host: "real-debrid", sizeBytes: 500 }),
        makeRow({ id: "2", name: "Beta Show", status: "downloading", debridService: "AD" }, true),
        makeRow({ id: "3", name: "Gamma Flick", status: "Ready", debridService: "RD" }),
      ],
      duplicateCount: 1,
    });
  }

  it("renders a row per torrent with name, host, status and duplicate badge", () => {
    mockState = rowsState();
    render(<DebridLibrary />);
    expect(screen.getByText("Alpha Movie")).toBeInTheDocument();
    expect(screen.getByText("Beta Show")).toBeInTheDocument();
    expect(screen.getByText("real-debrid")).toBeInTheDocument();
    // Duplicate flagged with a badge + subheader count.
    expect(screen.getByText("Duplicate")).toBeInTheDocument();
    expect(
      screen.getByText(/1 possible duplicate flagged/i),
    ).toBeInTheDocument();
  });

  it("filters by search query (name contains)", async () => {
    mockState = rowsState();
    render(<DebridLibrary />);
    await userEvent.type(screen.getByLabelText("Search torrents"), "beta");
    expect(screen.getByText("Beta Show")).toBeInTheDocument();
    expect(screen.queryByText("Alpha Movie")).not.toBeInTheDocument();
    expect(screen.queryByText("Gamma Flick")).not.toBeInTheDocument();
  });

  it("filters to Ready and to Duplicates via the chips", async () => {
    mockState = rowsState();
    render(<DebridLibrary />);
    await userEvent.click(screen.getByRole("button", { name: "Ready" }));
    // "downloaded" + "Ready" are ready; "downloading" is not.
    expect(screen.getByText("Alpha Movie")).toBeInTheDocument();
    expect(screen.getByText("Gamma Flick")).toBeInTheDocument();
    expect(screen.queryByText("Beta Show")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Duplicates" }));
    expect(screen.getByText("Beta Show")).toBeInTheDocument();
    expect(screen.queryByText("Alpha Movie")).not.toBeInTheDocument();
  });

  it("shows the no-match message when filters exclude everything", async () => {
    mockState = rowsState();
    render(<DebridLibrary />);
    await userEvent.type(screen.getByLabelText("Search torrents"), "zzz-nope");
    expect(
      screen.getByText("No torrents match your filters."),
    ).toBeInTheDocument();
  });
});

describe("DebridLibrary - select-all + delete", () => {
  function twoRows(): DebridLibraryState {
    return baseState({
      rows: [
        makeRow({ id: "1", name: "Alpha", debridService: "RD" }),
        makeRow({ id: "2", name: "Beta", debridService: "AD" }),
      ],
    });
  }

  it("select-all reveals a bulk bar and bulk-deletes every visible row", async () => {
    mockState = twoRows();
    render(<DebridLibrary />);
    await userEvent.click(screen.getByLabelText("Select all"));
    expect(screen.getByText("2 selected")).toBeInTheDocument();

    await userEvent.click(
      screen.getByRole("button", { name: /delete selected/i }),
    );
    await waitFor(() => {
      expect(deleteTorrent).toHaveBeenCalledTimes(2);
    });
    expect(deleteTorrent).toHaveBeenCalledWith("1", "RD");
    expect(deleteTorrent).toHaveBeenCalledWith("2", "AD");
    // After delete the list is reloaded and selection cleared.
    expect(reload).toHaveBeenCalled();
  });

  it("toggling select-all twice clears the selection", async () => {
    mockState = twoRows();
    render(<DebridLibrary />);
    const selectAll = screen.getByLabelText("Select all");
    await userEvent.click(selectAll);
    expect(screen.getByText("2 selected")).toBeInTheDocument();
    await userEvent.click(selectAll);
    expect(screen.queryByText(/selected/)).not.toBeInTheDocument();
  });

  it("a single row checkbox shows a 1-selected bulk bar (partial state)", async () => {
    mockState = twoRows();
    render(<DebridLibrary />);
    await userEvent.click(screen.getByLabelText("Select Alpha"));
    expect(screen.getByText("1 selected")).toBeInTheDocument();
    // header select-all should be indeterminate (some but not all selected).
    const selectAll = screen.getByLabelText("Select all") as HTMLInputElement;
    expect(selectAll.indeterminate).toBe(true);
  });

  it("the per-row trash button deletes just that row", async () => {
    mockState = twoRows();
    render(<DebridLibrary />);
    await userEvent.click(
      screen.getByRole("button", { name: "Delete Alpha" }),
    );
    await waitFor(() => {
      expect(deleteTorrent).toHaveBeenCalledTimes(1);
    });
    expect(deleteTorrent).toHaveBeenCalledWith("1", "RD");
  });

  it("surfaces a partial-failure action error and still reloads", async () => {
    mockState = twoRows();
    deleteTorrent.mockRejectedValueOnce(new Error("nope"));
    render(<DebridLibrary />);
    await userEvent.click(screen.getByLabelText("Select all"));
    await userEvent.click(
      screen.getByRole("button", { name: /delete selected/i }),
    );
    await waitFor(() => {
      expect(
        screen.getByText(/1 item\(s\) could not be deleted: nope/i),
      ).toBeInTheDocument();
    });
    expect(reload).toHaveBeenCalled();
  });
});

describe("DebridLibrary - header actions + dialog", () => {
  it("the header Refresh button calls reload", async () => {
    mockState = baseState({
      rows: [makeRow({ id: "1", name: "Alpha" })],
    });
    render(<DebridLibrary />);
    // The header refresh (there is also one per empty-state, but rows>0 here).
    await userEvent.click(screen.getByRole("button", { name: /refresh/i }));
    expect(reload).toHaveBeenCalled();
  });

  it("opens the hash-list dialog and closes it; passes all torrents", async () => {
    mockState = baseState({
      rows: [
        makeRow({ id: "1", name: "Alpha" }),
        makeRow({ id: "2", name: "Beta" }),
      ],
    });
    render(<DebridLibrary />);
    await userEvent.click(screen.getByRole("button", { name: /hash list/i }));
    const dialog = await screen.findByTestId("hashlist-dialog");
    expect(within(dialog).getByText("torrents:2")).toBeInTheDocument();
    // onImported wiring -> reload
    await userEvent.click(within(dialog).getByText("imported-dialog"));
    expect(reload).toHaveBeenCalled();
    // close wiring
    await userEvent.click(within(dialog).getByText("close-dialog"));
    await waitFor(() => {
      expect(screen.queryByTestId("hashlist-dialog")).not.toBeInTheDocument();
    });
  });
});
