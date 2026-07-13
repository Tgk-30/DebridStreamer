// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import type { WatchHistoryRecord } from "../storage/models";

const listHistory = vi.fn<() => Promise<WatchHistoryRecord[]>>();
const listHistoryForMedia = vi.fn<() => Promise<WatchHistoryRecord[]>>();
const getResume = vi.fn<() => Promise<WatchHistoryRecord | null>>();

vi.mock("../storage", () => ({
  getStore: () => ({ listHistory, listHistoryForMedia, getResume }),
}));

import { useDetailWatchedState } from "./useWatchedIds";

function history(
  over: Partial<WatchHistoryRecord> & { mediaId: string },
): WatchHistoryRecord {
  return {
    id: `${over.mediaId}:${over.episodeId ?? ""}`,
    episodeId: null,
    progressSeconds: 0,
    durationSeconds: null,
    completed: false,
    lastWatched: "2026-07-13T00:00:00.000Z",
    streamQuality: null,
    preview: { id: over.mediaId, type: "series", title: "Show" },
    ...over,
  };
}

describe("useDetailWatchedState", () => {
  beforeEach(() => {
    listHistory.mockReset();
    listHistoryForMedia.mockReset();
    getResume.mockReset();
  });

  it("shows a series episode that is outside the newest 500 global rows", async () => {
    listHistory.mockResolvedValue(
      Array.from({ length: 500 }, (_, index) =>
        history({ mediaId: `other-${index}`, episodeId: "s1e1" }),
      ),
    );
    listHistoryForMedia.mockResolvedValue([
      history({ mediaId: "show", episodeId: "s1e1", completed: true }),
      history({
        mediaId: "show",
        episodeId: "s1e2",
        progressSeconds: 50,
        durationSeconds: 100,
      }),
    ]);
    const { result } = renderHook(() =>
      useDetailWatchedState("show", "series"),
    );

    await waitFor(() => expect(result.current.episodeIds.has("s1e1")).toBe(true));
    expect(result.current.episodeIds.has("s1e2")).toBe(false);
    expect(listHistoryForMedia).toHaveBeenCalledWith("show");
    expect(listHistory).not.toHaveBeenCalled();
  });

  it("uses the exact keyed lookup for a movie completion badge", async () => {
    getResume.mockResolvedValue(
      history({ mediaId: "movie", episodeId: null, completed: true }),
    );
    const { result } = renderHook(() =>
      useDetailWatchedState("movie", "movie"),
    );

    await waitFor(() => expect(result.current.movieWatched).toBe(true));
    expect(getResume).toHaveBeenCalledWith("movie", null);
    expect(listHistory).not.toHaveBeenCalled();
    expect(listHistoryForMedia).not.toHaveBeenCalled();
  });
});
