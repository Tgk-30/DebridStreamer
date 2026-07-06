// Unit tests for genre fallback logic + the useGenres hook.
//
// The hook starts from fallback genres so the filter UI renders immediately,
// then optionally swaps to TMDB's live list (or server-mode serverGenres) if
// available. These tests cover the movie/series fallback branch and the live vs.
// empty-list update branch.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import type { Genre } from "../services/metadata/types";
import type { TMDBService } from "../services/metadata/TMDBService";
import { fallbackGenres, genreName, useGenres } from "./genres";

const fetchServerGenres = vi.fn();
vi.mock("../lib/serverApi", () => ({
  fetchServerGenres: (...args: unknown[]) => fetchServerGenres(...args),
}));

const isServerMode = vi.fn();
vi.mock("../lib/serverMode", () => ({
  isServerMode: () => isServerMode(),
}));

const getGenres = vi.fn();

describe("genres helper functions", () => {
  it("returns canonical movie and series fallbacks", () => {
    const movie = fallbackGenres("movie");
    const tv = fallbackGenres("series");
    expect(movie).not.toEqual(tv);
    expect(movie.length).toBe(18);
    expect(tv.length).toBe(16);
  });

  it("maps known ids and falls back for unknown ids", () => {
    const list: Genre[] = [
      { id: 18, name: "Drama" },
      { id: 80, name: "Crime" },
    ];
    expect(genreName(list, 18)).toBe("Drama");
    expect(genreName(list, 999)).toBe("Genre 999");
  });
});

describe("useGenres", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isServerMode.mockReturnValue(false);
    getGenres.mockResolvedValue([]);
    fetchServerGenres.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("returns fallback genres when TMDB is absent (browser mode)", () => {
    const { result } = renderHook(() => useGenres(null, "movie"));

    expect(result.current).toEqual(fallbackGenres("movie"));
    expect(fetchServerGenres).not.toHaveBeenCalled();
  });

  it("replaces fallback with live genres when TMDB returns non-empty data", async () => {
    const live: Genre[] = [{ id: 101, name: "Neo Noir" }];
    getGenres.mockResolvedValue(live);
    const service = serviceFromGetGenres();
    const { result } = renderHook(() => useGenres(service, "movie"));

    expect(result.current).toEqual(fallbackGenres("movie"));
    await waitFor(() => expect(result.current).toEqual(live));
  });

  it("keeps fallback genres when the live response is empty", async () => {
    getGenres.mockResolvedValueOnce([]);
    const service = serviceFromGetGenres();
    const { result } = renderHook(() => useGenres(service, "series"));

    await waitFor(() => expect(getGenres).toHaveBeenCalledWith("series"));
    expect(result.current).toEqual(fallbackGenres("series"));
  });

  it("uses server genres in server mode", async () => {
    isServerMode.mockReturnValue(true);
    fetchServerGenres.mockResolvedValue([{ id: 201, name: "Server drama" }]);
    getGenres.mockResolvedValueOnce([{ id: 2, name: "Should not be used" }]);

    const service = serviceFromGetGenres();
    const { result } = renderHook(() => useGenres(service, "movie"));
    await waitFor(() => expect(fetchServerGenres).toHaveBeenCalledWith("movie"));
    await waitFor(() => expect(result.current).toEqual([{ id: 201, name: "Server drama" }]));
  });

  it("keeps fallback genres when server genres are returned empty", async () => {
    isServerMode.mockReturnValue(true);
    fetchServerGenres.mockResolvedValue([]);
    getGenres.mockResolvedValue([{ id: 2, name: "Should not be used" }]);

    const service = serviceFromGetGenres();
    const { result } = renderHook(() => useGenres(service, "movie"));

    await waitFor(() => expect(fetchServerGenres).toHaveBeenCalledWith("movie"));
    expect(result.current).toEqual(fallbackGenres("movie"));
  });

  function serviceFromGetGenres(): TMDBService {
    return { getGenres } as TMDBService;
  }
});
// @vitest-environment jsdom
