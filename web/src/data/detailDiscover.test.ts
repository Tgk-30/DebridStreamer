// @vitest-environment jsdom
//
// Tests for the Detail (detail.ts) and Discover (discover.ts) data layers.
// Both expose React hooks plus pure helpers, and branch across three paths:
// server mode (serverApi), live TMDB (a fake TMDBService), and the no-key
// fixtures fallback. We mock serverMode/serverApi/fixtures at the module level
// and drive the hooks with renderHook + waitFor.

import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import type { CastMember, MediaItem, MediaPreview } from "../models/media";
import type { TMDBService } from "../services/metadata/TMDBService";

// ── Module mocks ─────────────────────────────────────────────────────────────
const isServerMode = vi.fn(() => false as boolean);
vi.mock("../lib/serverMode", () => ({
  isServerMode: () => isServerMode(),
}));

const fetchServerDetail = vi.fn();
const fetchServerDiscoverHome = vi.fn();
vi.mock("../lib/serverApi", () => ({
  fetchServerDetail: (...args: unknown[]) => fetchServerDetail(...args),
  fetchServerDiscoverHome: (...args: unknown[]) => fetchServerDiscoverHome(...args),
}));

// Deterministic, small fixtures so we can assert hero-pick + array identity
// without depending on the (large) real bundled catalog.
const fixtureTrendingMovieWithBackdrop: MediaPreview = {
  id: "tmdb-100",
  type: "movie",
  title: "Fixture Movie",
  year: 2001,
  posterPath: "/p.jpg",
  backdropPath: "/b.jpg",
  imdbRating: 7,
  tmdbId: 100,
};
const loadDiscoverFixtures = vi.fn(() => ({
  trendingMovies: [fixtureTrendingMovieWithBackdrop],
  trendingTV: [],
  popularMovies: [],
  topRatedMovies: [],
  nowPlayingMovies: [],
  upcomingMovies: [],
}));
vi.mock("./fixtures", () => ({
  loadDiscoverFixtures: () => loadDiscoverFixtures(),
}));

import { useDetail } from "./detail";
import {
  useDiscover,
  loadLiveDiscover,
  loadFixtureDiscover,
} from "./discover";

// ── Helpers ──────────────────────────────────────────────────────────────────
function preview(partial: Partial<MediaPreview> = {}): MediaPreview {
  // Spread last so an explicit `null` (e.g. backdropPath: null) overrides the
  // default - `?? `would swallow a deliberate null.
  return {
    id: "tmdb-42",
    type: "movie",
    title: "The Thing",
    year: 1982,
    posterPath: "/poster.jpg",
    backdropPath: "/back.jpg",
    imdbRating: 8.1,
    tmdbId: null,
    ...partial,
  };
}

function mediaItem(partial: Partial<MediaItem> = {}): MediaItem {
  return {
    id: "tt0084787",
    type: "movie",
    title: "The Thing",
    year: 1982,
    posterPath: "/poster.jpg",
    backdropPath: "/back.jpg",
    overview: "A thing.",
    genres: ["Horror"],
    imdbRating: 8.1,
    rtRating: null,
    runtime: 109,
    status: null,
    tmdbId: 1091,
    lastFetched: new Date().toISOString(),
    ...partial,
  };
}

const cast: CastMember[] = [
  { id: 1, name: "Kurt Russell", character: "MacReady", profileURL: null },
];

/** Minimal fake TMDBService with only the methods detail/discover use. */
function fakeTMDB(over: Partial<Record<string, unknown>> = {}): TMDBService {
  const base = {
    getDetail: vi.fn(async () => mediaItem()),
    getCast: vi.fn(async () => cast),
    getRecommendations: vi.fn(async () => [preview({ id: "tmdb-7", title: "Rec" })]),
    getTrending: vi.fn(async (kind: string) => ({
      items: kind === "movie" ? [preview({ id: "tmdb-1", title: "TrendMovie" })] : [],
    })),
    getCategory: vi.fn(async () => ({ items: [] })),
  };
  return { ...base, ...over } as unknown as TMDBService;
}

beforeEach(() => {
  vi.clearAllMocks();
  isServerMode.mockReturnValue(false);
});

