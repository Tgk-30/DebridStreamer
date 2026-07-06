// @vitest-environment jsdom
//
// Render tests for Discover: loading skeleton, hero/rail composition, and every
// mood path:
// - no AI provider → filter-based browse
// - server AI path (curateServerAI)
// - local AI path (services.ai.recommend + TMDB fallback + direct mediaId fallback)

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AIMovieRecommendation } from "../services/ai/models";
import type { MediaPreview } from "../models/media";
import type { WatchHistoryRecord } from "../storage/models";
import { SortOption } from "../services/metadata/types";

// --- mutable mock state ------------------------------------------------------

const mockOpenBrowse = vi.fn();
let mockContinueWatching: WatchHistoryRecord[] = [];
const mockRecommend = vi.fn();
const mockCurateServerAI = vi.fn();
const mockTmdbSearch = vi.fn();
let mockServerMode = false;
let mockMoodPrompt = "thriller 2010s best";

let mockDiscoverState: {
  data: null | {
    hero: MediaPreview | null;
    trendingMovies: MediaPreview[];
    trendingTV: MediaPreview[];
    popularMovies: MediaPreview[];
    topRatedMovies: MediaPreview[];
    nowPlayingMovies: MediaPreview[];
    upcomingMovies: MediaPreview[];
  };
  loading: boolean;
  error: string | null;
  source: "live" | "fixtures";
} = {
  data: null,
  loading: false,
  error: null,
  source: "fixtures",
};

let mockServices: {
  ai: { recommend: typeof mockRecommend } | null;
  tmdb: { search: typeof mockTmdbSearch } | null;
} = {
  ai: null,
  tmdb: null,
};

function railId(title: string): string {
  return `rail:${title}`;
}

function mkItem(
  id: string,
  title: string,
  overrides: Partial<MediaPreview> = {},
): MediaPreview {
  return {
    id,
    type: "movie",
    title,
    ...overrides,
  };
}

function mkResume(mediaId: string, percent: number): WatchHistoryRecord {
  return {
    id: `${mediaId}:resume`,
    mediaId,
    episodeId: null,
    progressSeconds: Math.round(1000 * percent),
    durationSeconds: 1000,
    completed: percent >= 0.95,
    lastWatched: "2026-01-01T00:00:00Z",
    streamQuality: null,
    preview: mkItem(mediaId, `Continue ${mediaId}`),
  };
}

vi.mock("../store/AppStore", () => ({
  useAppStore: () => ({
    openBrowse: mockOpenBrowse,
    continueWatching: mockContinueWatching,
    services: mockServices,
  }),
}));

vi.mock("../data/discover", () => ({
  useDiscover: () => mockDiscoverState,
}));

vi.mock("../lib/serverMode", () => ({
  isServerMode: () => mockServerMode,
}));

vi.mock("../lib/serverApi", () => ({
  curateServerAI: (...args: unknown[]) => mockCurateServerAI(...args),
}));

// Child components are mocked so tests stay deterministic and we can inspect
// branch-visible props.
vi.mock("../components/HeroSpotlight", () => ({
  HeroSpotlight: ({ items, onPlay }: any) => (
    <div>
      <div data-testid="hero-item-count">{items.length}</div>
      <div data-testid="hero-items">{items.map((item: MediaPreview) => item.id).join("|")}</div>
      {items.map((item: MediaPreview) => (
        <button key={item.id} type="button" onClick={() => onPlay?.(item)}>
          hero:{item.id}
        </button>
      ))}
    </div>
  ),
}));

vi.mock("../components/MoodStrip", () => ({
  MoodStrip: ({
    onCurate,
    loading,
    status,
    error,
    aiAvailable,
  }: {
    onCurate: (prompt: string) => void;
    loading: boolean;
    status: string | null;
    error: string | null;
    aiAvailable: boolean;
  }) => (
    <div>
      <button type="button" onClick={() => onCurate(mockMoodPrompt)}>
        run mood
      </button>
      <span data-testid="mood-loading">{loading ? "loading" : "idle"}</span>
      <span data-testid="mood-status">{status ?? ""}</span>
      <span data-testid="mood-error">{error ?? ""}</span>
      <span data-testid="mood-ai">{aiAvailable ? "ai" : "no"}</span>
    </div>
  ),
}));

