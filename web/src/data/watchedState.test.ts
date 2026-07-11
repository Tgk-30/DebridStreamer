import { describe, expect, it } from "vitest";
import type { WatchHistoryRecord } from "../storage/models";
import {
  WATCHED_THRESHOLD,
  watchedMediaIds,
  watchedStateForRecord,
  watchedStatesByMedia,
} from "./watchedState";

function record(
  over: Partial<WatchHistoryRecord> & { mediaId: string },
): WatchHistoryRecord {
  return {
    id: `${over.mediaId}:${over.episodeId ?? ""}`,
    episodeId: null,
    progressSeconds: 0,
    durationSeconds: null,
    completed: false,
    lastWatched: "2026-06-01T00:00:00Z",
    streamQuality: null,
    preview: { id: over.mediaId, type: "movie", title: over.mediaId },
    ...over,
  };
}

describe("watchedStateForRecord", () => {
  it("treats a null/absent record as unwatched", () => {
    expect(watchedStateForRecord(null)).toBe("unwatched");
    expect(watchedStateForRecord(undefined)).toBe("unwatched");
  });

  it("is watched when the explicit completed flag is set", () => {
    expect(
      watchedStateForRecord(
        record({ mediaId: "m1", completed: true, progressSeconds: 5, durationSeconds: 100 }),
      ),
    ).toBe("watched");
  });

  it("is watched at or above the 0.95 completion threshold even without the flag", () => {
    expect(
      watchedStateForRecord(
        record({ mediaId: "m1", progressSeconds: 95, durationSeconds: 100 }),
      ),
    ).toBe("watched");
    // Exactly at the threshold counts as watched.
    expect(WATCHED_THRESHOLD).toBe(0.95);
    expect(
      watchedStateForRecord(
        record({ mediaId: "m1", progressSeconds: 950, durationSeconds: 1000 }),
      ),
    ).toBe("watched");
  });

  it("is inProgress with a real resume point (>2% and <95%)", () => {
    expect(
      watchedStateForRecord(
        record({ mediaId: "m1", progressSeconds: 50, durationSeconds: 100 }),
      ),
    ).toBe("inProgress");
  });

  it("is unwatched when barely started (<=2%) or with no duration", () => {
    expect(
      watchedStateForRecord(
        record({ mediaId: "m1", progressSeconds: 1, durationSeconds: 100 }),
      ),
    ).toBe("unwatched");
    expect(
      watchedStateForRecord(record({ mediaId: "m1", progressSeconds: 0, durationSeconds: null })),
    ).toBe("unwatched");
  });
});

describe("watchedStatesByMedia", () => {
  it("returns one state per media id from mixed records", () => {
    const states = watchedStatesByMedia([
      record({ mediaId: "done", progressSeconds: 100, durationSeconds: 100 }),
      record({ mediaId: "half", progressSeconds: 50, durationSeconds: 100 }),
      record({ mediaId: "fresh", progressSeconds: 0, durationSeconds: 100 }),
    ]);
    expect(states).toEqual({ done: "watched", half: "inProgress", fresh: "unwatched" });
  });

  it("lets inProgress win over watched for a series with a finished + a paused episode", () => {
    const states = watchedStatesByMedia([
      record({ mediaId: "s1", episodeId: "s1e1", completed: true }),
      record({ mediaId: "s1", episodeId: "s1e2", progressSeconds: 30, durationSeconds: 100 }),
    ]);
    expect(states.s1).toBe("inProgress");
  });

  it("marks a series watched when an episode finished and nothing is paused", () => {
    const states = watchedStatesByMedia([
      record({ mediaId: "s2", episodeId: "s2e1", completed: true }),
      record({ mediaId: "s2", episodeId: "s2e2", progressSeconds: 0, durationSeconds: 100 }),
    ]);
    expect(states.s2).toBe("watched");
  });
});

describe("watchedMediaIds", () => {
  it("collects only the fully-watched ids", () => {
    const ids = watchedMediaIds([
      record({ mediaId: "done", completed: true }),
      record({ mediaId: "half", progressSeconds: 50, durationSeconds: 100 }),
      record({ mediaId: "fresh" }),
    ]);
    expect(ids.has("done")).toBe(true);
    expect(ids.has("half")).toBe(false);
    expect(ids.has("fresh")).toBe(false);
    expect(ids.size).toBe(1);
  });
});
