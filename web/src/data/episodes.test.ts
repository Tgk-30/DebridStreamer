// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import type { Episode, Season } from "../models/media";
import {
  defaultSelectionFor,
  episodeIdFor,
  episodeLabel,
  nextEpisodeFor,
  parseEpisodeId,
  useEpisodes,
  useSeasons,
} from "./episodes";

const isServerMode = vi.fn<() => boolean>(() => false);
const fetchServerSeasons = vi.fn();
const fetchServerEpisodes = vi.fn();

vi.mock("../lib/serverMode", () => ({
  isServerMode: () => isServerMode(),
}));

vi.mock("../lib/serverApi", () => ({
  fetchServerSeasons: (...args: unknown[]) => fetchServerSeasons(...args),
  fetchServerEpisodes: (...args: unknown[]) => fetchServerEpisodes(...args),
}));

beforeEach(() => {
  isServerMode.mockReset().mockReturnValue(false);
  fetchServerSeasons.mockReset();
  fetchServerEpisodes.mockReset();
});

describe("episode helpers", () => {
  it("builds episode ids and labels", () => {
    expect(episodeIdFor(2, 11)).toBe("s2e11");
    expect(episodeLabel(2, 11)).toBe("S2 E11");
  });

  it("parses valid ids and rejects malformed ids", () => {
    expect(parseEpisodeId("s2e11")).toEqual({ season: 2, episode: 11 });
    expect(parseEpisodeId("S2E11")).toEqual({ season: 2, episode: 11 });
    expect(parseEpisodeId("x2e11")).toBeNull();
    expect(parseEpisodeId(undefined)).toBeNull();
  });

  it("selects next episode within a season and across boundaries", () => {
    const seasons: Season[] = [
      { id: 1, seasonNumber: 1, name: "Season 1", episodeCount: 3, overview: null },
      { id: 2, seasonNumber: 2, name: "Season 2", episodeCount: 4, overview: null },
      { id: 3, seasonNumber: 0, name: "Specials", episodeCount: 2, overview: null },
      { id: 4, seasonNumber: 3, name: "Season 3", episodeCount: 0, overview: null },
    ];

    expect(nextEpisodeFor({ season: 1, episode: 2 }, seasons)).toEqual({
      season: 1,
      episode: 3,
    });
    expect(nextEpisodeFor({ season: 1, episode: 3 }, seasons)).toEqual({
      season: 2,
      episode: 1,
    });
    expect(nextEpisodeFor({ season: 2, episode: 4 }, seasons)).toBeNull();
    expect(nextEpisodeFor({ season: 2, episode: 4 }, [])).toEqual({ season: 2, episode: 5 });
  });

  it("chooses the latest watched episode for defaults", () => {
    const records = [
      {
        id: "r1",
        mediaId: "tt1",
        episodeId: "s1e2",
        progressSeconds: 10,
        durationSeconds: 30,
        completed: false,
        lastWatched: "2023-01-01T00:00:00.000Z",
        streamQuality: null,
        preview: { id: "tt1", type: "series", title: "Pilot" },
      },
      {
        id: "r2",
        mediaId: "tt1",
        episodeId: "s1e3",
        progressSeconds: 10,
        durationSeconds: 30,
        completed: false,
        lastWatched: "2023-01-02T00:00:00.000Z",
        streamQuality: null,
        preview: { id: "tt1", type: "series", title: "Pilot" },
      },
      {
        id: "r3",
        mediaId: "tt2",
        episodeId: "s9e9",
        progressSeconds: 10,
        durationSeconds: 30,
        completed: false,
        lastWatched: "2023-01-03T00:00:00.000Z",
        streamQuality: null,
        preview: { id: "tt2", type: "series", title: "Other" },
      },
    ];

    expect(defaultSelectionFor("tt1", records)).toEqual({ season: 1, episode: 3 });
    expect(defaultSelectionFor("missing", records)).toEqual({ season: 1, episode: 1 });
  });
});