vi.mock("../components/Rail", () => ({
  Rail: ({
    title,
    items,
    onSelect,
    onSeeAll,
  }: {
    title: string;
    items: MediaPreview[];
    onSelect?: (item: MediaPreview) => void;
    onSeeAll?: () => void;
  }) => (
    <section data-testid={`rail:${title}`}>
      <h3>{title}</h3>
      {items.map((item: MediaPreview) => (
        <button
          key={`${item.type}:${item.id}`}
          type="button"
          onClick={() => onSelect?.(item)}
          data-id={item.id}
        >
          {title}:{item.id}
        </button>
      ))}
      {onSeeAll ? <button type="button" onClick={onSeeAll}>see-all</button> : null}
    </section>
  ),
}));

import { Discover } from "./Discover";

beforeEach(() => {
  mockOpenBrowse.mockClear();
  mockRecommend.mockReset();
  mockCurateServerAI.mockReset();
  mockTmdbSearch.mockReset();
  mockContinueWatching = [];
  mockServerMode = false;
  mockMoodPrompt = "thriller 2010s best";
  mockServices = {
    ai: null,
    tmdb: null,
  };
  mockDiscoverState = {
    loading: false,
    error: null,
    source: "fixtures",
    data: {
      hero: mkItem("hero1", "Hero One", { backdropPath: "/hero.jpg" }),
      trendingMovies: [
        mkItem("hero1", "Hero One", { backdropPath: "/hero.jpg" }),
        mkItem("trend1", "Trend One", { backdropPath: "/tm.jpg" }),
      ],
      trendingTV: [],
      popularMovies: [mkItem("popular1", "Popular One")],
      topRatedMovies: [mkItem("top1", "Top One")],
      nowPlayingMovies: [mkItem("now1", "Now One")],
      upcomingMovies: [mkItem("up1", "Up One")],
    },
  };
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("Discover — loading", () => {
  it("renders the loading skeleton when discover data is loading", () => {
    mockDiscoverState = { data: null, loading: true, error: null, source: "fixtures" };
    const { container } = render(<Discover />);
    expect(container.querySelector(".discover")).toBeTruthy();
    expect(container.querySelector(".skel-hero")).toBeTruthy();
    expect(container.querySelectorAll(".skel-rail")).toHaveLength(3);
  });
});

describe("Discover — content", () => {
  it("renders hero, continue watching, and rails with hero dedupe", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    mockContinueWatching = [mkResume("resume-a", 0.5), mkResume("resume-b", 0.01), mkResume("resume-c", 0.97)];
    mockDiscoverState = {
      ...mockDiscoverState,
      data: {
        hero: mkItem("hero-main", "Hero One", { backdropPath: "/hero.jpg" }),
        trendingMovies: [
          mkItem("hero-main", "Hero One", { backdropPath: "/hero-dup.jpg" }),
          mkItem("trend1", "Trend One", { backdropPath: "/trend1.jpg" }),
          mkItem("hero-no-backdrop", "Hero No Backdrop", { backdropPath: null }),
        ],
        trendingTV: [mkItem("hero-main", "Hero TV", { type: "series", backdropPath: "/tv.jpg" })],
        popularMovies: [mkItem("popular1", "Popular One")],
        topRatedMovies: [mkItem("top1", "Top One")],
        nowPlayingMovies: [mkItem("now1", "Now One")],
        upcomingMovies: [mkItem("up1", "Up One")],
      },
    };

    render(<Discover onSelect={onSelect} />);

    expect(screen.getByTestId("hero-item-count")).toHaveTextContent("3");
    expect(screen.getByTestId("hero-items")).toHaveTextContent("hero-main|trend1|hero-main");

    const trendingMoviesRail = screen.getByTestId(railId("Trending Movies"));
    expect(trendingMoviesRail).toHaveTextContent("Trending Movies:trend1");
    expect(trendingMoviesRail).not.toHaveTextContent("Trending Movies:hero-main");

    const continueRail = screen.getByTestId(railId("Continue Watching"));
    const resumeButton = within(continueRail).getByRole("button", {
      name: "Continue Watching:resume-a",
    });
    expect(resumeButton).toBeInTheDocument();
    expect(resumeButton).toHaveAttribute("data-id", "resume-a");
    await user.click(resumeButton);
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: "resume-a" }));
  });

  it("renders correctly when no hero is available", () => {
    mockDiscoverState = {
      ...mockDiscoverState,
      data: {
        hero: null,
        trendingMovies: [
          mkItem("trend1", "Trend One", { backdropPath: "/tm.jpg" }),
          mkItem("trend2", "Trend Two", { backdropPath: "/tm2.jpg" }),
        ],
        trendingTV: [mkItem("tv1", "TV One", { type: "series", backdropPath: "/tv.jpg" })],
        popularMovies: [mkItem("popular1", "Popular One")],
        topRatedMovies: [mkItem("top1", "Top One")],
        nowPlayingMovies: [mkItem("now1", "Now One")],
        upcomingMovies: [mkItem("up1", "Up One")],
      },
    };

    render(<Discover />);
    expect(screen.queryByTestId("hero-item-count")).not.toBeInTheDocument();
    const trendingMoviesRail = screen.getByTestId(railId("Trending Movies"));
    expect(trendingMoviesRail).toHaveTextContent("Trending Movies:trend1");
    expect(trendingMoviesRail).toHaveTextContent("Trending Movies:trend2");
  });
});

