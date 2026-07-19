import { describe, expect, it } from "vitest";
import {
  getUpcomingEpisodesForSeries,
  MAX_CALENDAR_SERIES,
} from "../src/metadata-runtime.js";

describe("metadata calendar runtime", () => {
  it("caps series work at 30 and runs no more than 6 series concurrently", async () => {
    let activeSeries = 0;
    let maxActiveSeries = 0;
    let requestCount = 0;
    const service = {
      async getSeasons() {
        requestCount += 1;
        activeSeries += 1;
        maxActiveSeries = Math.max(maxActiveSeries, activeSeries);
        try {
          await Promise.resolve();
          return [{ seasonNumber: 1 }, { seasonNumber: 2 }];
        } finally {
          activeSeries -= 1;
        }
      },
      async getEpisodes(_tmdbId: number, seasonNumber: number) {
        requestCount += 1;
        return [{
          seasonNumber,
          episodeNumber: 1,
          title: `Season ${seasonNumber}`,
          airDate: "2099-01-01",
        }];
      },
    };
    const series = Array.from({ length: 40 }, (_, index) => ({
      id: `series-${index + 1}`,
      type: "series",
      title: `Series ${index + 1}`,
      tmdbId: index + 1,
    }));

    const episodes = await getUpcomingEpisodesForSeries(
      series,
      service,
      Date.UTC(2026, 6, 19),
    );

    expect(MAX_CALENDAR_SERIES).toBe(30);
    expect(maxActiveSeries).toBe(6);
    expect(requestCount).toBe(90);
    expect(episodes).toHaveLength(60);
    expect(episodes.map((episode) => [episode.series.id, episode.seasonNumber])).toEqual(
      Array.from({ length: 30 }, (_, index) => [
        [`series-${index + 1}`, 2],
        [`series-${index + 1}`, 1],
      ]).flat(),
    );
  });
});
