// @vitest-environment jsdom
//
// Pure-helper + hook tests for the episode-picker data layer: episode-id
// round-trips, the resume-derived default selection, and the useSeasons /
// useEpisodes degrade-to-"none" contract.

import { describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

vi.mock("../lib/serverMode", () => ({
  isServerMode: () => mockServerMode,
  configuredServerURL: () => (mockServerMode ? "https://srv" : null),
}));
vi.mock("../lib/serverApi", () => ({
  fetchServerSeasons: (...args: unknown[]) => mockFetchServerSeasons(...args),
  fetchServerEpisodes: (...args: unknown[]) => mockFetchServerEpisodes(...args),
}));

let mockServerMode = false;
const mockFetchServerSeasons = vi.fn();
const mockFetchServerEpisodes = vi.fn();

import {
  defaultSelectionFor,
  episodeIdFor,
  episodeLabel,
  parseEpisodeId,
  useEpisodes,
  useSeasons,
} from "./episodes";
import type { TMDBService } from "../services/metadata/TMDBService";
import type { WatchHistoryRecord } from "../storage/models";

function record(over: Partial<WatchHistoryRecord>): WatchHistoryRecord {
  return {
    id: "x",
    mediaId: "tv1",
    episodeId: null,
    progressSeconds: 100,
    durationSeconds: 1000,
    completed: false,
    lastWatched: "2026-01-01T00:00:00Z",
    streamQuality: null,
    preview: { id: "tv1", type: "series", title: "Show" } as WatchHistoryRecord["preview"],
    ...over,
  };
}

function fakeTmdb(over: Partial<Record<"getSeasons" | "getEpisodes", unknown>> = {}) {
  return {
    getSeasons: over.getSeasons ?? vi.fn(async () => []),
    getEpisodes: over.getEpisodes ?? vi.fn(async () => []),
  } as unknown as TMDBService;
}

describe("episode id helpers", () => {
  it("round-trips ids without zero padding", () => {
    expect(episodeIdFor(2, 5)).toBe("s2e5");
    expect(parseEpisodeId("s2e5")).toEqual({ season: 2, episode: 5 });
    expect(parseEpisodeId(episodeIdFor(12, 103))).toEqual({ season: 12, episode: 103 });
  });

  it("rejects movies (null) and legacy/unparseable ids", () => {
    expect(parseEpisodeId(null)).toBeNull();
    expect(parseEpisodeId(undefined)).toBeNull();
    expect(parseEpisodeId("season-2-ep-5")).toBeNull();
    expect(parseEpisodeId("")).toBeNull();
  });

  it("formats human labels", () => {
    expect(episodeLabel(2, 5)).toBe("S2 E5");
  });
});

describe("defaultSelectionFor", () => {
  it("picks the most recently watched parseable episode, sorting itself", () => {
    const records = [
      record({ id: "a", episodeId: "s1e3", lastWatched: "2026-01-01T00:00:00Z" }),
      // Newest — but listed FIRST to prove array order is not trusted… wait,
      // newest must win regardless of position; put it in the middle.
      record({ id: "b", episodeId: "s2e7", lastWatched: "2026-03-01T00:00:00Z" }),
      record({ id: "c", episodeId: "s2e6", lastWatched: "2026-02-01T00:00:00Z" }),
    ];
    expect(defaultSelectionFor("tv1", records)).toEqual({ season: 2, episode: 7 });
  });

  it("ignores other titles and unparseable ids; falls back to S1E1", () => {
    const records = [
      record({ id: "a", mediaId: "OTHER", preview: { id: "OTHER", type: "series", title: "x" } as WatchHistoryRecord["preview"], episodeId: "s9e9" }),
      record({ id: "b", episodeId: "legacy-key" }),
      record({ id: "c", episodeId: null }),
    ];
    expect(defaultSelectionFor("tv1", records)).toEqual({ season: 1, episode: 1 });
  });
});

describe("useSeasons / useEpisodes", () => {
  it("degrades to source 'none' without a tmdbId or service", async () => {
    const { result } = renderHook(() => useSeasons(null, true, null));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.source).toBe("none");

    const { result: eps } = renderHook(() => useEpisodes(null, 1, null));
    await waitFor(() => expect(eps.current.loading).toBe(false));
    expect(eps.current.source).toBe("none");
  });

  it("maps live seasons (dropping season 0 specials)", async () => {
    const tmdb = fakeTmdb({
      getSeasons: vi.fn(async () => [
        { id: 1, seasonNumber: 0, name: "Specials", episodeCount: 3 },
        { id: 2, seasonNumber: 1, name: "Season 1", episodeCount: 10 },
      ]),
    });
    const { result } = renderHook(() => useSeasons(42, true, tmdb));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.source).toBe("live");
    expect(result.current.seasons.map((s) => s.seasonNumber)).toEqual([1]);
  });

  it("degrades to 'none' when the service throws", async () => {
    const tmdb = fakeTmdb({
      getSeasons: vi.fn(async () => {
        throw new Error("network");
      }),
    });
    const { result } = renderHook(() => useSeasons(42, true, tmdb));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.source).toBe("none");
  });

  it("uses the server proxy in Server Mode", async () => {
    mockServerMode = true;
    try {
      mockFetchServerSeasons.mockResolvedValue({
        seasons: [{ id: 2, seasonNumber: 1, name: "Season 1", episodeCount: 8 }],
      });
      const { result } = renderHook(() => useSeasons(42, true, null));
      await waitFor(() => expect(result.current.loading).toBe(false));
      expect(mockFetchServerSeasons).toHaveBeenCalledWith({ tmdbId: 42 });
      expect(result.current.source).toBe("live");
    } finally {
      mockServerMode = false;
    }
  });

  it("loads a season's episodes and reloads when the season changes", async () => {
    const getEpisodes = vi.fn(async (_id: number, season: number) => [
      {
        id: `e-${season}`,
        mediaId: "tmdb-42",
        seasonNumber: season,
        episodeNumber: 1,
        title: `S${season} opener`,
      },
    ]);
    const tmdb = fakeTmdb({ getEpisodes });
    const { result, rerender } = renderHook(
      ({ season }: { season: number }) => useEpisodes(42, season, tmdb),
      { initialProps: { season: 1 } },
    );
    await waitFor(() => expect(result.current.source).toBe("live"));
    expect(result.current.episodes[0].title).toBe("S1 opener");

    rerender({ season: 2 });
    await waitFor(() => expect(result.current.episodes[0]?.title).toBe("S2 opener"));
    expect(getEpisodes).toHaveBeenCalledTimes(2);
  });
});
