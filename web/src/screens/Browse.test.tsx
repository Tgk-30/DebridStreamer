// @vitest-environment jsdom
//
// Render/interaction tests for the Browse overlay screen.
//
// Browse is dependency-heavy: it reads `browseContext`/`closeBrowse`/`openDetail`/
// `services` off the app store, drives its grid from the read-only `useBrowse()`
// hook, labels chips via `useGenres()`, and lazy-loads a FilterSlideover. We mock
// the store, the data hooks, and child components so we can exercise the screen's
// own branches: null context (no render), title + count, the fixture-note,
// loading skeleton, empty state, results grid + card selection, load-more
// (button + handler), and the active-filter chips (remove one / clear all).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { MediaPreview } from "../models/media";
import type { BrowseContext } from "../data/browse";
import { SortOption } from "../services/metadata/types";

// --- mutable mock state -----------------------------------------------------

let mockBrowseContext: BrowseContext | null = null;
const closeBrowse = vi.fn();
const openDetail = vi.fn();
const openBrowseFilters = vi.fn();
const closeBrowseFilters = vi.fn();
const updateBrowseContext = vi.fn();
const mockServices = { tmdb: {} as never };

vi.mock("../store/AppStore", () => ({
  useAppStore: () => ({
    browseContext: mockBrowseContext,
    closeBrowse,
    openDetail,
    browseFiltersOpen: false,
    openBrowseFilters,
    closeBrowseFilters,
    updateBrowseContext,
    services: mockServices,
  }),
}));

// useBrowse() returns the whole grid state; we drive every branch from here.
let mockBrowseState: Record<string, unknown> = {};
const loadMore = vi.fn();
vi.mock("../data/browse", async () => {
  const actual = await vi.importActual<typeof import("../data/browse")>(
    "../data/browse",
  );
  return {
    ...actual,
    useBrowse: () => ({ loadMore, ...mockBrowseState }),
  };
});

// Genres only matter for chip labels; return the canonical movie list so a
// known id (28 → Action) resolves.
vi.mock("../data/genres", async () => {
  const actual = await vi.importActual<typeof import("../data/genres")>(
    "../data/genres",
  );
  return {
    ...actual,
    useGenres: () => actual.fallbackGenres("movie"),
  };
});