describe("Discover — no AI mood path", () => {
  it("opens discover browse with filters for mood keywords", async () => {
    const user = userEvent.setup();
    mockMoodPrompt =
      "mystery thriller sci-fi road adventure feel-good animated family 2010s best mind-bending";

    render(<Discover />);
    await user.click(screen.getByRole("button", { name: "run mood" }));

    expect(screen.getByTestId("mood-status")).toHaveTextContent(
      "No AI provider is configured, so this opened a filter-based browse.",
    );
    expect(mockOpenBrowse).toHaveBeenCalledWith({
      kind: "discover",
      type: "movie",
      filters: expect.objectContaining({
        genreIds: [9648, 53, 878, 12, 35, 16, 10751],
        yearGTE: 2010,
        yearLTE: 2019,
        minRating: 7,
        minVotes: null,
        runtimeLTE: null,
        originalLanguage: null,
        sortBy: SortOption.ratingDesc,
      }),
    });
    expect(screen.getByTestId("mood-ai")).toHaveTextContent("no");
  });

  it("opens browse with classic-era filters", async () => {
    const user = userEvent.setup();
    mockMoodPrompt = "classic 1990s noir";

    render(<Discover />);
    await user.click(screen.getByRole("button", { name: "run mood" }));

    expect(screen.getByTestId("mood-status")).toHaveTextContent(
      "No AI provider is configured, so this opened a filter-based browse.",
    );
    expect(mockOpenBrowse).toHaveBeenCalledWith({
      kind: "discover",
      type: "movie",
      filters: expect.objectContaining({
        genreIds: [9648],
        yearGTE: null,
        yearLTE: 1999,
        minRating: null,
        sortBy: SortOption.popularityDesc,
      }),
    });
  });

  it("defaults filters when no recognizable mood tokens are found", async () => {
    const user = userEvent.setup();
    mockMoodPrompt = "a random cozy prompt";

    render(<Discover />);
    await user.click(screen.getByRole("button", { name: "run mood" }));

    expect(mockOpenBrowse).toHaveBeenCalledWith({
      kind: "discover",
      type: "movie",
      filters: expect.objectContaining({
        genreIds: [35],
        yearGTE: null,
        yearLTE: null,
        minRating: null,
        minVotes: null,
        runtimeLTE: null,
        originalLanguage: null,
        sortBy: SortOption.popularityDesc,
      }),
    });
  });

  it("handles older-era vibe keywords with non-1990s year filtering", async () => {
    const user = userEvent.setup();
    mockMoodPrompt = "older";

    render(<Discover />);
    await user.click(screen.getByRole("button", { name: "run mood" }));

    expect(mockOpenBrowse).toHaveBeenCalledWith({
      kind: "discover",
      type: "movie",
      filters: expect.objectContaining({
        yearLTE: 1989,
      }),
    });
  });
});

