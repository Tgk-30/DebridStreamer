// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

import type { TasteEventRecord, WatchHistoryRecord } from "../storage/models";
import { useWatchStats } from "./useWatchStats";

const store = vi.hoisted(() => ({
  listHistory: vi.fn<() => Promise<WatchHistoryRecord[]>>(),
  recentTasteEvents: vi.fn<() => Promise<TasteEventRecord[]>>(),
}));

vi.mock("../storage", () => ({ getStore: () => store }));

function history(overrides: Partial<WatchHistoryRecord>): WatchHistoryRecord {
  return {
    id: overrides.id ?? "tt1:",
    mediaId: overrides.mediaId ?? "tt1",
    episodeId: null,
    progressSeconds: 0,
    durationSeconds: 3600,
    completed: false,
    lastWatched: "2020-01-01T00:00:00.000Z",
    streamQuality: null,
    preview: { id: "tt1", type: "movie", title: "Sample" },
    ...overrides,
  };
}

function likedEvent(
  id: string,
  genres: string,
): TasteEventRecord {
  return {
    id,
    userId: "u1",
    mediaId: "tt1",
    episodeId: null,
    eventType: "liked",
    signalStrength: 1,
    metadata: { genres },
    createdAt: "2020-01-01T00:00:00.000Z",
  };
}

function render(enabled: boolean, deps: readonly unknown[] = []) {
  return renderHook(
    ({ e, d }) => useWatchStats(e, d),
    {
      initialProps: { e: enabled, d: deps },
    },
  );
}

beforeEach(() => {
  store.listHistory.mockReset();
  store.recentTasteEvents.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("useWatchStats", () => {
  it("does not set state when unmounted before async work completes", async () => {
    let resolveHistory: (value: WatchHistoryRecord[]) => void;
    let resolveEvents: (value: TasteEventRecord[]) => void;

    const historyPromise = new Promise<WatchHistoryRecord[]>((resolve) => {
      resolveHistory = resolve;
    });
    const eventsPromise = new Promise<TasteEventRecord[]>((resolve) => {
      resolveEvents = resolve;
    });

    store.listHistory.mockReturnValue(historyPromise);
    store.recentTasteEvents.mockReturnValue(eventsPromise);

    const { result, unmount } = render(true);
    unmount();

    resolveHistory([history({ id: "m1:" })]);
    resolveEvents([]);
    await new Promise((r) => setTimeout(r, 0));

    expect(result.current).toBeNull();
  });

  it("does not apply catch fallback after unmount", async () => {
    let rejectHistory: (reason: unknown) => void;
    const historyPromise = new Promise<WatchHistoryRecord[]>((_, reject) => {
      rejectHistory = reject;
    });
    store.listHistory.mockReturnValue(historyPromise);
    store.recentTasteEvents.mockResolvedValue([]);

    const { result, unmount } = render(true);
    unmount();

    rejectHistory(new Error("store offline"));
    await new Promise((r) => setTimeout(r, 0));

    expect(result.current).toBeNull();
  });

  it("returns null without touching the store when disabled", () => {
    store.listHistory.mockResolvedValue([]);
    store.recentTasteEvents.mockResolvedValue([]);
    const { result } = render(false);
    expect(result.current).toBeNull();
    expect(store.listHistory).not.toHaveBeenCalled();
    expect(store.recentTasteEvents).not.toHaveBeenCalled();
  });

  it("loads history and taste events and aggregates stats", async () => {
    store.listHistory.mockResolvedValue([
      history({ id: "m1:", completed: true, durationSeconds: 120 }),
      history({
        id: "m2:",
        completed: false,
        progressSeconds: 60,
        durationSeconds: 120,
      }),
    ]);
    store.recentTasteEvents.mockResolvedValue([
      likedEvent("e1", "Action, Drama"),
      likedEvent("e2", "Action"),
      {
        ...likedEvent("e3", "Drama"),
        eventType: "disliked",
      },
    ]);
    const { result } = render(true);

    await waitFor(() => expect(store.listHistory).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(store.recentTasteEvents).toHaveBeenCalledTimes(1));
    expect(result.current).toMatchObject({
      totalSeconds: 180,
      titles: 2,
      completed: 1,
      completionRate: 0.5,
      streakDays: 0,
      streakOngoing: false,
      activeDays: 1,
      favoriteGenres: [
        { genre: "Action", count: 2 },
        { genre: "Drama", count: 1 },
      ],
    });
  });

  it("re-aggregates when deps change", async () => {
    store.listHistory.mockResolvedValue([history({ id: "m1:" })]);
    store.recentTasteEvents.mockResolvedValue([]);
    const rendered = render(true, [1]);

    await waitFor(() => expect(store.listHistory).toHaveBeenCalledTimes(1));
    rendered.rerender({ e: true, d: [2] });
    await waitFor(() => expect(store.listHistory).toHaveBeenCalledTimes(2));
  });

  it("clears stats when disabling after a successful load", async () => {
    store.listHistory.mockResolvedValue([history({ id: "m1:" })]);
    store.recentTasteEvents.mockResolvedValue([]);
    const rendered = render(true);

    await waitFor(() => expect(rendered.result.current).not.toBeNull());
    rendered.rerender({ e: false, d: [] });
    expect(rendered.result.current).toBeNull();
  });

  it("returns null if fetching from the store fails", async () => {
    store.listHistory.mockRejectedValue(new Error("store offline"));
    store.recentTasteEvents.mockResolvedValue([]);
    const { result } = render(true);

    await waitFor(() => expect(store.listHistory).toHaveBeenCalledTimes(1));
    expect(result.current).toBeNull();
  });

  it("continues when taste-events fails and only uses history", async () => {
    store.listHistory.mockResolvedValue([history({ id: "m1:" })]);
    store.recentTasteEvents.mockRejectedValue(new Error("taste offline"));
    const { result } = render(true);

    await waitFor(() => expect(store.recentTasteEvents).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(result.current).toMatchObject({
        titles: 1,
        totalSeconds: 0,
        favoriteGenres: [],
      }),
    );
  });
});
