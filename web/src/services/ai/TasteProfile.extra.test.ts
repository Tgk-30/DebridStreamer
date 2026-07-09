// Extra coverage for src/services/ai/TasteProfile.ts - the cache + rebuild paths
// that the primary TasteProfile.test.ts skips (it always passes useCache:false):
//  - buildTasteContext with the default useCache:true round-trips through the
//    settings KV (readCache miss -> assemble -> writeCache, then a cache hit),
//  - a stale / future-dated / malformed cache envelope is ignored (re-assembled),
//  - rebuildTasteContext forces a fresh assembly and refreshes the cache,
//  - the per-source `.catch(() => [])` fallbacks when a Store read rejects.
//
// Mirrors the in-memory Proxy Store pattern from TasteProfile.test.ts. TESTS ONLY.

import { describe, expect, it } from "vitest";
import { buildTasteContext, rebuildTasteContext } from "./TasteProfile";
import type { Store } from "../../storage/types";
import type {
  TasteEventRecord,
  WatchHistoryRecord,
  WatchlistRecord,
} from "../../storage/models";

const NOW = new Date("2026-06-24T00:00:00.000Z").getTime();
const DAY_MS = 86_400_000;
const isoDaysAgo = (days: number) => new Date(NOW - days * DAY_MS).toISOString();

interface FakeStoreOpts {
  tasteEvents?: TasteEventRecord[];
  history?: WatchHistoryRecord[];
  watchlist?: WatchlistRecord[];
  /** Pre-seed the settings KV (e.g. a stale cache envelope). */
  initialSettings?: Record<string, string>;
  /** When set, the named read rejects so the `.catch(() => [])` path runs. */
  rejectOn?: "recentTasteEvents" | "listHistory" | "listWatchlist";
}

/** In-memory Store + counters so we can prove a cache hit issues no read. */
function makeFakeStore(opts: FakeStoreOpts): {
  store: Store;
  reads: () => number;
  setCount: () => number;
  settings: Map<string, string>;
} {
  const settings = new Map<string, string>(Object.entries(opts.initialSettings ?? {}));
  let reads = 0;
  let setCount = 0;
  const reject = (name: string) =>
    opts.rejectOn === name ? Promise.reject(new Error(`boom ${name}`)) : null;
  const handler: ProxyHandler<object> = {
    get(_t, prop: string) {
      switch (prop) {
        case "recentTasteEvents":
          return async () => {
            reads += 1;
            return reject("recentTasteEvents") ?? (opts.tasteEvents ?? []);
          };
        case "listHistory":
          return async () => {
            reads += 1;
            return reject("listHistory") ?? (opts.history ?? []);
          };
        case "listWatchlist":
          return async () => {
            reads += 1;
            return reject("listWatchlist") ?? (opts.watchlist ?? []);
          };
        case "getSetting":
          return async (key: string) => settings.get(key) ?? null;
        case "setSetting":
          return async (key: string, value: string | null) => {
            setCount += 1;
            if (value == null) settings.delete(key);
            else settings.set(key, value);
          };
        default:
          return () => {
            throw new Error(`fake store: unexpected call ${prop}`);
          };
      }
    },
  };
  return {
    store: new Proxy({} as Store, handler) as Store,
    reads: () => reads,
    setCount: () => setCount,
    settings,
  };
}

function likedEvent(genres: string): TasteEventRecord {
  return {
    id: `e-${genres}`,
    userId: "default",
    mediaId: `m-${genres}`,
    episodeId: null,
    eventType: "liked",
    signalStrength: 1,
    metadata: { genres },
    createdAt: isoDaysAgo(0),
  };
}

const CACHE_KEY = "tasteContextCache";