describe("Discover — server AI mood path", () => {
  it("uses server recommendations and enables See all on the result rail", async () => {
    const user = userEvent.setup();
    const vibe = "server picks this week";
    mockServerMode = true;
    mockMoodPrompt = vibe;
    mockCurateServerAI.mockResolvedValue({
      items: [mkItem("s1", "Server Pick"), mkItem("s2", "Server Two")],
    });

    render(<Discover />);
    await user.click(screen.getByRole("button", { name: "run mood" }));

    expect(await screen.findByText("2 titles matched.")).toBeInTheDocument();
    const title = `Mood picks for “${vibe}”`;
    const moodRail = screen.getByTestId(railId(title));
    expect(within(moodRail).getByRole("button", { name: `${title}:s1` })).toBeInTheDocument();
    expect(within(moodRail).getByRole("button", { name: `${title}:s2` })).toBeInTheDocument();

    await user.click(within(moodRail).getByRole("button", { name: "see-all" }));
    expect(mockOpenBrowse).toHaveBeenCalledWith({
      kind: "search",
      type: null,
      query: vibe,
    });
  });

  it("reports no-match when server recommendations are empty", async () => {
    const user = userEvent.setup();
    mockServerMode = true;
    mockMoodPrompt = "server no matches";
    mockCurateServerAI.mockResolvedValue({ items: [] });

    render(<Discover />);
    await user.click(screen.getByRole("button", { name: "run mood" }));
    expect(await screen.findByText("The assistant returned titles, but none could be matched.")).toBeInTheDocument();
  });

  it("surfaces curateServerAI errors in the mood status", async () => {
    const user = userEvent.setup();
    mockServerMode = true;
    mockMoodPrompt = "server error";
    mockCurateServerAI.mockRejectedValue(new Error("server failed"));

    render(<Discover />);
    await user.click(screen.getByRole("button", { name: "run mood" }));
    expect(await screen.findByText("server failed")).toBeInTheDocument();
  });

  it("surfaces non-Error server errors in the mood status", async () => {
    const user = userEvent.setup();
    mockServerMode = true;
    mockMoodPrompt = "server string";
    mockCurateServerAI.mockRejectedValue("server string failure");

    render(<Discover />);
    await user.click(screen.getByRole("button", { name: "run mood" }));
    expect(await screen.findByText("server string failure")).toBeInTheDocument();
  });
});

