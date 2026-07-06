// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { MediaPreview, MediaType } from "../models/media";

// --- mutable mock state -----------------------------------------------------

const search = vi.fn<(q: string, t: MediaType | null) => Promise<{ items: MediaPreview[] }>>();
const importToWatchlist =
  vi.fn<(p: MediaPreview[]) => Promise<{ added: number; skipped: number }>>();
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
});

describe("WatchlistImportDialog", () => {
  it("uses server lookup when server mode is active", async () => {
    serverMode = true;
    tmdb = null;
    search.mockImplementation(async (q: string) =>
      q === "Server Title" ? { items: [preview("tmdb-server-1")] } : { items: [] },
    );
    importToWatchlist.mockResolvedValue({ added: 1, skipped: 0 });

    render(<WatchlistImportDialog onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText("Titles or CSV to import"), {
      target: { value: "Server Title\nNope" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Import" }));

    await waitFor(() =>
      expect(screen.getByText(/Added 1 title to your watchlist/i)).toBeInTheDocument(),
    );
    expect(search).toHaveBeenCalledTimes(2);
    expect(importToWatchlist).toHaveBeenCalledWith([
      expect.objectContaining({ id: "tmdb-server-1" }),
    ]);
    expect(screen.getByText(/1 couldn't be matched/i)).toBeInTheDocument();
  });

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

  it("reads oversized files via slice and warns when truncated", async () => {
    const inputText = "The Matrix (1999)\nDune";
    const { container } = render(<WatchlistImportDialog onClose={() => {}} />);
    const fileInput = container.querySelector('input[type="file"]');

    expect(fileInput).toBeTruthy();

    const oversized = {
      size: 512 * 1024 + 1,
      text: vi.fn(async () => "This should not be read when file is oversized"),
      slice: vi.fn(() => ({ text: async () => inputText })),
    } as unknown as File;

    fireEvent.change(fileInput as HTMLInputElement, {
      target: { files: [oversized] },
    });

    expect(
      await screen.findByText(/only the first part was imported/i),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Titles or CSV to import")).toHaveValue(inputText);
    expect(oversized.text).not.toHaveBeenCalled();
    expect(oversized.slice).toHaveBeenCalledWith(0, 512 * 1024);
  });

  it("handles file read failure and keeps the selected file input clear", async () => {
    const { container } = render(<WatchlistImportDialog onClose={() => {}} />);
    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;

    expect(fileInput).toBeTruthy();

    const brokenFile = {
      size: 128,
      text: vi.fn(async () => {
        throw new Error("boom");
      }),
    } as unknown as File;

    fireEvent.change(fileInput, {
      target: { files: [brokenFile] },
    });

    expect(await screen.findByText(/Could not read that file/i)).toBeInTheDocument();
    expect(fileInput.value).toBe("");
  });

  it("continues imports when lookup fails and shows saved/not-found summary rows", async () => {
    search.mockImplementation(async (q: string) => {
      if (q === "Bad Title") throw new Error("lookup failed");
      return { items: [preview("tmdb-good", { title: "Good Title", year: 2024 })] };
    });
    importToWatchlist.mockResolvedValue({ added: 2, skipped: 1 });

    render(<WatchlistImportDialog onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText("Titles or CSV to import"), {
      target: { value: "Bad Title\nGood Title" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Import" }));

    expect(
      await screen.findByText(/Added 2 titles to your watchlist/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/1 already saved\./i)).toBeInTheDocument();
    expect(screen.getByText(/1 couldn't be matched\./i)).toBeInTheDocument();
    expect(importToWatchlist).toHaveBeenCalledWith([
      expect.objectContaining({ id: "tmdb-good" }),
    ]);
  });
});