// ════════════════════════════════════════════════════════════════════════════
// detail.ts - useDetail
// ════════════════════════════════════════════════════════════════════════════
describe("useDetail", () => {
  it("stays in the initial loading/fixtures state when preview is null", () => {
    const svc = fakeTMDB();
    const { result } = renderHook(() => useDetail(null, svc));
    expect(result.current.loading).toBe(true);
    expect(result.current.source).toBe("fixtures");
    expect(result.current.data.item).toBeNull();
    expect(result.current.data.cast).toEqual([]);
  });

  it("loads live via the service: maps item, cast, related and tt imdbId", async () => {
    const svc = fakeTMDB();
    const p = preview({ id: "tmdb-1091", tmdbId: 1091 });
    const { result } = renderHook(() => useDetail(p, svc));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.source).toBe("live");
    expect(result.current.error).toBeNull();
    expect(result.current.data.item?.title).toBe("The Thing");
    expect(result.current.data.cast).toEqual(cast);
    expect(result.current.data.related).toHaveLength(1);
    // detail.id starts with "tt" -> imdbId surfaced.
    expect(result.current.data.imdbId).toBe("tt0084787");
    expect(svc.getCast).toHaveBeenCalledWith(1091, "movie");
    expect(svc.getRecommendations).toHaveBeenCalledWith(1091, "movie");
  });

  it("derives the tmdb id from a tmdb- prefixed preview id when tmdbId is absent", async () => {
    const svc = fakeTMDB();
    const p = preview({ id: "tmdb-555", tmdbId: null });
    const { result } = renderHook(() => useDetail(p, svc));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(svc.getCast).toHaveBeenCalledWith(555, "movie");
    expect(svc.getRecommendations).toHaveBeenCalledWith(555, "movie");
  });

  it("skips cast/recommendations when no numeric tmdb id is resolvable", async () => {
    const svc = fakeTMDB();
    const p = preview({ id: "tt9999999", tmdbId: null });
    const { result } = renderHook(() => useDetail(p, svc));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(svc.getCast).not.toHaveBeenCalled();
    expect(svc.getRecommendations).not.toHaveBeenCalled();
    expect(result.current.data.cast).toEqual([]);
    expect(result.current.data.related).toEqual([]);
  });

  it("imdbId is null when the detail id is a tmdb- fallback (not tt)", async () => {
    const svc = fakeTMDB({
      getDetail: vi.fn(async () => mediaItem({ id: "tmdb-1091" })),
    });
    const p = preview({ tmdbId: 1091 });
    const { result } = renderHook(() => useDetail(p, svc));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data.imdbId).toBeNull();
  });

  it("swallows a getCast/getRecommendations rejection (per-call .catch) and still resolves live", async () => {
    const svc = fakeTMDB({
      getCast: vi.fn(async () => {
        throw new Error("cast boom");
      }),
      getRecommendations: vi.fn(async () => {
        throw new Error("rec boom");
      }),
    });
    const p = preview({ tmdbId: 1091 });
    const { result } = renderHook(() => useDetail(p, svc));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.source).toBe("live");
    expect(result.current.error).toBeNull();
    expect(result.current.data.cast).toEqual([]);
    expect(result.current.data.related).toEqual([]);
  });

  it("falls back to fixtures (previewToItem) when getDetail rejects", async () => {
    const svc = fakeTMDB({
      getDetail: vi.fn(async () => {
        throw new Error("detail down");
      }),
    });
    const p = preview({ title: "Aliens", year: 1986, tmdbId: 1091 });
    const { result } = renderHook(() => useDetail(p, svc));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.source).toBe("fixtures");
    expect(result.current.error).toBe("detail down");
    // previewToItem-derived item: title/year preserved, overview null, genres empty.
    expect(result.current.data.item?.title).toBe("Aliens");
    expect(result.current.data.item?.year).toBe(1986);
    expect(result.current.data.item?.overview).toBeNull();
    expect(result.current.data.item?.genres).toEqual([]);
    expect(result.current.data.imdbId).toBeNull();
  });

  it("stringifies a non-Error rejection into the error message", async () => {
    const svc = fakeTMDB({
      getDetail: vi.fn(async () => {
        throw "weird string failure";
      }),
    });
    const p = preview({ tmdbId: 1091 });
    const { result } = renderHook(() => useDetail(p, svc));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("weird string failure");
  });

  it("with a null service and not server mode, resolves to fixtures with no error", async () => {
    const p = preview();
    const { result } = renderHook(() => useDetail(p, null));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.source).toBe("fixtures");
    expect(result.current.error).toBeNull();
    expect(result.current.data.item?.title).toBe("The Thing");
  });

  it("server mode: returns server payload as live and never touches the service", async () => {
    isServerMode.mockReturnValue(true);
    const serverData = {
      item: mediaItem({ title: "Server Item" }),
      cast,
      related: [],
      imdbId: "tt1234567",
    };
    fetchServerDetail.mockResolvedValue(serverData);
    const svc = fakeTMDB();
    const p = preview({ id: "tmdb-9", type: "series" });
    const { result } = renderHook(() => useDetail(p, svc));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.source).toBe("live");
    expect(result.current.data.item?.title).toBe("Server Item");
    expect(result.current.data.imdbId).toBe("tt1234567");
    expect(fetchServerDetail).toHaveBeenCalledWith({ id: "tmdb-9", type: "series" });
    expect(svc.getDetail).not.toHaveBeenCalled();
  });

  it("server mode failure falls back to fixtures with the error message", async () => {
    isServerMode.mockReturnValue(true);
    fetchServerDetail.mockRejectedValue(new Error("server 500"));
    const svc = fakeTMDB();
    const p = preview({ title: "Predator" });
    const { result } = renderHook(() => useDetail(p, svc));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.source).toBe("fixtures");
    expect(result.current.error).toBe("server 500");
    expect(result.current.data.item?.title).toBe("Predator");
  });

  it("server mode failure stringifies a non-Error rejection", async () => {
    // Hits the `err instanceof Error ? ... : String(err)` else-branch on the
    // server-mode catch.
    isServerMode.mockReturnValue(true);
    // eslint-disable-next-line @typescript-eslint/no-throw-literal
    fetchServerDetail.mockRejectedValue("server string boom");
    // Stable preview ref: useDetail lists `preview` in its effect deps, so a
    // fresh object per render would re-run the effect forever.
    const p = preview();
    const { result } = renderHook(() => useDetail(p, null));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.source).toBe("fixtures");
    expect(result.current.error).toBe("server string boom");
  });

  it("previewToItem nulls every optional field when the preview omits them", async () => {
    // A bare preview (no year/poster/backdrop/rating/tmdbId) exercises each
    // `?? null` fallback in previewToItem on the no-key fixtures path.
    const bare: MediaPreview = { id: "tt1", type: "movie", title: "Bare" };
    const { result } = renderHook(() => useDetail(bare, null));
    await waitFor(() => expect(result.current.loading).toBe(false));
    const item = result.current.data.item;
    expect(item?.title).toBe("Bare");
    expect(item?.year).toBeNull();
    expect(item?.posterPath).toBeNull();
    expect(item?.backdropPath).toBeNull();
    expect(item?.imdbRating).toBeNull();
    expect(item?.tmdbId).toBeNull();
  });
});

