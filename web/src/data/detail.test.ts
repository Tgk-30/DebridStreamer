// @vitest-environment jsdom
//
// Focused Detail-data-layer tests for the core hook and fallback branches.

import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import type { CastMember, MediaItem, MediaPreview } from "../models/media";
import { useDetail } from "./detail";

const isServerMode = vi.fn<boolean, []>(() => false);
const fetchServerDetail = vi.fn();

vi.mock("../lib/serverMode", () => ({
  isServerMode: () => isServerMode(),
}));
vi.mock("../lib/serverApi", () => ({
  fetchServerDetail: (...args: unknown[]) => fetchServerDetail(...args),
}));

function preview(overrides: Partial<MediaPreview> = {}): MediaPreview {
  return {
    id: "tmdb-42",
    type: "movie",
    title: "Alien",
    posterPath: "/poster.jpg",
    backdropPath: "/back.jpg",
    imdbRating: 8.2,
    year: 1979,
    tmdbId: 42,
    ...overrides,
  };
}

function media(overrides: Partial<MediaItem> = {}): MediaItem {
  return {
    id: "tt0086879",
    type: "movie",
    title: "Alien",
    year: 1979,
    posterPath: "/poster.jpg",
    backdropPath: "/back.jpg",
    overview: "Xenomorph nightmare.",
    genres: ["Sci-Fi", "Horror"],
    imdbRating: 8.8,
    rtRating: null,
    runtime: 117,
    status: "Released",
    tmdbId: 42,
    lastFetched: new Date().toISOString(),
    ...overrides,
  };
}

const cast: CastMember[] = [{ id: 1, name: "Sigourney Weaver", character: "Ripley", profileURL: null }];

function fakeTMDB(over: Partial<Record<string, unknown>> = {}) {
  return {
    getDetail: vi.fn(async () => media()),
    getCast: vi.fn(async () => cast),
    getRecommendations: vi.fn(async () => [preview({ id: "tmdb-99", title: "Prometheus" })]),
    ...over,
  } as Record<string, unknown>;
}

beforeEach(() => {
  isServerMode.mockReset().mockReturnValue(false);
  fetchServerDetail.mockReset();
});

describe("useDetail", () => {
  it("starts in fixtures state when preview is null", () => {
    const { result } = renderHook(() => useDetail(null, fakeTMDB()));
    expect(result.current.loading).toBe(true);
    expect(result.current.source).toBe("fixtures");
    expect(result.current.data.item).toBeNull();
    expect(result.current.data.cast).toEqual([]);
  });

  it("loads live detail and casts recommendations", async () => {
    const svc = fakeTMDB();
    const p = preview({ id: "tmdb-42", tmdbId: 42 });
    const { result } = renderHook(() => useDetail(p, svc as any));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.source).toBe("live");
    expect(result.current.data.item).toMatchObject({ title: "Alien" });
    expect(result.current.data.cast).toEqual(cast);
    expect(result.current.data.related).toHaveLength(1);
    expect(svc.getCast).toHaveBeenCalledTimes(1);
    expect(svc.getRecommendations).toHaveBeenCalledTimes(1);
    expect(result.current.data.imdbId).toBe("tt0086879");
  });

  it("extracts tmdb id from tmdb-id string previews", async () => {
    const svc = fakeTMDB();
    const p = preview({ id: "tmdb-1234", tmdbId: null });
    const { result } = renderHook(() => useDetail(p, svc as any));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(svc.getCast).toHaveBeenCalledWith(1234, "movie");
    expect(result.current.source).toBe("live");
  });

  it("keeps fixtures when live detail errors and preserves tt ids", async () => {
    const svc = fakeTMDB({
      getDetail: vi.fn(async () => {
        throw new Error("detail down");
      }),
    });
    const p = preview({ id: "tt1234", tmdbId: null });
    const { result } = renderHook(() => useDetail(p, svc as any));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.source).toBe("fixtures");
    expect(result.current.error).toBe("detail down");
    expect(result.current.data.item?.title).toBe("Alien");
    expect(result.current.data.imdbId).toBe("tt1234");
    expect(result.current.data.cast).toEqual([]);
  });

  it("uses server payload verbatim when server mode is enabled", async () => {
    isServerMode.mockReturnValue(true);
    const serverData = {
      item: media({ title: "Server detail" }),
      cast,
      related: [preview({ id: "srv-related", title: "Server Recommendation" })],
      imdbId: "ttserver",
    };
    fetchServerDetail.mockResolvedValue(serverData);
    const svc = fakeTMDB({
      getDetail: vi.fn(() => {
        throw new Error("should not call");
      }),
    });

    const { result } = renderHook(() => useDetail(preview(), svc as any));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.source).toBe("live");
    expect(result.current.data.item?.title).toBe("Server detail");
    expect(result.current.data.imdbId).toBe("ttserver");
    expect(fetchServerDetail).toHaveBeenCalledWith({ id: "tmdb-42", type: "movie" });
  });

  it("stringifies non-Error server failure and falls back to fixtures", async () => {
    isServerMode.mockReturnValue(true);
    fetchServerDetail.mockRejectedValue("server boom");
    const { result } = renderHook(() => useDetail(preview(), fakeTMDB() as any));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.source).toBe("fixtures");
    expect(result.current.error).toBe("server boom");
    expect(result.current.data.item?.title).toBe("Alien");
  });
});

