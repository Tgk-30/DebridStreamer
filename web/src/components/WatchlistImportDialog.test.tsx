// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { MediaPreview, MediaType } from "../models/media";

// --- mutable mock state -----------------------------------------------------

const search = vi.fn<(q: string, t: MediaType | null) => Promise<{ items: MediaPreview[] }>>();
const importToWatchlist =
  vi.fn<(p: MediaPreview[]) => Promise<{ added: number; skipped: number }>>();
const createWatchlistFolder = vi.fn();
const assignWatchlistFolder = vi.fn();
let serverMode = false;
let tmdb: { search: typeof search } | null = { search };

vi.mock("../store/AppStore", () => ({
  useAppStore: () => ({ services: { tmdb }, importToWatchlist }),
}));
vi.mock("../lib/serverMode", () => ({ isServerMode: () => serverMode }));
vi.mock("../lib/serverApi", () => ({
  searchServerMedia: (input: { query: string; type: MediaType | null }) =>
    search(input.query, input.type),
}));
vi.mock("../storage", () => ({
  getStore: () => ({ createWatchlistFolder, assignWatchlistFolder }),
}));
vi.mock("./useModalA11y", () => ({ useModalA11y: () => ({ current: null }) }));
vi.mock("./Icon", () => ({ Icon: ({ name }: { name: string }) => <i data-icon={name} /> }));

import { WatchlistImportDialog } from "./WatchlistImportDialog";

function preview(id: string, over: Partial<MediaPreview> = {}): MediaPreview {
  return { id, type: "movie", title: id, ...over };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  serverMode = false;
  tmdb = { search };
  createWatchlistFolder.mockResolvedValue({ id: "folder-imdb", name: "IMDb import" });
  assignWatchlistFolder.mockResolvedValue(undefined);
});

describe("WatchlistImportDialog", () => {
  it("gates when neither a TMDB key nor a server is available", () => {
    tmdb = null;
    serverMode = false;
    render(<WatchlistImportDialog onClose={() => {}} />);
    expect(screen.getByText(/Add a TMDB API key/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Import" })).not.toBeInTheDocument();
  });

  it("shows a live count of detected titles", () => {
    render(<WatchlistImportDialog onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText("Titles or CSV to import"), {
      target: { value: "The Matrix (1999)\nDune" },
    });
    expect(screen.getByText("2 titles detected")).toBeInTheDocument();
  });

  it("resolves entries, imports the matches, and reports the summary", async () => {
    // "The Matrix" matches; "Nope" finds nothing.
    search.mockImplementation(async (q: string) =>
      q === "The Matrix"
        ? { items: [preview("tmdb-603", { title: "The Matrix", year: 1999 })] }
        : { items: [] },
    );
    importToWatchlist.mockResolvedValue({ added: 1, skipped: 0 });

    render(<WatchlistImportDialog onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText("Titles or CSV to import"), {
      target: { value: "The Matrix (1999)\nNope" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Import" }));

    await waitFor(() =>
      expect(screen.getByText(/Added 1 title to your watchlist/i)).toBeInTheDocument(),
    );
    // Only the matched preview was handed to the store.
    expect(importToWatchlist).toHaveBeenCalledWith([
      expect.objectContaining({ id: "tmdb-603" }),
    ]);
    // The unmatched title is reported.
    expect(screen.getByText(/1 couldn't be matched/i)).toBeInTheDocument();
  });

  it("creates an IMDb import folder and assigns every matched title to it", async () => {
    search.mockImplementation(async (q: string) => ({
      items: [preview(`tmdb-${q}`, { title: q, year: q === "Heat" ? 1995 : 1999 })],
    }));
    importToWatchlist.mockResolvedValue({ added: 2, skipped: 0 });

    render(<WatchlistImportDialog onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText("Titles or CSV to import"), {
      target: {
        value: [
          "Const,Title,Title Type,Your Rating,Date Added,Year",
          "tt0113277,Heat,movie,9,2024-01-01,1995",
          "tt0133093,The Matrix,movie,10,2024-01-02,1999",
        ].join("\n"),
      },
    });
    fireEvent.click(screen.getByRole("button", { name: "Import" }));

    await waitFor(() => expect(createWatchlistFolder).toHaveBeenCalledWith("IMDb import"));
    expect(assignWatchlistFolder).toHaveBeenCalledWith("tmdb-Heat", "folder-imdb");
    expect(assignWatchlistFolder).toHaveBeenCalledWith("tmdb-The Matrix", "folder-imdb");
    expect(screen.getByText(/Organized in the IMDb import folder/i)).toBeInTheDocument();
  });
});