// ════════════════════════════════════════════════════════════════════════════
// discover.ts - pure helpers
// ════════════════════════════════════════════════════════════════════════════
describe("loadLiveDiscover", () => {
  it("fetches all rails and unwraps .items; picks first trending movie w/ backdrop as hero", async () => {
    const svc = fakeTMDB({
      getTrending: vi.fn(async (kind: string) => ({
        items:
          kind === "movie"
            ? [
                preview({ id: "tmdb-1", title: "NoBackdrop", backdropPath: null }),
                preview({ id: "tmdb-2", title: "HasBackdrop", backdropPath: "/h.jpg" }),
              ]
            : [preview({ id: "tmdb-3", type: "series" })],
      })),
      getCategory: vi.fn(async (cat: string) => ({
        items: [preview({ id: `cat-${cat}` })],
      })),
    });

    const data = await loadLiveDiscover(svc);
    expect(data.trendingMovies).toHaveLength(2);
    expect(data.trendingTV[0]?.type).toBe("series");
    expect(data.popularMovies[0]?.id).toBe("cat-popular");
    expect(data.topRatedMovies[0]?.id).toBe("cat-top_rated");
    expect(data.nowPlayingMovies[0]?.id).toBe("cat-now_playing");
    expect(data.upcomingMovies[0]?.id).toBe("cat-upcoming");
    // hero = first trending movie that HAS a backdrop.
    expect(data.hero?.id).toBe("tmdb-2");

    expect(svc.getTrending).toHaveBeenCalledWith("movie", "week");
    expect(svc.getTrending).toHaveBeenCalledWith("series", "week");
  });

  it("falls back to a trending-TV backdrop when no trending movie has one", async () => {
    const svc = fakeTMDB({
      getTrending: vi.fn(async (kind: string) => ({
        items:
          kind === "movie"
            ? [preview({ id: "tmdb-1", backdropPath: null })]
            : [preview({ id: "tv-1", type: "series", backdropPath: "/tv.jpg" })],
      })),
      getCategory: vi.fn(async () => ({ items: [] })),
    });
    const data = await loadLiveDiscover(svc);
    expect(data.hero?.id).toBe("tv-1");
  });

  it("hero is null when nothing has a backdrop", async () => {
    const svc = fakeTMDB({
      getTrending: vi.fn(async () => ({
        items: [preview({ backdropPath: null })],
      })),
      getCategory: vi.fn(async () => ({ items: [] })),
    });
    const data = await loadLiveDiscover(svc);
    expect(data.hero).toBeNull();
  });
});

