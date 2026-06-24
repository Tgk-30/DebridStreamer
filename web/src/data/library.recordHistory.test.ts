// Regression test for the "opening Detail wipes the resume position" bug.
// recordHistory must NOT zero an existing resume row on a plain viewed event,
// even though the underlying store does a full-record replace.

import { afterEach, describe, expect, it, vi } from "vitest";

const { store } = vi.hoisted(() => {
  const rows = new Map<string, Record<string, unknown>>();
  const key = (m: string, e: string | null | undefined) => `${m}:${e ?? ""}`;
  return {
    store: {
      rows,
      key,
      async recordHistory(entry: Record<string, unknown>) {
        // Full REPLACE keyed by (mediaId, episodeId) — mirrors DexieStore.
        const id = key(entry.mediaId as string, entry.episodeId as string | null);
        const rec = {
          id,
          lastWatched: entry.lastWatched ?? "2020-01-01T00:00:00Z",
          ...entry,
        };
        rows.set(id, rec);
        return rec;
      },
      async getResume(mediaId: string, episodeId?: string | null) {
        return rows.get(key(mediaId, episodeId)) ?? null;
      },
      async listHistory() {
        return [...rows.values()];
      },
    },
  };
});

vi.mock("../storage", () => ({ getStore: () => store }));

// Imported after the mock is registered.
const { recordHistory } = await import("./library");

function movie(id = "tt1") {
  return { id, type: "movie" as const, title: "X" };
}

describe("recordHistory — resume preservation", () => {
  afterEach(() => store.rows.clear());

  it("preserves an existing resume position when Detail is opened (viewed-only)", async () => {
    await recordHistory(movie(), { progressSeconds: 300, durationSeconds: 600 });
    // Open Detail → a viewed event with no progress fields.
    await recordHistory(movie());
    const resume = await store.getResume("tt1");
    expect(resume?.progressSeconds).toBe(300);
    expect(resume?.durationSeconds).toBe(600);
    expect(resume?.completed).toBe(false);
  });

  it("real playback still overwrites with the new position", async () => {
    await recordHistory(movie(), { progressSeconds: 300, durationSeconds: 600 });
    await recordHistory(movie(), { progressSeconds: 120, durationSeconds: 600 });
    expect((await store.getResume("tt1"))?.progressSeconds).toBe(120);
  });

  it("a viewed event with no prior row records zero progress", async () => {
    await recordHistory(movie("tt2"));
    const resume = await store.getResume("tt2");
    expect(resume?.progressSeconds).toBe(0);
    expect(resume?.durationSeconds).toBeNull();
  });

  it("does not read the existing row on an explicit progress write", async () => {
    const spy = vi.spyOn(store, "getResume");
    await recordHistory(movie(), { progressSeconds: 50, durationSeconds: 100 });
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