describe("useSeasons", () => {
  it("falls back to none when disabled", () => {
    const { result } = renderHook(() => useSeasons(42, false, null));
    expect(result.current).toEqual({ seasons: [], loading: false, source: "none" });
  });

  it("falls back to none when tmdb id is missing", () => {
    const { result } = renderHook(() => useSeasons(null, true, null));
    expect(result.current).toEqual({ seasons: [], loading: false, source: "none" });
  });

  it("loads and normalizes live TMDB seasons", async () => {
    const tmdb = {
      getSeasons: vi.fn(async () => [
        { id: 1, seasonNumber: 1, name: "Season 1", episodeCount: 2 } as Season,
        { id: 2, seasonNumber: 0, name: "Specials", episodeCount: 4 } as Season,
      ]),
    } as any;

    const { result } = renderHook(() => useSeasons(42, true, tmdb));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.source).toBe("live");
    expect(result.current.seasons).toHaveLength(1);
    expect(result.current.seasons[0]).toMatchObject({ id: 1, seasonNumber: 1 });
    expect(tmdb.getSeasons).toHaveBeenCalledWith(42);
  });

  it("uses server seasons in server mode", async () => {
    isServerMode.mockReturnValue(true);
    fetchServerSeasons.mockResolvedValue({
      seasons: [
        { id: 11, seasonNumber: 2, name: "Season 2", episodeCount: 3 } as Season,
      ],
    });

    const { result } = renderHook(() => useSeasons(42, true, null));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.source).toBe("live");
    expect(result.current.seasons).toHaveLength(1);
    expect(fetchServerSeasons).toHaveBeenCalledWith({ tmdbId: 42 });
  });

  it("returns none on empty season payload", async () => {
    const tmdb = {
      getSeasons: vi.fn(async () => []),
    } as any;
    const { result } = renderHook(() => useSeasons(42, true, tmdb));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current).toEqual({ seasons: [], loading: false, source: "none" });
  });

  it("returns none on error", async () => {
    const tmdb = {
      getSeasons: vi.fn(async () => {
        throw new Error("tmdb down");
      }),
    } as any;
    const { result } = renderHook(() => useSeasons(42, true, tmdb));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current).toEqual({ seasons: [], loading: false, source: "none" });
  });

  it("skips updates after unmount before seasons resolve", async () => {
    const pending = deferred<Season[]>();
    const tmdb = {
      getSeasons: vi.fn(() => pending.promise),
    } as any;
    const { result, unmount } = renderHook(() => useSeasons(42, true, tmdb));
    unmount();
    pending.resolve([]);
    await Promise.resolve();
    expect(result.current.loading).toBe(true);
    expect(result.current.source).toBe("none");
  });
});

describe("useEpisodes", () => {
  it("returns none when params are missing", () => {
    const { result } = renderHook(() => useEpisodes(null, null, null));
    expect(result.current).toEqual({ episodes: [], loading: false, source: "none" });
  });

  it("loads episodes from live service", async () => {
    const episodes: Episode[] = [
      { id: "e1", mediaId: "tt1", seasonNumber: 1, episodeNumber: 1 } as Episode,
    ];
    const tmdb = {
      getEpisodes: vi.fn(async () => episodes),
    } as any;

    const { result } = renderHook(() => useEpisodes(12, 1, tmdb));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.source).toBe("live");
    expect(result.current.episodes).toHaveLength(1);
    expect(tmdb.getEpisodes).toHaveBeenCalledWith(12, 1);
  });

  it("uses server episodes in server mode", async () => {
    isServerMode.mockReturnValue(true);
    fetchServerEpisodes.mockResolvedValue({
      episodes: [{ id: "e1", mediaId: "tt1", seasonNumber: 1, episodeNumber: 2 } as Episode],
    });

    const { result } = renderHook(() => useEpisodes(12, 1, null));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.source).toBe("live");
    expect(result.current.episodes).toHaveLength(1);
    expect(fetchServerEpisodes).toHaveBeenCalledWith({ tmdbId: 12, season: 1 });
  });

  it("returns none for empty episode payload", async () => {
    const tmdb = {
      getEpisodes: vi.fn(async () => []),
    } as any;

    const { result } = renderHook(() => useEpisodes(12, 1, tmdb));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current).toEqual({ episodes: [], loading: false, source: "none" });
  });

  it("returns none on failure", async () => {
    const tmdb = {
      getEpisodes: vi.fn(async () => {
        throw new Error("ep down");
      }),
    } as any;

    const { result } = renderHook(() => useEpisodes(12, 1, tmdb));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current).toEqual({ episodes: [], loading: false, source: "none" });
  });

  it("skips updates after unmount before episodes resolve", async () => {
    const pending = deferred<Episode[]>();
    const tmdb = {
      getEpisodes: vi.fn(() => pending.promise),
    } as any;

    const { result, unmount } = renderHook(() => useEpisodes(12, 1, tmdb));
    unmount();
    pending.resolve([]);
    await Promise.resolve();
    expect(result.current.loading).toBe(true);
    expect(result.current.source).toBe("none");
  });
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolveFn, rejectFn) => {
    resolve = resolveFn;
    reject = rejectFn;
  });
  return { promise, resolve, reject };
}