describe("loadFixtureDiscover", () => {
  it("spreads the fixtures and computes the hero from them", () => {
    const data = loadFixtureDiscover();
    expect(loadDiscoverFixtures).toHaveBeenCalled();
    expect(data.trendingMovies[0]?.id).toBe("tmdb-100");
    expect(data.hero?.id).toBe("tmdb-100"); // first trending movie has a backdrop
  });
});

// ════════════════════════════════════════════════════════════════════════════
// discover.ts - useDiscover
// ════════════════════════════════════════════════════════════════════════════
describe("useDiscover", () => {
  it("loads live via the service and reports source=live", async () => {
    const svc = fakeTMDB({
      getTrending: vi.fn(async (kind: string) => ({
        items: kind === "movie" ? [preview({ id: "tmdb-1", backdropPath: "/b.jpg" })] : [],
      })),
      getCategory: vi.fn(async () => ({ items: [] })),
    });
    const { result } = renderHook(() => useDiscover(svc));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.source).toBe("live");
    expect(result.current.error).toBeNull();
    expect(result.current.data?.hero?.id).toBe("tmdb-1");
  });

  it("a live failure falls back to fixtures and keeps the error message", async () => {
    const svc = fakeTMDB({
      getTrending: vi.fn(async () => {
        throw new Error("tmdb offline");
      }),
    });
    const { result } = renderHook(() => useDiscover(svc));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.source).toBe("fixtures");
    expect(result.current.error).toBe("tmdb offline");
    expect(result.current.data?.trendingMovies[0]?.id).toBe("tmdb-100");
  });

  it("with a null service and no server mode, resolves to fixtures (no error)", async () => {
    const { result } = renderHook(() => useDiscover(null));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.source).toBe("fixtures");
    expect(result.current.error).toBeNull();
    expect(result.current.data?.hero?.id).toBe("tmdb-100");
  });

  it("server mode: returns the server payload as live", async () => {
    isServerMode.mockReturnValue(true);
    const serverData = {
      hero: preview({ id: "srv-hero" }),
      trendingMovies: [preview({ id: "srv-1" })],
      trendingTV: [],
      popularMovies: [],
      topRatedMovies: [],
      nowPlayingMovies: [],
      upcomingMovies: [],
    };
    fetchServerDiscoverHome.mockResolvedValue(serverData);
    const svc = fakeTMDB();
    const { result } = renderHook(() => useDiscover(svc));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.source).toBe("live");
    expect(result.current.data?.hero?.id).toBe("srv-hero");
    expect(svc.getTrending).not.toHaveBeenCalled();
  });

  it("server mode failure falls back to fixtures with the error", async () => {
    isServerMode.mockReturnValue(true);
    fetchServerDiscoverHome.mockRejectedValue(new Error("server gone"));
    const svc = fakeTMDB();
    const { result } = renderHook(() => useDiscover(svc));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.source).toBe("fixtures");
    expect(result.current.error).toBe("server gone");
    expect(result.current.data?.trendingMovies[0]?.id).toBe("tmdb-100");
  });

  it("server mode failure stringifies a non-Error rejection", async () => {
    // else-branch of `err instanceof Error ? ... : String(err)` (server path).
    isServerMode.mockReturnValue(true);
    // eslint-disable-next-line @typescript-eslint/no-throw-literal
    fetchServerDiscoverHome.mockRejectedValue("srv string");
    // Stable service ref (useDiscover lists `tmdb` in its effect deps).
    const svc = fakeTMDB();
    const { result } = renderHook(() => useDiscover(svc));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.source).toBe("fixtures");
    expect(result.current.error).toBe("srv string");
  });

  it("a live failure stringifies a non-Error rejection", async () => {
    // else-branch of the live-path catch's `err instanceof Error` ternary.
    const svc = fakeTMDB({
      getTrending: vi.fn(async () => {
        // eslint-disable-next-line @typescript-eslint/no-throw-literal
        throw "live string";
      }),
    });
    const { result } = renderHook(() => useDiscover(svc));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.source).toBe("fixtures");
    expect(result.current.error).toBe("live string");
  });
});
