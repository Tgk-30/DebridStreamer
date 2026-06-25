// @vitest-environment jsdom
//
// Render/interaction tests for the Discover screen. The screen is dependency-
// heavy, so the data hook (useDiscover), the app store, serverMode, and the
// serverApi curate call are mocked, and the child surfaces (HeroSpotlight,
// MoodStrip, Rail) are replaced with lightweight test doubles that expose their
// props/callbacks as DOM. The pure storage/models helpers are used as-is.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { MediaPreview } from "../models/media";
import type { WatchHistoryRecord } from "../storage/models";
import type { DiscoverData } from "../data/discover";

// --- mutable mock state -----------------------------------------------------

let mockDiscover: { data: DiscoverData | null; loading: boolean } = {
  data: null,
  loading: true,
};

const openBrowse = vi.fn();
let mockContinueWatching: WatchHistoryRecord[] = [];
let mockServices: {
  tmdb: unknown;
  ai: { recommend: ReturnType<typeof vi.fn> } | null;
} = { tmdb: null, ai: null };

vi.mock("../data/discover", () => ({
  useDiscover: () => mockDiscover,
}));

vi.mock("../store/AppStore", () => ({
  useAppStore: () => ({
    services: mockServices,
    openBrowse,
    continueWatching: mockContinueWatching,
  }),
}));

let serverModeOn = false;
vi.mock("../lib/serverMode", () => ({
  isServerMode: () => serverModeOn,
}));

const curateServerAI = vi.fn();
vi.mock("../lib/serverApi", () => ({
  curateServerAI: (...args: unknown[]) => curateServerAI(...args),
}));

// Child doubles. Each renders its title/props so the parent wiring is testable.
vi.mock("../components/HeroSpotlight", () => ({
  HeroSpotlight: ({ items, onPlay, onDetails }: any) => (
    <div data-testid="hero">
      <span data-testid="hero-count">{items.length}</span>
      <button onClick={() => onPlay?.(items[0])}>hero-play</button>
      <button onClick={() => onDetails?.(items[0])}>hero-details</button>
    </div>
  ),
}));

vi.mock("../components/MoodStrip", () => ({
  MoodStrip: ({ onCurate, loading, status, error }: any) => (
    <div data-testid="moodstrip">
      <span data-testid="mood-loading">{String(loading)}</span>
      <span data-testid="mood-status">{status ?? ""}</span>
      <span data-testid="mood-error">{error ?? ""}</span>
      <button onClick={() => onCurate?.("cozy mystery")}>curate</button>
    </div>
  ),
}));

vi.mock("../components/Rail", () => ({
  Rail: ({ title, items, onSelect, onSeeAll, progressById }: any) => (
    <div data-testid="rail" data-title={title}>
      <span data-testid="rail-title">{title}</span>
      <span data-testid="rail-count">{items.length}</span>
      <span data-testid="rail-has-seeall">{String(onSeeAll != null)}</span>
      <span data-testid="rail-progress">{JSON.stringify(progressById ?? null)}</span>
      {items.map((it: MediaPreview) => (
        <button key={it.id} onClick={() => onSelect?.(it)}>
          item-{it.id}
        </button>
      ))}
      {onSeeAll && <button onClick={() => onSeeAll()}>seeall-{title}</button>}
    </div>
  ),
}));

import { Discover } from "./Discover";

// --- fixtures ---------------------------------------------------------------

function preview(id: string, over: Partial<MediaPreview> = {}): MediaPreview {
  return { id, type: "movie", title: `Title ${id}`, ...over };
}

function fullData(): DiscoverData {
  return {
    hero: preview("hero1", { backdropPath: "/bd.jpg", type: "movie" }),
    trendingMovies: [
      preview("tm1", { backdropPath: "/a.jpg" }),
      preview("tm2"),
    ],
    trendingTV: [preview("tv1", { type: "series" })],
    popularMovies: [preview("pm1")],
    topRatedMovies: [preview("tr1")],
    nowPlayingMovies: [preview("np1")],
    upcomingMovies: [preview("up1")],
  };
}

function historyRecord(
  id: string,
  progress: number,
  duration: number | null,
): WatchHistoryRecord {
  return {
    id,
    mediaId: id,
    episodeId: null,
    progressSeconds: progress,
    durationSeconds: duration,
    completed: false,
    lastWatched: new Date().toISOString(),
    streamQuality: null,
    preview: preview(id),
  };
}