describe("buildTasteContext caching (default useCache:true)", () => {
  it("assembles on a cache miss, writes the envelope, then serves the next call from cache", async () => {
    const fake = makeFakeStore({ tasteEvents: [likedEvent("Action")] });

    const first = await buildTasteContext(fake.store, { now: NOW });
    expect(first).toContain("Liked genres: Action");
    // Miss -> three source reads + one cache write.
    expect(fake.reads()).toBe(3);
    expect(fake.setCount()).toBe(1);
    expect(fake.settings.has(CACHE_KEY)).toBe(true);

    const second = await buildTasteContext(fake.store, { now: NOW + 1000 });
    expect(second).toBe(first);
    // Hit -> no further source reads, no further write.
    expect(fake.reads()).toBe(3);
    expect(fake.setCount()).toBe(1);
  });

  it("ignores an expired cache envelope and re-assembles", async () => {
    const stale = JSON.stringify({
      context: "Liked genres: Stale",
      builtAt: new Date(NOW - 48 * 60 * 60 * 1000).toISOString(), // 48h old > 24h TTL
    });
    const fake = makeFakeStore({
      tasteEvents: [likedEvent("Fresh")],
      initialSettings: { [CACHE_KEY]: stale },
    });

    const ctx = await buildTasteContext(fake.store, { now: NOW });
    expect(ctx).toContain("Liked genres: Fresh");
    expect(ctx).not.toContain("Stale");
    expect(fake.reads()).toBe(3);
  });

  it("ignores a future-dated cache envelope (negative age) and re-assembles", async () => {
    const future = JSON.stringify({
      context: "Liked genres: FromFuture",
      builtAt: new Date(NOW + 60 * 60 * 1000).toISOString(),
    });
    const fake = makeFakeStore({
      tasteEvents: [likedEvent("Present")],
      initialSettings: { [CACHE_KEY]: future },
    });

    const ctx = await buildTasteContext(fake.store, { now: NOW });
    expect(ctx).toContain("Liked genres: Present");
    expect(fake.reads()).toBe(3);
  });

  it("ignores a cache envelope missing required fields", async () => {
    const fake = makeFakeStore({
      tasteEvents: [likedEvent("Present")],
      initialSettings: { [CACHE_KEY]: JSON.stringify({ builtAt: new Date(NOW).toISOString() }) },
    });
    const ctx = await buildTasteContext(fake.store, { now: NOW });
    expect(ctx).toContain("Liked genres: Present");
    expect(fake.reads()).toBe(3);
  });

  it("ignores a non-JSON cache value and re-assembles", async () => {
    const fake = makeFakeStore({
      tasteEvents: [likedEvent("Present")],
      initialSettings: { [CACHE_KEY]: "not json {{{" },
    });
    const ctx = await buildTasteContext(fake.store, { now: NOW });
    expect(ctx).toContain("Liked genres: Present");
    expect(fake.reads()).toBe(3);
  });

  it("serves a valid in-TTL cache envelope without touching the source reads", async () => {
    const cached = JSON.stringify({
      context: "Liked genres: Cached",
      builtAt: new Date(NOW - 60 * 1000).toISOString(), // 1 min old, in TTL
    });
    const fake = makeFakeStore({
      tasteEvents: [likedEvent("Ignored")],
      initialSettings: { [CACHE_KEY]: cached },
    });
    const ctx = await buildTasteContext(fake.store, { now: NOW });
    expect(ctx).toBe("Liked genres: Cached");
    expect(fake.reads()).toBe(0);
  });
});

describe("rebuildTasteContext", () => {
  it("bypasses a fresh cache, re-assembles, and refreshes the cache envelope", async () => {
    const cached = JSON.stringify({
      context: "Liked genres: Old",
      builtAt: new Date(NOW - 60 * 1000).toISOString(),
    });
    const fake = makeFakeStore({
      tasteEvents: [likedEvent("New")],
      initialSettings: { [CACHE_KEY]: cached },
    });

    const ctx = await rebuildTasteContext(fake.store, NOW);
    expect(ctx).toContain("Liked genres: New");
    // It re-assembled despite the fresh cache, and wrote the new envelope.
    expect(fake.reads()).toBe(3);
    expect(fake.setCount()).toBe(1);
    const stored = JSON.parse(fake.settings.get(CACHE_KEY) as string);
    expect(stored.context).toContain("Liked genres: New");
  });
});

describe("buildTasteContext source-read failure tolerance", () => {
  it("falls back to an empty taste-event list when recentTasteEvents rejects", async () => {
    const fake = makeFakeStore({
      rejectOn: "recentTasteEvents",
      history: [
        {
          id: "h:",
          mediaId: "h",
          episodeId: null,
          progressSeconds: 1,
          durationSeconds: 100,
          completed: false,
          lastWatched: isoDaysAgo(0),
          streamQuality: null,
          preview: { id: "h", type: "movie", title: "Watched Movie" },
        },
      ],
    });
    const ctx = await buildTasteContext(fake.store, { useCache: false, now: NOW });
    // No liked-genre line (events failed), but history still contributes.
    expect(ctx).not.toContain("Liked genres");
    expect(ctx).toContain("Recently watched: Watched Movie");
  });

  it("falls back to an empty history list when listHistory rejects", async () => {
    const fake = makeFakeStore({
      rejectOn: "listHistory",
      tasteEvents: [likedEvent("Drama")],
    });
    const ctx = await buildTasteContext(fake.store, { useCache: false, now: NOW });
    expect(ctx).toContain("Liked genres: Drama");
    expect(ctx).not.toContain("Recently watched");
  });

  it("falls back to an empty watchlist when listWatchlist rejects", async () => {
    const fake = makeFakeStore({
      rejectOn: "listWatchlist",
      tasteEvents: [likedEvent("Drama")],
    });
    const ctx = await buildTasteContext(fake.store, { useCache: false, now: NOW });
    expect(ctx).toContain("Liked genres: Drama");
    expect(ctx).not.toContain("On my watchlist");
  });
});
