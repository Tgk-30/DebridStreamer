// Tests for TasteProfile.assembleTasteContext (exercised via buildTasteContext)
// focused on the remaining ~15%: weighted genre tally + top-genre ranking
// (descending score, alphabetical tie-break, 6-genre cap), the dedup/cap rules
// for the various title lists, genre/title metadata parsing edge cases, and the
// disliked-signal + truncation paths. recencyDecay itself is covered in
// analysis.test.ts and is intentionally not re-tested here (only relied upon).

import { describe, expect, it } from "vitest";
import { buildTasteContext } from "./TasteProfile";
import type { Store } from "../../storage/types";
import type {
  TasteEventRecord,
  WatchHistoryRecord,
  WatchlistRecord,
} from "../../storage/models";

// A fixed "now" so recency weights are deterministic.
const NOW = new Date("2026-06-24T00:00:00.000Z").getTime();
const DAY_MS = 86_400_000;
const isoDaysAgo = (days: number) => new Date(NOW - days * DAY_MS).toISOString();

/** Minimal in-memory Store covering only what assembleTasteContext touches;
 * any other method throws so accidental dependencies surface loudly. */
function makeFakeStore(opts: {
  tasteEvents?: TasteEventRecord[];
  history?: WatchHistoryRecord[];
  watchlist?: WatchlistRecord[];
}): Store {
  const settings = new Map<string, string>();
  const handler: ProxyHandler<object> = {
    get(_t, prop: string) {
      switch (prop) {
        case "recentTasteEvents":
          return async () => opts.tasteEvents ?? [];
        case "listHistory":
          return async () => opts.history ?? [];
        case "listWatchlist":
          return async () => opts.watchlist ?? [];
        case "getSetting":
          return async (key: string) => settings.get(key) ?? null;
        case "setSetting":
          return async (key: string, value: string | null) => {
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
  return new Proxy({} as Store, handler) as Store;
}

function tasteEvent(
  overrides: Partial<TasteEventRecord> & Pick<TasteEventRecord, "id">,
): TasteEventRecord {
  return {
    userId: "default",
    mediaId: overrides.id,
    episodeId: null,
    eventType: "liked",
    signalStrength: 1,
    metadata: {},
    createdAt: isoDaysAgo(0),
    ...overrides,
  };
}

function historyRow(id: string, title: string): WatchHistoryRecord {
  return {
    id: `${id}:`,
    mediaId: id,
    episodeId: null,
    progressSeconds: 10,
    durationSeconds: 100,
    completed: false,
    lastWatched: isoDaysAgo(0),
    streamQuality: null,
    preview: { id, type: "movie", title },
  };
}

function watchlistRow(id: string, title: string): WatchlistRecord {
  return {
    mediaId: id,
    addedAt: isoDaysAgo(0),
    preview: { id, type: "movie", title },
  };
}

/** Pull the comma list following a `Label: ` prefix out of the emitted context. */
function lineValues(context: string, label: string): string[] {
  const line = context
    .split("\n")
    .find((l) => l.startsWith(`${label}: `));
  if (line == null) return [];
  return line
    .slice(label.length + 2)
    .split(", ")
    .map((s) => s.trim());
}

// MARK: - weighted genre tally + ranking

describe("buildTasteContext genre tally + ranking", () => {
  it("ranks liked genres by descending accumulated weight", async () => {
    // Drama appears on two recent events (~2.0 total), Comedy once (~1.0),
    // Horror once but a year ago (floors at 0.1), so the order is fixed.
    const store = makeFakeStore({
      tasteEvents: [
        tasteEvent({ id: "a", metadata: { genres: "Drama" }, createdAt: isoDaysAgo(0) }),
        tasteEvent({ id: "b", metadata: { genres: "Drama" }, createdAt: isoDaysAgo(0) }),
        tasteEvent({ id: "c", metadata: { genres: "Comedy" }, createdAt: isoDaysAgo(0) }),
        tasteEvent({ id: "d", metadata: { genres: "Horror" }, createdAt: isoDaysAgo(365) }),
      ],
    });
    const context = await buildTasteContext(store, { useCache: false, now: NOW });
    expect(lineValues(context, "Liked genres")).toEqual(["Drama", "Comedy", "Horror"]);
  });

  it("accumulates each genre across a multi-genre comma list", async () => {
    // One liked event tagged with three genres credits all three equally, so the
    // tie-break is alphabetical between them.
    const store = makeFakeStore({
      tasteEvents: [
        tasteEvent({ id: "a", metadata: { genres: "Thriller, Action, Crime" } }),
      ],
    });
    const context = await buildTasteContext(store, { useCache: false, now: NOW });
    expect(lineValues(context, "Liked genres")).toEqual(["Action", "Crime", "Thriller"]);
  });

  it("breaks equal-weight ties alphabetically", async () => {
    const store = makeFakeStore({
      tasteEvents: [
        tasteEvent({ id: "a", metadata: { genres: "Zombie" } }),
        tasteEvent({ id: "b", metadata: { genres: "Anime" } }),
        tasteEvent({ id: "c", metadata: { genres: "Mystery" } }),
      ],
    });
    const context = await buildTasteContext(store, { useCache: false, now: NOW });
    expect(lineValues(context, "Liked genres")).toEqual(["Anime", "Mystery", "Zombie"]);
  });

  it("caps the genre list at 6 (keeping the 6 highest-weighted)", async () => {
    // Eight distinct genres, each with a distinct recency so the ordering is
    // deterministic: the newest (highest weight) six survive.
    const genres = ["G0", "G1", "G2", "G3", "G4", "G5", "G6", "G7"];
    const store = makeFakeStore({
      tasteEvents: genres.map((g, i) =>
        // i days ago: G0 newest (weight ~1), G7 oldest (lowest weight).
        tasteEvent({ id: `e${i}`, metadata: { genres: g }, createdAt: isoDaysAgo(i) }),
      ),
    });
    const context = await buildTasteContext(store, { useCache: false, now: NOW });
    expect(lineValues(context, "Liked genres")).toEqual([
      "G0",
      "G1",
      "G2",
      "G3",
      "G4",
      "G5",
    ]);
  });

  it("keeps liked and disliked genre tallies separate", async () => {
    const store = makeFakeStore({
      tasteEvents: [
        tasteEvent({ id: "a", eventType: "liked", metadata: { genres: "Sci-Fi" } }),
        tasteEvent({ id: "b", eventType: "disliked", metadata: { genres: "Western" } }),
      ],
    });
    const context = await buildTasteContext(store, { useCache: false, now: NOW });
    expect(lineValues(context, "Liked genres")).toEqual(["Sci-Fi"]);
    expect(lineValues(context, "Disliked genres")).toEqual(["Western"]);
  });

  it("ignores taste events that are neither liked nor disliked", async () => {
    const store = makeFakeStore({
      tasteEvents: [
        tasteEvent({ id: "a", eventType: "watched", metadata: { genres: "Drama", title: "Heat" } }),
        tasteEvent({ id: "b", eventType: "searched", metadata: { genres: "Comedy", title: "Up" } }),
        tasteEvent({ id: "c", eventType: "rated", metadata: { genres: "Horror", title: "It" } }),
      ],
    });
    const context = await buildTasteContext(store, { useCache: false, now: NOW });
    // None of those event types contribute, so there is no signal at all.
    expect(context).toBe("");
  });
});

// MARK: - genre / title metadata parsing edge cases

describe("buildTasteContext metadata parsing", () => {
  it("trims whitespace and drops empty segments in the genre list", async () => {
    const store = makeFakeStore({
      tasteEvents: [
        tasteEvent({ id: "a", metadata: { genres: "  Drama ,, , Comedy ," } }),
      ],
    });
    const context = await buildTasteContext(store, { useCache: false, now: NOW });
    expect(lineValues(context, "Liked genres")).toEqual(["Comedy", "Drama"]);
  });

  it("contributes no genres when the genres metadata is missing", async () => {
    const store = makeFakeStore({
      tasteEvents: [
        tasteEvent({ id: "a", metadata: { title: "Whiplash" } }),
      ],
    });
    const context = await buildTasteContext(store, { useCache: false, now: NOW });
    // No genre line, but the title still surfaces.
    expect(context).not.toContain("Liked genres:");
    expect(lineValues(context, "Liked titles")).toEqual(["Whiplash"]);
  });

  it("contributes no genres when the genres metadata is blank", async () => {
    const store = makeFakeStore({
      tasteEvents: [
        tasteEvent({ id: "a", metadata: { genres: "   ", title: "Drive" } }),
      ],
    });
    const context = await buildTasteContext(store, { useCache: false, now: NOW });
    expect(context).not.toContain("Liked genres:");
    expect(lineValues(context, "Liked titles")).toEqual(["Drive"]);
  });

  it("omits a title with blank title metadata but keeps its genre signal", async () => {
    const store = makeFakeStore({
      tasteEvents: [
        tasteEvent({ id: "a", metadata: { genres: "Drama", title: "   " } }),
      ],
    });
    const context = await buildTasteContext(store, { useCache: false, now: NOW });
    expect(lineValues(context, "Liked genres")).toEqual(["Drama"]);
    expect(context).not.toContain("Liked titles:");
  });

  it("trims surrounding whitespace from a stamped title", async () => {
    const store = makeFakeStore({
      tasteEvents: [
        tasteEvent({ id: "a", metadata: { genres: "Drama", title: "  Sicario  " } }),
      ],
    });
    const context = await buildTasteContext(store, { useCache: false, now: NOW });
    expect(lineValues(context, "Liked titles")).toEqual(["Sicario"]);
  });
});

// MARK: - title list dedup + caps

describe("buildTasteContext title list dedup + caps", () => {
  it("dedups liked titles case-insensitively, preserving first-seen casing", async () => {
    const store = makeFakeStore({
      tasteEvents: [
        tasteEvent({ id: "a", metadata: { title: "Arrival" } }),
        tasteEvent({ id: "b", metadata: { title: "ARRIVAL" } }),
        tasteEvent({ id: "c", metadata: { title: "Dune" } }),
      ],
    });
    const context = await buildTasteContext(store, { useCache: false, now: NOW });
    expect(lineValues(context, "Liked titles")).toEqual(["Arrival", "Dune"]);
  });

  it("caps liked titles at 8", async () => {
    const store = makeFakeStore({
      tasteEvents: Array.from({ length: 12 }, (_, i) =>
        tasteEvent({ id: `e${i}`, metadata: { title: `Title ${i}` } }),
      ),
    });
    const context = await buildTasteContext(store, { useCache: false, now: NOW });
    expect(lineValues(context, "Liked titles")).toHaveLength(8);
    expect(lineValues(context, "Liked titles")).toEqual([
      "Title 0",
      "Title 1",
      "Title 2",
      "Title 3",
      "Title 4",
      "Title 5",
      "Title 6",
      "Title 7",
    ]);
  });

  it("caps recently-watched titles at 10 and dedups case-insensitively", async () => {
    const rows = [
      historyRow("d0", "Repeat"),
      historyRow("d1", "REPEAT"),
      ...Array.from({ length: 12 }, (_, i) => historyRow(`w${i}`, `Watched ${i}`)),
    ];
    const store = makeFakeStore({ history: rows });
    const context = await buildTasteContext(store, { useCache: false, now: NOW });
    const watched = lineValues(context, "Recently watched");
    expect(watched).toHaveLength(10);
    // "Repeat" appears once (the second, upper-case row is a dup).
    expect(watched[0]).toBe("Repeat");
    expect(watched).not.toContain("REPEAT");
  });

  it("caps watchlist titles at 10", async () => {
    const store = makeFakeStore({
      watchlist: Array.from({ length: 14 }, (_, i) =>
        watchlistRow(`wl${i}`, `WL ${i}`),
      ),
    });
    const context = await buildTasteContext(store, { useCache: false, now: NOW });
    expect(lineValues(context, "On my watchlist")).toHaveLength(10);
  });
});

// MARK: - section presence + ordering

describe("buildTasteContext section assembly", () => {
  it("emits all six sections in the documented order", async () => {
    const store = makeFakeStore({
      tasteEvents: [
        tasteEvent({ id: "a", eventType: "liked", metadata: { genres: "Drama", title: "Heat" } }),
        tasteEvent({ id: "b", eventType: "disliked", metadata: { genres: "Western", title: "Shane" } }),
      ],
      history: [historyRow("h1", "Tenet")],
      watchlist: [watchlistRow("wl1", "Sicario")],
    });
    const context = await buildTasteContext(store, { useCache: false, now: NOW });
    expect(context.split("\n")).toEqual([
      "Liked genres: Drama",
      "Disliked genres: Western",
      "Liked titles: Heat",
      "Disliked titles: Shane",
      "Recently watched: Tenet",
      "On my watchlist: Sicario",
    ]);
  });

  it("returns '' when every source is empty", async () => {
    const store = makeFakeStore({});
    const context = await buildTasteContext(store, { useCache: false, now: NOW });
    expect(context).toBe("");
  });

  it("surfaces a disliked-only signal on its own", async () => {
    const store = makeFakeStore({
      tasteEvents: [
        tasteEvent({ id: "a", eventType: "disliked", metadata: { genres: "Musical", title: "Cats" } }),
      ],
    });
    const context = await buildTasteContext(store, { useCache: false, now: NOW });
    expect(context.split("\n")).toEqual([
      "Disliked genres: Musical",
      "Disliked titles: Cats",
    ]);
  });
});

// MARK: - length budget

describe("buildTasteContext length budget", () => {
  it("trims to under the 1500-char budget on a line boundary", async () => {
    // Many liked events each carry a long unique title, producing a long
    // "Liked titles" line plus many "Liked genres". Build enough sections that
    // the joined context exceeds 1500 chars, then assert the trim is clean.
    const longTitle = (i: number) => `Title-${i}-${"x".repeat(200)}`;
    const store = makeFakeStore({
      // 8 liked titles each ~210 chars -> Liked titles line alone > 1500 chars.
      tasteEvents: Array.from({ length: 8 }, (_, i) =>
        tasteEvent({
          id: `e${i}`,
          metadata: { genres: `Genre${i}`, title: longTitle(i) },
        }),
      ),
    });
    const context = await buildTasteContext(store, { useCache: false, now: NOW });
    expect(context.length).toBeLessThanOrEqual(1500);
    // Trimmed on a newline boundary, so no trailing partial line remains.
    expect(context.endsWith("\n")).toBe(false);
    // The first (genres) section survives intact.
    expect(context.startsWith("Liked genres:")).toBe(true);
  });

  it("keeps a single long line intact when no line boundary exists", async () => {
    const store = makeFakeStore({
      tasteEvents: [
        tasteEvent({
          id: "single",
          metadata: { title: `Title-${"x".repeat(1510)}` },
        }),
      ],
    });
    const context = await buildTasteContext(store, { useCache: false, now: NOW });

    expect(context.length).toBeLessThanOrEqual(1500);
    expect(context.startsWith("Liked titles:")).toBe(true);
    expect(context.includes("\n")).toBe(false);
  });
});