beforeEach(() => {
  mockDiscover = { data: null, loading: true };
  mockContinueWatching = [];
  mockServices = { tmdb: null, ai: null };
  serverModeOn = false;
  openBrowse.mockReset();
  curateServerAI.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("Discover skeleton", () => {
  it("renders the cold-start skeleton while loading", () => {
    mockDiscover = { data: null, loading: true };
    const { container } = render(<Discover />);
    expect(container.querySelector(".skel-hero")).not.toBeNull();
    // three redacted rails, six cards each
    expect(container.querySelectorAll(".skel-rail")).toHaveLength(3);
    expect(container.querySelectorAll(".skel-card")).toHaveLength(18);
    expect(screen.queryByTestId("hero")).toBeNull();
  });

  it("renders the skeleton when not loading but data is still null", () => {
    mockDiscover = { data: null, loading: false };
    const { container } = render(<Discover />);
    expect(container.querySelector(".skel-hero")).not.toBeNull();
  });
});

describe("Discover loaded", () => {
  it("renders hero and all rails when data is present", () => {
    mockDiscover = { data: fullData(), loading: false };
    render(<Discover />);
    expect(screen.getByTestId("hero")).toBeInTheDocument();

    const titles = screen.getAllByTestId("rail-title").map((n) => n.textContent);
    expect(titles).toEqual(
      expect.arrayContaining([
        "Continue Watching",
        "Mood picks",
        "Trending Movies",
        "Trending TV Shows",
        "Popular Movies",
        "Top Rated Movies",
        "Now Playing",
        "Upcoming",
      ]),
    );
  });

  it("hides the hero when data.hero is null", () => {
    mockDiscover = { data: { ...fullData(), hero: null }, loading: false };
    render(<Discover />);
    expect(screen.queryByTestId("hero")).toBeNull();
  });

  it("filters the hero item out of the trending rails (withoutHero)", () => {
    const data = fullData();
    // hero1 is also injected into trendingMovies to prove dedupe.
    data.trendingMovies = [
      preview("hero1", { backdropPath: "/bd.jpg" }),
      preview("tm2"),
    ];
    mockDiscover = { data, loading: false };
    render(<Discover />);
    const trendingMovies = screen
      .getAllByTestId("rail")
      .find((r) => r.getAttribute("data-title") === "Trending Movies")!;
    // hero1 removed, only tm2 left.
    expect(within(trendingMovies).queryByText("item-hero1")).toBeNull();
    expect(within(trendingMovies).getByText("item-tm2")).toBeInTheDocument();
  });

  it("does not filter rails when there is no hero", () => {
    const data = fullData();
    data.hero = null;
    data.trendingMovies = [preview("tm1"), preview("tm2")];
    mockDiscover = { data, loading: false };
    render(<Discover />);
    const trendingMovies = screen
      .getAllByTestId("rail")
      .find((r) => r.getAttribute("data-title") === "Trending Movies")!;
    expect(within(trendingMovies).getByTestId("rail-count").textContent).toBe("2");
  });

  it("forwards item clicks to onSelect", async () => {
    const onSelect = vi.fn();
    mockDiscover = { data: fullData(), loading: false };
    render(<Discover onSelect={onSelect} />);
    await userEvent.click(screen.getByText("item-pm1"));
    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({ id: "pm1" }),
    );
  });

  it("wires hero onPlay/onDetails to onSelect", async () => {
    const onSelect = vi.fn();
    mockDiscover = { data: fullData(), loading: false };
    render(<Discover onSelect={onSelect} />);
    await userEvent.click(screen.getByText("hero-play"));
    await userEvent.click(screen.getByText("hero-details"));
    expect(onSelect).toHaveBeenCalledTimes(2);
  });
});

describe("Discover Continue Watching", () => {
  it("surfaces resumable items with per-card progress", () => {
    // 50% → resumable; progress 0.5
    mockContinueWatching = [historyRecord("res1", 50, 100)];
    mockDiscover = { data: fullData(), loading: false };
    render(<Discover />);
    const cw = screen
      .getAllByTestId("rail")
      .find((r) => r.getAttribute("data-title") === "Continue Watching")!;
    expect(within(cw).getByText("item-res1")).toBeInTheDocument();
    expect(within(cw).getByTestId("rail-progress").textContent).toContain(
      '"res1":0.5',
    );
  });

  it("excludes finished/barely-started items (hasResumePoint filter)", () => {
    mockContinueWatching = [
      historyRecord("done", 99, 100), // 99% → excluded
      historyRecord("fresh", 1, 100), // 1% → excluded
    ];
    mockDiscover = { data: fullData(), loading: false };
    render(<Discover />);
    const cw = screen
      .getAllByTestId("rail")
      .find((r) => r.getAttribute("data-title") === "Continue Watching")!;
    expect(within(cw).getByTestId("rail-count").textContent).toBe("0");
  });
});

describe("Discover See all", () => {
  it("opens browse with the category context for a rail", async () => {
    mockDiscover = { data: fullData(), loading: false };
    render(<Discover />);
    await userEvent.click(screen.getByText("seeall-Trending Movies"));
    expect(openBrowse).toHaveBeenCalledWith({
      kind: "category",
      type: "movie",
      category: "trending",
    });
  });

  it("opens browse for the trending TV rail with type series", async () => {
    mockDiscover = { data: fullData(), loading: false };
    render(<Discover />);
    await userEvent.click(screen.getByText("seeall-Trending TV Shows"));
    expect(openBrowse).toHaveBeenCalledWith({
      kind: "category",
      type: "series",
      category: "trending",
    });
  });
});

describe("Discover mood — no AI (filter-based fallback)", () => {
  it("opens a filter-based browse and surfaces a status when no AI provider", async () => {
    mockServices = { tmdb: null, ai: null };
    mockDiscover = { data: fullData(), loading: false };
    render(<Discover />);
    await userEvent.click(screen.getByText("curate"));
    expect(openBrowse).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "discover", type: "movie" }),
    );
    // mood title updated and a status message rendered.
    expect(
      screen.getByText('Mood picks for “cozy mystery”'),
    ).toBeInTheDocument();
    expect(screen.getByTestId("mood-status").textContent).toContain(
      "filter-based browse",
    );
  });

  it("maps cozy/mystery vibe to comedy + mystery genres in the filters", async () => {
    mockServices = { tmdb: null, ai: null };
    mockDiscover = { data: fullData(), loading: false };
    render(<Discover />);
    await userEvent.click(screen.getByText("curate"));
    const ctx = openBrowse.mock.calls[0][0];
    // "cozy" → 35 (comedy), "mystery" → 9648
    expect(ctx.filters.genreIds).toEqual(
      expect.arrayContaining([9648, 35]),
    );
  });
});

