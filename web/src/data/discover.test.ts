/* @vitest-environment jsdom */
import { describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import type { DiscoverData } from "./discover";
import { useDiscover } from "./discover";

const isServerMode = vi.fn<() => boolean>(() => false);
const fetchServerDiscoverHome = vi.fn<() => Promise<DiscoverData>>();

const serverHome: DiscoverData = {
  hero: null,
  trendingMovies: [
    {
      id: "tt9876543",
      type: "movie",
      title: "Server Hero",
      year: 2026,
      genres: ["Documentary"],
      lastFetched: "2026-01-01T00:00:00.000Z",
    },
  ],
  trendingTV: [],
  popularMovies: [],
  topRatedMovies: [],
  nowPlayingMovies: [],
  upcomingMovies: [],
};

vi.mock("../lib/serverMode", () => ({
  isServerMode: () => isServerMode(),
}));
vi.mock("../lib/serverApi", () => ({
  fetchServerDiscoverHome: () => fetchServerDiscoverHome(),
}));

beforeEach(() => {
  fetchServerDiscoverHome.mockReset();
  isServerMode.mockReset().mockReturnValue(false);
});

describe("discover fallback behavior", () => {
  it("falls back to fixtures when no tmdb service is provided", async () => {
    isServerMode.mockReturnValue(false);
    const { result } = renderHook(() => useDiscover(null));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.source).toBe("fixtures");
    expect(result.current.error).toBeNull();
    expect(result.current.data).not.toBeNull();
    expect(result.current.data?.trendingMovies.length).toBeGreaterThan(0);
  });

  it("uses the tmdb service branch when tmdb is provided", async () => {
    isServerMode.mockReturnValue(false);
    const tmdb = {
      getTrending: vi.fn(async () => ({
        items: [
          {
            id: "tt1234",
            type: "movie",
            title: "Live movie",
            year: 2025,
            genres: ["Sci-Fi"],
            lastFetched: "2025-01-01T00:00:00.000Z",
          },
        ],
      })),
      getCategory: vi.fn(async () => ({
        items: [
          {
            id: "tt1111",
            type: "movie",
            title: "Popular movie",
            year: 2024,
            genres: ["Drama"],
            lastFetched: "2025-01-01T00:00:00.000Z",
          },
        ],
      })),
    } as unknown as {
      getTrending: () => Promise<{ items: Array<Record<string, unknown>> }>;
      getCategory: () => Promise<{ items: Array<Record<string, unknown>> }>;
    };

    const { result } = renderHook(() => useDiscover(tmdb));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.source).toBe("live");
    expect(result.current.error).toBeNull();
    expect(result.current.data?.trendingMovies).toHaveLength(1);
    expect(result.current.data?.trendingMovies[0]?.title).toBe("Live movie");
    expect(tmdb.getTrending).toHaveBeenCalledTimes(2);
    expect(tmdb.getCategory).toHaveBeenCalledTimes(4);
  });

  it("uses the server discover endpoint when running in server mode", async () => {
    isServerMode.mockReturnValue(true);
    fetchServerDiscoverHome.mockResolvedValue(serverHome);

    const { result } = renderHook(() => useDiscover(null));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.source).toBe("live");
    expect(fetchServerDiscoverHome).toHaveBeenCalledTimes(1);
    expect(result.current.data?.trendingMovies[0]?.title).toBe("Server Hero");
  });

  it("falls back to fixtures when the server discover request fails", async () => {
    isServerMode.mockReturnValue(true);
    fetchServerDiscoverHome.mockRejectedValue(new Error("server offline"));

    const { result } = renderHook(() => useDiscover(null));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.source).toBe("fixtures");
    expect(result.current.error).toBe("server offline");
    expect(result.current.data).not.toBeNull();
  });

  it("does not attempt state updates after unmount in server mode", async () => {
    isServerMode.mockReturnValue(true);
    let resolveServer: (value: DiscoverData) => void = () => undefined;
    fetchServerDiscoverHome.mockReturnValue(
      new Promise((resolve) => {
        resolveServer = resolve as (value: DiscoverData) => void;
      }),
    );

    const { result, unmount } = renderHook(() => useDiscover(null));
    unmount();
    resolveServer(serverHome);
    await new Promise((r) => setTimeout(r, 0));

    expect(result.current.loading).toBe(true);
    expect(result.current.source).toBeNull();
    expect(result.current.error).toBeNull();
    expect(fetchServerDiscoverHome).toHaveBeenCalledTimes(1);
  });

  it("does not update state after unmount when server discover rejects", async () => {
    isServerMode.mockReturnValue(true);
    let rejectServer: (reason?: unknown) => void = () => undefined;
    fetchServerDiscoverHome.mockReturnValue(
      new Promise((_, reject) => {
        rejectServer = reject;
      }),
    );

    const { result, unmount } = renderHook(() => useDiscover(null));
    unmount();
    rejectServer(new Error("server offline"));
    await new Promise((r) => setTimeout(r, 0));

    expect(result.current.loading).toBe(true);
    expect(result.current.source).toBeNull();
    expect(result.current.error).toBeNull();
    expect(fetchServerDiscoverHome).toHaveBeenCalledTimes(1);
  });
});
