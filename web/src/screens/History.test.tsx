// @vitest-environment jsdom
//
// Render tests for the History screen. It reads `history` (recently-opened
// previews) and `continueWatching` (raw WatchHistoryRecords) from the store. The
// rail surfaces only records with a meaningful resume point (hasResumePoint),
// with a per-id progress fraction; the grid shows the full history, or an
// empty-state with Browse / Search CTAs when there's nothing.
//
// The store is mocked for the data + nav callbacks; MediaGrid / Rail are stubbed
// so we assert on the item lists (and the rail's progress map) without the real
// MediaCard image plumbing.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { MediaPreview } from "../models/media";
import type { WatchHistoryRecord } from "../storage/models";

// --- mutable mock state -----------------------------------------------------

const openDetail = vi.fn();
const openBrowse = vi.fn();
const navigate = vi.fn();
let mockHistory: MediaPreview[] = [];
let mockContinueWatching: WatchHistoryRecord[] = [];

vi.mock("../store/AppStore", () => ({
  useAppStore: () => ({
    history: mockHistory,
    continueWatching: mockContinueWatching,
    openDetail,
    openBrowse,
    navigate,
  }),
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
  Rail: (props: {
    title: string;
    items: MediaPreview[];
    progressById?: Record<string | number, number>;
    onSelect?: (i: MediaPreview) => void;
  }) => (
    <div data-testid="rail">
      <span data-testid="rail-title">{props.title}</span>
      {props.items.map((i) => (
        <button
          key={i.id}
          type="button"
          data-progress={props.progressById?.[i.id]}
          onClick={() => props.onSelect?.(i)}
        >
          rail:{i.title}
        </button>
      ))}
    </div>
  ),
}));

import { History } from "./History";

// --- helpers ----------------------------------------------------------------

function preview(id: string, title: string): MediaPreview {
  return { id, type: "movie", title };
}

function record(
  id: string,
  title: string,
  progressSeconds: number,
  durationSeconds: number | null,
): WatchHistoryRecord {
  return {
    id,
    mediaId: id,
    episodeId: null,
    progressSeconds,
    durationSeconds,
    completed: false,
    lastWatched: "2026-06-01T00:00:00Z",
    streamQuality: null,
    preview: preview(id, title),
  };
}

beforeEach(() => {
  openDetail.mockClear();
  openBrowse.mockClear();
  navigate.mockClear();
  mockHistory = [];
  mockContinueWatching = [];
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("History — empty", () => {
  it("renders the empty-state with Browse + Search CTAs when nothing watched", async () => {
    render(<History />);
    expect(screen.getByText("Nothing here yet")).toBeInTheDocument();
    expect(screen.queryByTestId("media-grid")).not.toBeInTheDocument();
    expect(screen.queryByTestId("rail")).not.toBeInTheDocument();

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

describe("History — grid", () => {
  it("renders the history grid and opens detail on select", async () => {
    mockHistory = [preview("m1", "Heat"), preview("m2", "Drive")];
    render(<History />);
    expect(screen.getByText("grid:Heat")).toBeInTheDocument();
    expect(screen.getByText("grid:Drive")).toBeInTheDocument();
    expect(screen.queryByText("Nothing here yet")).not.toBeInTheDocument();

    await userEvent.click(screen.getByText("grid:Drive"));
    expect(openDetail).toHaveBeenCalledWith(
      expect.objectContaining({ id: "m2" }),
    );
  });
});

describe("History — Continue Watching rail", () => {
  it("surfaces only records with a resume point and passes their progress fraction", async () => {
    mockHistory = [preview("m1", "Heat")];
    mockContinueWatching = [
      record("m1", "Heat", 1800, 3600), // 50% — resumable
      record("m2", "Tooearly", 10, 3600), // ~0.3% — below floor, dropped
      record("m3", "Almostdone", 3500, 3600), // ~97% — above ceiling, dropped
    ];
    render(<History />);

    const rail = screen.getByTestId("rail");
    expect(screen.getByTestId("rail-title")).toHaveTextContent(
      "Continue Watching",
    );
    expect(screen.getByText("rail:Heat")).toBeInTheDocument();
    expect(screen.queryByText("rail:Tooearly")).not.toBeInTheDocument();
    expect(screen.queryByText("rail:Almostdone")).not.toBeInTheDocument();

    const resumeBtn = screen.getByText("rail:Heat");
    expect(resumeBtn).toHaveAttribute("data-progress", "0.5");

    await userEvent.click(resumeBtn);
    expect(openDetail).toHaveBeenCalledWith(
      expect.objectContaining({ id: "m1" }),
    );
    // The rail lives alongside the grid.
    expect(rail).toBeInTheDocument();
  });

  it("hides the rail when no record has a resume point", () => {
    mockHistory = [preview("m1", "Heat")];
    mockContinueWatching = [record("m1", "Heat", 3600, 3600)]; // 100% complete
    render(<History />);
    expect(screen.queryByTestId("rail")).not.toBeInTheDocument();
    expect(screen.getByText("grid:Heat")).toBeInTheDocument();
  });
});