describe("Discover mood — local AI provider", () => {
  it("resolves AI recommendations into a mood rail with status", async () => {
    const recommend = vi.fn(async () => ({
      recommendations: [
        { title: "Picked One", mediaType: "movie", mediaId: "ai1" },
      ],
    }));
    const search = vi.fn(async () => ({
      items: [preview("ai1", { title: "Picked One" })],
    }));
    mockServices = { tmdb: { search }, ai: { recommend } };
    mockDiscover = { data: fullData(), loading: false };
    render(<Discover />);
    await userEvent.click(screen.getByText("curate"));

    await waitFor(() => {
      expect(screen.getByTestId("mood-status").textContent).toContain(
        "1 titles matched",
      );
    });
    const moodRail = screen
      .getAllByTestId("rail")
      .find(
        (r) =>
          r.getAttribute("data-title") === 'Mood picks for “cozy mystery”',
      )!;
    expect(within(moodRail).getByText("item-ai1")).toBeInTheDocument();
    // mood rail now exposes a "see all" search context.
    expect(within(moodRail).getByTestId("rail-has-seeall").textContent).toBe(
      "true",
    );
  });

  it("shows an error when no recommendations could be matched", async () => {
    const recommend = vi.fn(async () => ({ recommendations: [] }));
    mockServices = { tmdb: { search: vi.fn() }, ai: { recommend } };
    mockDiscover = { data: fullData(), loading: false };
    render(<Discover />);
    await userEvent.click(screen.getByText("curate"));
    await waitFor(() => {
      expect(screen.getByTestId("mood-error").textContent).toContain(
        "none could be matched",
      );
    });
  });

  it("surfaces a thrown AI error message", async () => {
    const recommend = vi.fn(async () => {
      throw new Error("AI exploded");
    });
    mockServices = { tmdb: null, ai: { recommend } };
    mockDiscover = { data: fullData(), loading: false };
    render(<Discover />);
    await userEvent.click(screen.getByText("curate"));
    await waitFor(() => {
      expect(screen.getByTestId("mood-error").textContent).toBe("AI exploded");
    });
  });
});

describe("Discover mood — server mode", () => {
  it("curates via the server and renders the returned items", async () => {
    serverModeOn = true;
    curateServerAI.mockResolvedValue({
      items: [preview("srv1", { title: "Server Pick" })],
    });
    mockDiscover = { data: fullData(), loading: false };
    render(<Discover />);
    await userEvent.click(screen.getByText("curate"));
    await waitFor(() => {
      expect(curateServerAI).toHaveBeenCalledWith({
        prompt: "cozy mystery",
        count: 8,
      });
    });
    await waitFor(() => {
      expect(screen.getByTestId("mood-status").textContent).toContain(
        "1 titles matched",
      );
    });
    const moodRail = screen
      .getAllByTestId("rail")
      .find(
        (r) =>
          r.getAttribute("data-title") === 'Mood picks for “cozy mystery”',
      )!;
    expect(within(moodRail).getByText("item-srv1")).toBeInTheDocument();
  });

  it("shows an error when the server returns zero matches", async () => {
    serverModeOn = true;
    curateServerAI.mockResolvedValue({ items: [] });
    mockDiscover = { data: fullData(), loading: false };
    render(<Discover />);
    await userEvent.click(screen.getByText("curate"));
    await waitFor(() => {
      expect(screen.getByTestId("mood-error").textContent).toContain(
        "none could be matched",
      );
    });
  });

  it("surfaces a thrown server error", async () => {
    serverModeOn = true;
    curateServerAI.mockRejectedValue(new Error("server down"));
    mockDiscover = { data: fullData(), loading: false };
    render(<Discover />);
    await userEvent.click(screen.getByText("curate"));
    await waitFor(() => {
      expect(screen.getByTestId("mood-error").textContent).toBe("server down");
    });
  });
});
