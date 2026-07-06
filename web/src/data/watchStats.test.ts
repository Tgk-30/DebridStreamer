import { describe, expect, it } from "vitest";
import {
  computeWatchStats,
  formatWatchTime,
  hasWatchStats,
} from "./watchStats";
import type {
  TasteEventRecord,
  WatchHistoryRecord,
} from "../storage/models";

function hist(
  over: Partial<WatchHistoryRecord> & { lastWatched: string },
): WatchHistoryRecord {
  const mediaId = over.mediaId ?? "tt1";
  return {
    id: `${mediaId}:`,
    mediaId,
    episodeId: null,
    progressSeconds: 0,
    durationSeconds: 3600,
    completed: false,
    streamQuality: null,
    preview: { id: mediaId, type: "movie", title: "X" },
    ...over,
  };
}

function liked(genres: string, id = "e1"): TasteEventRecord {
  return {
    id,
    userId: "default",
    mediaId: "tt1",
    episodeId: null,
    eventType: "liked",
    signalStrength: 1,
    metadata: { genres },
    createdAt: "2026-01-01T00:00:00Z",
  };
}

// A fixed local reference "now" so streak math is deterministic regardless of
// the machine clock. Using local Date construction (not UTC) mirrors the impl.
const NOW = new Date(2026, 5, 15, 12, 0, 0); // 2026-06-15 12:00 local

// Build a lastWatched ISO for a given LOCAL calendar day, so the streak/day-key
// math lands on the intended day in ANY machine timezone (the impl reads local
// components of the parsed date, exactly like NOW is constructed).
function at(year: number, month0: number, day: number, hour = 15): string {
  return new Date(year, month0, day, hour, 0, 0).toISOString();
}

describe("computeWatchStats", () => {
  it("credits full runtime for completed titles and the resume point otherwise", () => {
    const stats = computeWatchStats(
      [
        hist({ mediaId: "a", completed: true, durationSeconds: 7200, progressSeconds: 7100, lastWatched: "2026-06-15T09:00:00Z" }),
        hist({ mediaId: "b", completed: false, durationSeconds: 3600, progressSeconds: 1800, lastWatched: "2026-06-15T09:00:00Z" }),
      ],
      [],
      NOW,
    );
    expect(stats.totalSeconds).toBe(7200 + 1800);
    expect(stats.titles).toBe(2);
    expect(stats.completed).toBe(1);
    expect(stats.completionRate).toBe(0.5);
  });

  it("returns a zeroed completion rate and no streak for empty history", () => {
    const stats = computeWatchStats([], [], NOW);
    expect(stats.titles).toBe(0);
    expect(stats.completionRate).toBe(0);
    expect(stats.streakDays).toBe(0);
    expect(stats.streakOngoing).toBe(false);
    expect(hasWatchStats(stats)).toBe(false);
  });

  it("tallies favourite genres from liked events only, most-liked first", () => {
    const stats = computeWatchStats(
      [hist({ lastWatched: "2026-06-15T09:00:00Z" })],
      [
        liked("Action, Sci-Fi", "1"),
        liked("Action, Drama", "2"),
        liked("Sci-Fi", "3"),
        // A disliked event must not count toward favourites.
        { ...liked("Action", "4"), eventType: "disliked" },
      ],
      NOW,
    );
    expect(stats.favoriteGenres).toEqual([
      { genre: "Action", count: 2 },
      { genre: "Sci-Fi", count: 2 },
      { genre: "Drama", count: 1 },
    ]);
  });

  it("counts a consecutive local-day streak ending today", () => {
    const stats = computeWatchStats(
      [
        hist({ mediaId: "a", lastWatched: at(2026, 5, 15) }), // today
        hist({ mediaId: "b", lastWatched: at(2026, 5, 14) }), // yesterday
        hist({ mediaId: "c", lastWatched: at(2026, 5, 13) }), // 2 days ago
        hist({ mediaId: "d", lastWatched: at(2026, 5, 10) }), // gap → not in streak
      ],
      [],
      NOW,
    );
    expect(stats.streakDays).toBe(3);
    expect(stats.streakOngoing).toBe(true);
    expect(stats.activeDays).toBe(4);
  });

  it("treats a streak ending yesterday as still counting but not ongoing", () => {
    const stats = computeWatchStats(
      [
        hist({ mediaId: "a", lastWatched: at(2026, 5, 14) }), // yesterday
        hist({ mediaId: "b", lastWatched: at(2026, 5, 13) }), // 2 days ago
      ],
      [],
      NOW,
    );
    expect(stats.streakDays).toBe(2);
    expect(stats.streakOngoing).toBe(false);
  });

  it("has no streak when the most recent watch is older than yesterday", () => {
    const stats = computeWatchStats(
      [hist({ mediaId: "a", lastWatched: at(2026, 5, 1) })],
      [],
      NOW,
    );
    expect(stats.streakDays).toBe(0);
    expect(stats.streakOngoing).toBe(false);
  });

  it("ignores malformed timestamps when deriving streak and active days", () => {
    const stats = computeWatchStats(
      [hist({ mediaId: "bad", lastWatched: "not-a-date" })],
      [],
      NOW,
    );
    expect(stats.activeDays).toBe(0);
    expect(stats.streakDays).toBe(0);
    expect(stats.streakOngoing).toBe(false);
    expect(stats.totalSeconds).toBe(0);
  });

  it("ignores liked events where genres metadata is not a string", () => {
    const stats = computeWatchStats(
      [hist({ mediaId: "movie", completed: true })],
      [
        {
          ...liked("Action", "bad"),
          metadata: { genres: 42 as unknown as string },
        },
      ],
      NOW,
    );
    expect(stats.favoriteGenres).toEqual([]);
  });

  it("does not credit negative resume positions", () => {
    const stats = computeWatchStats(
      [hist({ mediaId: "movie", completed: false, progressSeconds: -30 })],
      [],
      NOW,
    );
    expect(stats.totalSeconds).toBe(0);
  });
});

describe("formatWatchTime", () => {
  it("formats hours + minutes, minutes-only, and zero", () => {
    expect(formatWatchTime(3 * 3600 + 42 * 60)).toBe("3h 42m");
    expect(formatWatchTime(42 * 60)).toBe("42m");
    expect(formatWatchTime(0)).toBe("0m");
    expect(formatWatchTime(59)).toBe("0m"); // < 1 minute floors to 0
  });
});
