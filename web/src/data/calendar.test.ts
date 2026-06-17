// Tests for the calendar episode-grouping helper (pure).

import { describe, expect, it } from "vitest";
import { groupEpisodes } from "./calendar";
import type { UpcomingEpisode } from "../lib/metadata";
import type { MediaPreview } from "../models/media";

const series: MediaPreview = { id: "tmdb-1", type: "series", title: "Show" };

function ep(airDate: string, episodeNumber = 1): UpcomingEpisode {
  return { series, seasonNumber: 1, episodeNumber, title: `Ep ${episodeNumber}`, airDate };
}

// A fixed "now": 2026-06-17 (matches the env date).
const NOW = Date.parse("2026-06-17T12:00:00Z");

describe("groupEpisodes", () => {
  it("buckets into today / this week / upcoming", () => {
    const episodes = [
      ep("2026-06-17", 1), // today
      ep("2026-06-20", 2), // this week
      ep("2026-07-30", 3), // later
    ];
    const groups = groupEpisodes(episodes, NOW);
    expect(groups.map((g) => g.bucket)).toEqual(["today", "week", "later"]);
    expect(groups[0].episodes).toHaveLength(1);
    expect(groups[0].label).toBe("Today");
    expect(groups[2].label).toBe("Upcoming");
  });

  it("omits empty buckets", () => {
    const groups = groupEpisodes([ep("2026-08-01", 1)], NOW);
    expect(groups.map((g) => g.bucket)).toEqual(["later"]);
  });

  it("treats the 7-day boundary as 'this week'", () => {
    // Exactly 7 days out is still within the week window.
    const groups = groupEpisodes([ep("2026-06-24", 1)], NOW);
    expect(groups[0].bucket).toBe("week");
  });

  it("returns [] for no episodes", () => {
    expect(groupEpisodes([], NOW)).toEqual([]);
  });
});