describe("Discover — local AI mood path", () => {
  it("resolves TMDB-backed recommendations, picks best match, and deduplicates", async () => {
    const user = userEvent.setup();
    mockMoodPrompt = "local sorted dedupe";
    const recs: AIMovieRecommendation[] = [
      { title: "Match Me", mediaType: "movie", year: 2022, mediaId: "ignore-1", posterPath: "/a.jpg" },
      { title: "Match Me", mediaType: "movie", year: 2022, mediaId: "ignore-2", posterPath: "/b.jpg" },
      { title: "Missing", mediaType: "movie", year: 2021, mediaId: "ignore-3", posterPath: null },
    ];

    mockServices = {
      ...mockServices,
      ai: { recommend: mockRecommend },
      tmdb: { search: mockTmdbSearch },
    };
    mockRecommend.mockResolvedValue({ recommendations: recs });
    mockTmdbSearch.mockImplementation(async (query: string) => {
      if (query === "Match Me") {
        return {
          items: [
            mkItem("low-confidence", "Match Me: Extra", { year: 2022 }),
            mkItem("exact-match", "Match Me", { year: 2022 }),
            mkItem("near-match", "Match Me", { year: 2021 }),
          ],
        };
      }
      return { items: [] };
    });

    render(<Discover />);
    await user.click(screen.getByRole("button", { name: "run mood" }));

    expect(await screen.findByText("1 titles matched.")).toBeInTheDocument();
    const title = `Mood picks for “${mockMoodPrompt}”`;
    const moodRail = screen.getByTestId(railId(title));
    expect(within(moodRail).getByRole("button", { name: `${title}:exact-match` })).toBeInTheDocument();
    expect(within(moodRail).queryByRole("button", { name: `${title}:low-confidence` })).toBeNull();
    expect(within(moodRail).queryByRole("button", { name: `${title}:near-match` })).toBeNull();
    expect(mockTmdbSearch).toHaveBeenCalledTimes(3);
  });

  it("falls back to the recommendation mediaId when TMDB is not available", async () => {
    const user = userEvent.setup();
    mockMoodPrompt = "fallback to direct";
    mockServices = {
      ...mockServices,
      ai: { recommend: mockRecommend },
      tmdb: null,
    };
    mockRecommend.mockResolvedValue({
      recommendations: [
        {
          title: "Offline Match",
          year: 2018,
          mediaType: "movie",
          mediaId: "offline-id",
          posterPath: "/offline.jpg",
        },
      ],
    });

    render(<Discover />);
    await user.click(screen.getByRole("button", { name: "run mood" }));

    expect(await screen.findByText("1 titles matched.")).toBeInTheDocument();
    const title = `Mood picks for “${mockMoodPrompt}”`;
    const moodRail = screen.getByTestId(railId(title));
    expect(within(moodRail).getByRole("button", { name: `${title}:offline-id` })).toBeInTheDocument();
  });

  it("surfaces no-match when recommendation items cannot be resolved", async () => {
    const user = userEvent.setup();
    mockMoodPrompt = "unresolvable";
    mockServices = {
      ...mockServices,
      ai: { recommend: mockRecommend },
      tmdb: { search: mockTmdbSearch },
    };
    mockRecommend.mockResolvedValue({
      recommendations: [{ title: "Nope", mediaType: "movie", year: 2000, mediaId: null, posterPath: null }],
    });
    mockTmdbSearch.mockResolvedValue({ items: [] });

    render(<Discover />);
    await user.click(screen.getByRole("button", { name: "run mood" }));
    expect(
      await screen.findByText("The assistant returned titles, but none could be matched."),
    ).toBeInTheDocument();
  });

  it("shows recommendation errors from local AI", async () => {
    const user = userEvent.setup();
    mockMoodPrompt = "local failure";
    mockServices = {
      ...mockServices,
      ai: { recommend: mockRecommend },
      tmdb: { search: mockTmdbSearch },
    };
    mockRecommend.mockRejectedValue(new Error("recommendation failed"));

    render(<Discover />);
    await user.click(screen.getByRole("button", { name: "run mood" }));
    expect(await screen.findByText("recommendation failed")).toBeInTheDocument();
  });

  it("falls back to null when ai recommendation has no resolvable IDs without TMDB", async () => {
    const user = userEvent.setup();
    mockMoodPrompt = "null recommendation fields";
    mockServices = {
      ...mockServices,
      ai: { recommend: mockRecommend },
      tmdb: null,
    };
    mockRecommend.mockResolvedValue({
      recommendations: [
        {
          title: "No Ids",
          year: 2025,
          mediaType: null,
          mediaId: null,
          posterPath: null,
        },
      ],
    });

    render(<Discover />);
    await user.click(screen.getByRole("button", { name: "run mood" }));
    expect(
      await screen.findByText("The assistant returned titles, but none could be matched."),
    ).toBeInTheDocument();
  });

  it("skips a resolution error from one recommendation and keeps the others", async () => {
    const user = userEvent.setup();
    mockMoodPrompt = "partial tmdb failures";
    mockServices = {
      ...mockServices,
      ai: { recommend: mockRecommend },
      tmdb: { search: mockTmdbSearch },
    };
    mockRecommend.mockResolvedValue({
      recommendations: [
        { title: "Good Match", mediaType: "movie", year: 2021, mediaId: "ignore-1", posterPath: "/good.jpg" },
        { title: "Bad Search", mediaType: "movie", year: 2022, mediaId: "ignore-2", posterPath: null },
      ],
    });
    mockTmdbSearch.mockImplementation(async (query: string) => {
      if (query === "Good Match") {
        return {
          items: [mkItem("good-match", "Good Match", { year: 2021 })],
        };
      }
      return Promise.reject(new Error("search failed"));
    });

    render(<Discover />);
    await user.click(screen.getByRole("button", { name: "run mood" }));
    expect(await screen.findByText("1 titles matched.")).toBeInTheDocument();
    const title = `Mood picks for “${mockMoodPrompt}”`;
    const moodRail = screen.getByTestId(railId(title));
    expect(within(moodRail).getByRole("button", { name: `${title}:good-match` })).toBeInTheDocument();
    expect(within(moodRail).queryByRole("button", { name: `${title}:bad` })).toBeNull();
  });

  it("covers title and year comparator branches for near matches", async () => {
    const user = userEvent.setup();
    mockMoodPrompt = "comparator edge case";
    mockServices = {
      ...mockServices,
      ai: { recommend: mockRecommend },
      tmdb: { search: mockTmdbSearch },
    };
    mockRecommend.mockResolvedValue({
      recommendations: [
        {
          title: "Sort Me",
          mediaType: null,
          year: null,
          mediaId: null,
          posterPath: null,
        },
      ],
    });
    mockTmdbSearch.mockResolvedValue({
      items: [
        mkItem("candidate-b", "Sort Me", { year: 1998 }),
        mkItem("candidate-a", "Sort Me: Extra", { year: 1999 }),
      ],
    });

    render(<Discover />);
    await user.click(screen.getByRole("button", { name: "run mood" }));
    expect(await screen.findByText("1 titles matched.")).toBeInTheDocument();
    const title = `Mood picks for “${mockMoodPrompt}”`;
    const moodRail = screen.getByTestId(railId(title));
    expect(within(moodRail).getByRole("button", { name: `${title}:candidate-b` })).toBeInTheDocument();
  });

  it("surfaces non-Error local AI failures", async () => {
    const user = userEvent.setup();
    mockMoodPrompt = "local string";
    mockServices = {
      ...mockServices,
      ai: { recommend: mockRecommend },
      tmdb: { search: mockTmdbSearch },
    };
    mockRecommend.mockRejectedValue("local string failure");

    render(<Discover />);
    await user.click(screen.getByRole("button", { name: "run mood" }));
    expect(await screen.findByText("local string failure")).toBeInTheDocument();
  });
});
