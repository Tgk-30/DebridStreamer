// Tests for the calendar episode-grouping helper (pure).

import { describe, expect, it } from "vitest";
import { calendarEntries, episodesAiredSince, groupEpisodes } from "./calendar";
import type { UpcomingEpisode } from "../lib/metadata";
import type { MediaPreview } from "../models/media";
import type { MovieRelease } from "../services/metadata/TMDBService";

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

  it("buckets by the user's LOCAL day, not UTC (evening / non-UTC offset)", () => {
    // `now` is built from LOCAL components, so this is timezone-independent: the
    // local calendar day is 2026-06-16 in any CI timezone. Under the old UTC
    // logic a negative-offset machine would compute today=2026-06-17 at this
    // hour and silently drop tonight's premiere; the local-day fix keeps it.
    const localEvening = new Date(2026, 5, 16, 22, 0, 0).getTime(); // Jun 16, 22:00 local
    const groups = groupEpisodes(
      [ep("2026-06-16", 1), ep("2026-06-17", 2)],
      localEvening,
    );
    const today = groups.find((g) => g.bucket === "today");
    expect(today?.episodes.map((e) => e.episodeNumber)).toEqual([1]);
    // Tomorrow's episode must NOT be mislabeled as Today.
    expect(today?.episodes.some((e) => e.episodeNumber === 2)).toBe(false);
  });
});

describe("episodesAiredSince", () => {
  it("includes only followed episodes in (lastSeen, now], excluding the boundary and future dates", () => {
    const lastSeen = new Date(2026, 5, 17).getTime();
    const now = new Date(2026, 5, 19).getTime();
    const aired = episodesAiredSince(
      [
        ep("2026-06-16", 1), // already seen
        ep("2026-06-17", 2), // exactly lastSeen: excluded
        ep("2026-06-18", 3), // in window
        ep("2026-06-19", 4), // exactly now: included
        ep("2026-06-20", 5), // future
      ],
      lastSeen,
      now,
    );

    expect(aired.map((episode) => episode.episodeNumber)).toEqual([3, 4]);
  });

  it("ignores malformed dates and an inverted time window", () => {
    const now = new Date(2026, 5, 19).getTime();
    expect(episodesAiredSince([ep("not-a-date")], now - 1, now)).toEqual([]);
    expect(episodesAiredSince([ep("2026-06-18")], now, now - 1)).toEqual([]);
  });
});

describe("calendarEntries", () => {
  it("merges mocked followed-show and TMDB movie releases in date order", () => {
    const movie: MovieRelease = {
      movie: { id: "movie-1", type: "movie", title: "Movie" },
      releaseDate: "2026-06-18",
      source: "upcoming",
    };
    const entries = calendarEntries(
      [ep("2026-06-19", 2), ep("not-a-date", 3)],
      [movie],
    );

    expect(entries).toEqual([
      expect.objectContaining({ kind: "movie", date: "2026-06-18", media: movie.movie }),
      expect.objectContaining({ kind: "episode", date: "2026-06-19", detail: "S01E02 · Ep 2" }),
    ]);
  });
});
