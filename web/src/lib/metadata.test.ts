// Tests for the shared metadata helpers (resolveImdbId + getUpcomingEpisodes).
//
// A lightweight stub stands in for TMDBService (only the methods these helpers
// touch are implemented), so no network is hit.

import { describe, expect, it } from "vitest";
import {
  resolveImdbId,
  getUpcomingEpisodes,
  getUpcomingEpisodesForSeries,
  MAX_CALENDAR_SERIES,
  tmdbIdOf,
} from "./metadata";
import type { TMDBService } from "../services/metadata/TMDBService";
import type { MediaItem, MediaPreview, Season, Episode } from "../models/media";

const NOW = Date.parse("2026-06-17T12:00:00Z");

function previewSeries(id: string, tmdbId?: number): MediaPreview {
  return { id, type: "series", title: "Show", tmdbId: tmdbId ?? null };
}

/** Build a TMDBService-shaped stub from per-method handlers. */
function stubTMDB(overrides: Partial<TMDBService>): TMDBService {
  return overrides as unknown as TMDBService;
}

describe("tmdbIdOf", () => {
  it("reads tmdbId, then tmdb- prefix, then numeric id", () => {
    expect(tmdbIdOf({ id: "x", type: "movie", title: "", tmdbId: 42 })).toBe(42);
    expect(tmdbIdOf({ id: "tmdb-7", type: "movie", title: "" })).toBe(7);
    expect(tmdbIdOf({ id: "99", type: "movie", title: "" })).toBe(99);
    expect(tmdbIdOf({ id: "tt123", type: "movie", title: "" })).toBeNull();
  });
});

describe("resolveImdbId", () => {
  it("returns the preview id directly when it is already an IMDb id", async () => {
    const preview: MediaPreview = { id: "tt1234567", type: "movie", title: "M" };
    expect(await resolveImdbId(preview, null)).toBe("tt1234567");
  });

  it("returns null without a TMDB service for a non-IMDb id", async () => {
    expect(await resolveImdbId(previewSeries("tmdb-1"), null)).toBeNull();
  });

  it("uses getDetail's IMDb id when available", async () => {
    const tmdb = stubTMDB({
      getDetail: async () =>
        ({ id: "tt7654321", type: "series" }) as MediaItem,
    });
    expect(await resolveImdbId(previewSeries("tmdb-1", 1), tmdb)).toBe("tt7654321");
  });

  it("falls back to external_ids when getDetail has no IMDb id", async () => {
    const tmdb = stubTMDB({
      getDetail: async () => ({ id: "tmdb-1", type: "series" }) as MediaItem,
      getExternalIds: async () => ({ imdbId: "tt0001", tvdbId: null }),
    });
    expect(await resolveImdbId(previewSeries("tmdb-1", 1), tmdb)).toBe("tt0001");
  });

  it("never throws on a TMDB failure", async () => {
    const tmdb = stubTMDB({
      getDetail: async () => {
        throw new Error("boom");
      },
      getExternalIds: async () => {
        throw new Error("boom");
      },
    });
    expect(await resolveImdbId(previewSeries("tmdb-1", 1), tmdb)).toBeNull();
  });
});

describe("getUpcomingEpisodes", () => {
  function season(n: number): Season {
    return { id: n, seasonNumber: n, name: `S${n}`, episodeCount: 3, airDate: null };
  }
  function episode(season: number, n: number, airDate: string | null): Episode {
    return {
      id: `e-${season}-${n}`,
      mediaId: "tmdb-1",
      seasonNumber: season,
      episodeNumber: n,
      title: `Ep ${n}`,
      airDate,
    };
  }

  it("returns [] for movies", async () => {
    const movie: MediaPreview = { id: "tmdb-1", type: "movie", title: "M", tmdbId: 1 };
    const tmdb = stubTMDB({ getSeasons: async () => [] });
    expect(await getUpcomingEpisodes(movie, tmdb, NOW)).toEqual([]);
  });

  it("returns only today-or-later episodes, skipping season 0", async () => {
    const tmdb = stubTMDB({
      getSeasons: async () => [season(0), season(1), season(2)],
      getEpisodes: async (_id: number, s: number) => {
        if (s === 2) {
          return [
            episode(2, 1, "2026-05-01"), // past - dropped
            episode(2, 2, "2026-06-20"), // future - kept
            episode(2, 3, null), // no date - dropped
          ];
        }
        if (s === 1) {
          return [episode(1, 1, "2026-07-10")]; // future - kept
        }
        return [];
      },
    });
    const out = await getUpcomingEpisodes(previewSeries("tmdb-1", 1), tmdb, NOW);
    // Latest two real seasons (2 and 1) inspected; specials skipped.
    expect(out.map((e) => e.airDate)).toEqual(["2026-06-20", "2026-07-10"]);
    expect(out[0].episodeNumber).toBe(2);
  });

  it("tolerates an episode fetch failure for one season", async () => {
    const tmdb = stubTMDB({
      getSeasons: async () => [season(1), season(2)],
      getEpisodes: async (_id: number, s: number) => {
        if (s === 2) throw new Error("rate limited");
        return [episode(1, 1, "2026-08-01")];
      },
    });
    const out = await getUpcomingEpisodes(previewSeries("tmdb-1", 1), tmdb, NOW);
    expect(out.map((e) => e.airDate)).toEqual(["2026-08-01"]);
  });
});

describe("getUpcomingEpisodesForSeries", () => {
  it("dedupes series by id and concatenates + sorts by date", async () => {
    let seasonsCalls = 0;
    const tmdb = stubTMDB({
      getSeasons: async () => {
        seasonsCalls += 1;
        return [{ id: 1, seasonNumber: 1, name: "S1", episodeCount: 1, airDate: null }];
      },
      getEpisodes: async () => [
        {
          id: "e1",
          mediaId: "tmdb-1",
          seasonNumber: 1,
          episodeNumber: 1,
          title: "Ep",
          airDate: "2026-07-01",
        },
      ],
    });
    const list = [previewSeries("tmdb-1", 1), previewSeries("tmdb-1", 1)];
    const out = await getUpcomingEpisodesForSeries(list, tmdb, NOW);
    expect(seasonsCalls).toBe(1); // deduped
    expect(out).toHaveLength(1);
  });

  it("caps resolution at 30 recent series and never exceeds six in-flight requests", async () => {
    let inFlight = 0;
    let peakInFlight = 0;
    let episodeCalls = 0;
    const resolvedSeriesIds: number[] = [];
    const tracked = async <T,>(value: T): Promise<T> => {
      inFlight += 1;
      peakInFlight = Math.max(peakInFlight, inFlight);
      await Promise.resolve();
      inFlight -= 1;
      return value;
    };
    const tmdb = stubTMDB({
      getSeasons: async (tmdbId: number) => {
        resolvedSeriesIds.push(tmdbId);
        return tracked([
          {
            id: tmdbId,
            seasonNumber: 1,
            name: "S1",
            episodeCount: 1,
            airDate: null,
          },
        ]);
      },
      getEpisodes: async () => {
        episodeCalls += 1;
        return tracked([]);
      },
    });
    const series = Array.from({ length: 50 }, (_, index) =>
      previewSeries(`tmdb-${index + 1}`, index + 1),
    );

    await getUpcomingEpisodesForSeries(series, tmdb, NOW);

    expect(peakInFlight).toBe(6);
    expect(resolvedSeriesIds).toEqual(
      Array.from({ length: MAX_CALENDAR_SERIES }, (_, index) => index + 1),
    );
    expect(episodeCalls).toBe(MAX_CALENDAR_SERIES);
  });
});
