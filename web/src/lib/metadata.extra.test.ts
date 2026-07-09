// Extra metadata tests - targets branches the main suite leaves uncovered:
//  - getUpcomingEpisodes' OUTER catch (getSeasons itself rejects), distinct from
//    the per-season inner catch already covered.
//  - resolveImdbId's "no tmdb id derivable after getDetail fails" early-out.

import { describe, expect, it } from "vitest";
import {
  getUpcomingEpisodes,
  getUpcomingEpisodesForSeries,
  resolveImdbId,
  tmdbIdOf,
} from "./metadata";
import type { TMDBService } from "../services/metadata/TMDBService";
import type { MediaItem, MediaPreview, Season } from "../models/media";

const NOW = Date.parse("2026-06-17T12:00:00Z");

function stubTMDB(overrides: Partial<TMDBService>): TMDBService {
  return overrides as unknown as TMDBService;
}

function previewSeries(id: string, tmdbId?: number): MediaPreview {
  return { id, type: "series", title: "Show", tmdbId: tmdbId ?? null };
}

function season(n: number): Season {
  return { id: n, seasonNumber: n, name: `S${n}`, episodeCount: 1, airDate: null };
}

describe("tmdbIdOf - non-numeric id branches", () => {
  it("returns null for a non-numeric tmdb- suffix (NaN guard)", () => {
    expect(tmdbIdOf({ id: "tmdb-abc", type: "movie", title: "" })).toBeNull();
  });

  it("returns null for a fully non-numeric, non-prefixed id", () => {
    expect(tmdbIdOf({ id: "slug-only", type: "movie", title: "" })).toBeNull();
  });
});

describe("resolveImdbId - external_ids returns no imdb id", () => {
  it("returns null when getExternalIds resolves with a null imdbId (?? null)", async () => {
    const tmdb = stubTMDB({
      getDetail: async () => ({ id: "tmdb-1", type: "series" }) as MediaItem,
      getExternalIds: async () => ({ imdbId: null, tvdbId: 123 }),
    });
    expect(await resolveImdbId(previewSeries("tmdb-1", 1), tmdb)).toBeNull();
  });
});

describe("getUpcomingEpisodes - outer fault tolerance", () => {
  it("returns [] when getSeasons rejects (outer catch)", async () => {
    const tmdb = stubTMDB({
      getSeasons: async () => {
        throw new Error("seasons backend down");
      },
    });
    expect(await getUpcomingEpisodes(previewSeries("tmdb-1", 1), tmdb, NOW)).toEqual(
      [],
    );
  });

  it("returns [] when no TMDB service is configured", async () => {
    expect(await getUpcomingEpisodes(previewSeries("tmdb-1", 1), null, NOW)).toEqual(
      [],
    );
  });

  it("returns [] for a non-series preview", async () => {
    const tmdb = stubTMDB({ getSeasons: async () => [season(1)] });
    const movie: MediaPreview = { id: "tmdb-1", type: "movie", title: "Film" };
    expect(await getUpcomingEpisodes(movie, tmdb, NOW)).toEqual([]);
  });

  it("returns [] when no tmdb id can be derived from the series", async () => {
    const tmdb = stubTMDB({ getSeasons: async () => [season(1)] });
    const series: MediaPreview = { id: "slug-x", type: "series", title: "S" };
    expect(await getUpcomingEpisodes(series, tmdb, NOW)).toEqual([]);
  });

  it("returns [] when only specials (season 0) exist (no real seasons)", async () => {
    const tmdb = stubTMDB({ getSeasons: async () => [season(0)] });
    expect(await getUpcomingEpisodes(previewSeries("tmdb-1", 1), tmdb, NOW)).toEqual(
      [],
    );
  });

  it("keeps a future episode whose title is null (title ?? null branch)", async () => {
    const tmdb = stubTMDB({
      getSeasons: async () => [season(1)],
      getEpisodes: async () => [
        {
          id: "e1",
          mediaId: "tmdb-1",
          seasonNumber: 1,
          episodeNumber: 1,
          title: null,
          airDate: "2026-07-01",
        },
      ],
    });
    const out = await getUpcomingEpisodes(previewSeries("tmdb-1", 1), tmdb, NOW);
    expect(out).toEqual([
      {
        series: previewSeries("tmdb-1", 1),
        seasonNumber: 1,
        episodeNumber: 1,
        title: null,
        airDate: "2026-07-01",
      },
    ]);
  });
});

describe("getUpcomingEpisodesForSeries - guards", () => {
  it("returns [] when no TMDB service is configured", async () => {
    expect(
      await getUpcomingEpisodesForSeries([previewSeries("tmdb-1", 1)], null, NOW),
    ).toEqual([]);
  });

  it("filters out non-series entries before fetching", async () => {
    let seasonsCalls = 0;
    const tmdb = stubTMDB({
      getSeasons: async () => {
        seasonsCalls += 1;
        return [];
      },
    });
    const movie: MediaPreview = { id: "tmdb-9", type: "movie", title: "Film" };
    const out = await getUpcomingEpisodesForSeries(
      [movie, previewSeries("tmdb-1", 1)],
      tmdb,
      NOW,
    );
    expect(out).toEqual([]);
    // Only the series triggered a seasons fetch; the movie was filtered out.
    expect(seasonsCalls).toBe(1);
  });
});

describe("resolveImdbId - unresolved tmdb id after detail failure", () => {
  it("returns null when getDetail fails and no numeric tmdb id is derivable", async () => {
    const tmdb = stubTMDB({
      getDetail: async () => {
        throw new Error("detail 404");
      },
      // getExternalIds should never be reached because tmdbIdOf yields null for
      // a non-numeric, non-tmdb- id with no tmdbId field.
      getExternalIds: async () => {
        throw new Error("must not be called");
      },
    });
    const preview: MediaPreview = { id: "slug-abc", type: "series", title: "X" };
    expect(await resolveImdbId(preview, tmdb)).toBeNull();
  });

  it("returns null when getDetail has no IMDb id and getExternalIds rejects", async () => {
    const tmdb = stubTMDB({
      getDetail: async () => ({ id: "tmdb-1", type: "series" }) as MediaItem,
      getExternalIds: async () => {
        throw new Error("external ids down");
      },
    });
    expect(await resolveImdbId(previewSeries("tmdb-1", 1), tmdb)).toBeNull();
  });
});