// Child components stripped to the bone so we assert on Browse's own output.
vi.mock("../components/MediaCard", () => ({
  MediaCard: ({
    item,
    onSelect,
  }: {
    item: MediaPreview;
    onSelect: (i: MediaPreview) => void;
  }) => (
    <button data-testid="media-card" onClick={() => onSelect(item)}>
      {item.title}
    </button>
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

// Keep the lazy FilterSlideover from pulling its real chunk; report open state.
vi.mock("../components/FilterSlideover", () => ({
  FilterSlideover: ({ open }: { open: boolean }) => (
    <div data-testid="filter-slideover" data-open={String(open)} />
  ),
}));

// jsdom has no IntersectionObserver; the infinite-scroll effect constructs one.
class FakeIO {
  observe() {}
  disconnect() {}
}
vi.stubGlobal("IntersectionObserver", FakeIO as unknown as typeof IntersectionObserver);

import { Browse } from "./Browse";

const ITEMS: MediaPreview[] = [
  { id: "m1", type: "movie", title: "Dune" },
  { id: "m2", type: "movie", title: "Arrival" },
];

function liveState(over: Partial<Record<string, unknown>> = {}) {
  return {
    items: ITEMS,
    loading: false,
    loadingMore: false,
    error: null,
    page: 1,
    totalPages: 1,
    totalResults: 1234,
    source: "live",
    canLoadMore: false,
    ...over,
  };
}

beforeEach(() => {
  mockBrowseContext = null;
  mockBrowseState = liveState();
  vi.clearAllMocks();
});

afterEach(() => cleanup());

describe("Browse - gating", () => {
  it("renders nothing when there is no browse context", () => {
    mockBrowseContext = null;
    const { container } = render(<Browse />);
    expect(container.firstChild).toBeNull();
  });
});

describe("Browse - header + results", () => {
  beforeEach(() => {
    mockBrowseContext = { kind: "category", type: "movie", category: "popular" };
  });

  it("shows the context title and a live total count", () => {
    render(<Browse />);
    expect(
      screen.getByRole("heading", { name: "Popular movies" }),
    ).toBeInTheDocument();
    // 1234 is rendered with a locale group separator.
    expect(screen.getByText(/1,234 titles/)).toBeInTheDocument();
  });

  it("renders a MediaCard per item and selecting one opens Detail", async () => {
    render(<Browse />);
    const cards = screen.getAllByTestId("media-card");
    expect(cards).toHaveLength(2);
    await userEvent.click(screen.getByText("Dune"));
    expect(openDetail).toHaveBeenCalledWith(ITEMS[0]);
  });

  it("Back button closes the overlay", async () => {
    render(<Browse />);
    await userEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(closeBrowse).toHaveBeenCalledTimes(1);
  });

  it("uses modal semantics and closes with Escape", async () => {
    const user = userEvent.setup();
    render(<Browse />);
    expect(screen.getByRole("dialog", { name: "Popular movies" })).toHaveAttribute(
      "aria-modal",
      "true",
    );

    await user.keyboard("{Escape}");
    expect(closeBrowse).toHaveBeenCalledTimes(1);
  });

  it("does not show a count when totalResults is 0", () => {
    mockBrowseState = liveState({ totalResults: 0 });
    render(<Browse />);
    expect(screen.queryByText(/titles/)).not.toBeInTheDocument();
  });

  it("does not show a count when the source is fixtures", () => {
    mockBrowseState = liveState({ source: "fixtures" });
    render(<Browse />);
    expect(screen.queryByText(/1,234 titles/)).not.toBeInTheDocument();
  });
});

describe("Browse - loading / empty", () => {
  beforeEach(() => {
    mockBrowseContext = { kind: "category", type: "movie", category: "popular" };
  });

  it("renders the skeleton grid while loading (no cards, no empty state)", () => {
    mockBrowseState = liveState({ loading: true, items: [] });
    const { container } = render(<Browse />);
    expect(screen.queryByTestId("media-card")).not.toBeInTheDocument();
    expect(screen.queryByTestId("empty-state")).not.toBeInTheDocument();
    expect(container.querySelectorAll(".browse-skel").length).toBe(18);
  });

  it("renders the empty state when not loading and no items", () => {
    mockBrowseState = liveState({ items: [], totalResults: 0 });
    render(<Browse />);
    expect(screen.getByTestId("empty-state")).toHaveTextContent("Nothing here");
  });
});

describe("Browse - load more", () => {
  beforeEach(() => {
    mockBrowseContext = { kind: "category", type: "movie", category: "popular" };
  });

  it("shows a Load more button when canLoadMore and calls loadMore", async () => {
    mockBrowseState = liveState({ canLoadMore: true, page: 1, totalPages: 3 });
    render(<Browse />);
    const btn = screen.getByRole("button", { name: "Load more" });
    expect(btn).not.toBeDisabled();
    await userEvent.click(btn);
    expect(loadMore).toHaveBeenCalledTimes(1);
  });

  it("disables the button and shows Loading… while loadingMore", () => {
    mockBrowseState = liveState({
      canLoadMore: true,
      loadingMore: true,
      page: 1,
      totalPages: 3,
    });
    render(<Browse />);
    const btn = screen.getByRole("button", { name: "Loading…" });
    expect(btn).toBeDisabled();
    expect(screen.getByText("Loading more…")).toBeInTheDocument();
  });

  it("hides the Load more button when there are no more pages", () => {
    mockBrowseState = liveState({ canLoadMore: false });
    render(<Browse />);
    expect(
      screen.queryByRole("button", { name: /Load more/ }),
    ).not.toBeInTheDocument();
  });
});

describe("Browse - fixture genre note", () => {
  it("shows the no-key note for a fixtures-sourced genre browse", () => {
    mockBrowseContext = {
      kind: "genre",
      type: "movie",
      genreId: 28,
      genreName: "Action",
    };
    mockBrowseState = liveState({ source: "fixtures" });
    render(<Browse />);
    expect(
      screen.getByText(/genre filtering needs a TMDB key/),
    ).toBeInTheDocument();
  });

  it("omits the note for a live genre browse", () => {
    mockBrowseContext = {
      kind: "genre",
      type: "movie",
      genreId: 28,
      genreName: "Action",
    };
    mockBrowseState = liveState({ source: "live" });
    render(<Browse />);
    expect(
      screen.queryByText(/genre filtering needs a TMDB key/),
    ).not.toBeInTheDocument();
  });
});

describe("Browse - filters button + slideover", () => {
  beforeEach(() => {
    mockBrowseContext = { kind: "category", type: "movie", category: "popular" };
  });

  it("mounts the slideover open when Filters is clicked", async () => {
    render(<Browse />);
    // Not mounted before opening.
    expect(screen.queryByTestId("filter-slideover")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /Filters/ }));
    expect(openBrowseFilters).toHaveBeenCalledTimes(1);
  });
});

describe("Browse - active filter chips", () => {
  const discoverCtx: BrowseContext = {
    kind: "discover",
    type: "movie",
    filters: {
      genreIds: [28],
      yearGTE: 2000,
      yearLTE: 2010,
      minRating: 7,
      minVotes: 100,
      runtimeLTE: 120,
      originalLanguage: "ja",
      sortBy: SortOption.ratingDesc,
    },
  };

  beforeEach(() => {
    mockBrowseContext = discoverCtx;
  });

  it("renders a chip per active filter with the right labels", () => {
    render(<Browse />);
    const chips = screen.getByLabelText("Active filters");
    expect(within(chips).getByText("Action")).toBeInTheDocument();
    expect(within(chips).getByText("2000–2010")).toBeInTheDocument();
    expect(within(chips).getByText("7+ rating")).toBeInTheDocument();
    expect(within(chips).getByText("100+ votes")).toBeInTheDocument();
    expect(within(chips).getByText("≤ 120m")).toBeInTheDocument();
    expect(within(chips).getByText("Japanese")).toBeInTheDocument();
    expect(within(chips).getByText("Highest rated")).toBeInTheDocument();
    expect(within(chips).getByText("Clear all")).toBeInTheDocument();
  });

  it("marks the Filters button as active when filters are set", () => {
    render(<Browse />);
    expect(screen.getByRole("button", { name: /Filters/ }).className).toContain(
      "browse-filter-on",
    );
  });

  it("removing a chip re-renders without that chip", async () => {
    render(<Browse />);
    // The Action genre chip carries a "Remove Action" title.
    await userEvent.click(screen.getByTitle("Remove Action"));
    expect(screen.queryByText("Action")).not.toBeInTheDocument();
    // Other chips remain.
    expect(screen.getByText("2000–2010")).toBeInTheDocument();
  });

  it("Clear all drops every chip", async () => {
    render(<Browse />);
    await userEvent.click(screen.getByText("Clear all"));
    expect(screen.queryByLabelText("Active filters")).not.toBeInTheDocument();
    // Title now reflects the popular-category fallback.
    expect(
      screen.getByRole("heading", { name: "Popular movies" }),
    ).toBeInTheDocument();
  });

  it("renders open-ended 'From' and 'Until' year labels", () => {
    mockBrowseContext = {
      kind: "discover",
      type: "movie",
      filters: {
        genreIds: [],
        yearGTE: 1990,
        yearLTE: null,
        minRating: null,
        minVotes: null,
        runtimeLTE: null,
        originalLanguage: null,
        sortBy: SortOption.popularityDesc,
      },
    };
    render(<Browse />);
    expect(screen.getByText("From 1990")).toBeInTheDocument();

    cleanup();
    mockBrowseContext = {
      kind: "discover",
      type: "movie",
      filters: {
        genreIds: [],
        yearGTE: null,
        yearLTE: 2020,
        minRating: null,
        minVotes: null,
        runtimeLTE: null,
        originalLanguage: null,
        sortBy: SortOption.popularityDesc,
      },
    };
    render(<Browse />);
    expect(screen.getByText("Until 2020")).toBeInTheDocument();
  });
});
