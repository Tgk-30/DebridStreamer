// Tests for the personalized "Would I Like This?" analysis:
//  - parsePersonalizedAnalysis: tolerant JSON parsing (code fences, surrounding
//    prose), rating clamping, and verdict normalization (mirrors the Swift
//    parsePersonalizedAnalysis tolerances).
//  - buildTasteContext: a small fake Store proves a liked genre surfaces in the
//    emitted context, and an empty store yields "".

import { describe, expect, it } from "vitest";
import {
  parsePersonalizedAnalysis,
  personalizedAnalysisPrompt,
} from "./types";
import { buildTasteContext, recencyDecay } from "./TasteProfile";
import type { Store } from "../../storage/types";
import type {
  TasteEventRecord,
  WatchHistoryRecord,
  WatchlistRecord,
} from "../../storage/models";

// MARK: - parsePersonalizedAnalysis

describe("parsePersonalizedAnalysis", () => {
  it("parses a clean JSON object", () => {
    const raw = JSON.stringify({
      personalizedDescription: "Right up your alley.",
      predictedRating: 8,
      verdict: "yes",
      reasons: ["Smart sci-fi", "Strong direction"],
    });
    const a = parsePersonalizedAnalysis(raw);
    expect(a.personalizedDescription).toBe("Right up your alley.");
    expect(a.predictedRating).toBe(8);
    expect(a.verdict).toBe("yes");
    expect(a.reasons).toEqual(["Smart sci-fi", "Strong direction"]);
  });

  it("extracts JSON wrapped in markdown code fences", () => {
    const raw = [
      "Here's my take:",
      "```json",
      JSON.stringify({
        personalizedDescription: "A cozy match.",
        predictedRating: 7,
        verdict: "yes",
        reasons: ["Fits your mood"],
      }),
      "```",
      "Enjoy!",
    ].join("\n");
    const a = parsePersonalizedAnalysis(raw);
    expect(a.personalizedDescription).toBe("A cozy match.");
    expect(a.verdict).toBe("yes");
    expect(a.predictedRating).toBe(7);
  });

  it("extracts the JSON object out of surrounding prose (no fences)", () => {
    const raw =
      'Sure thing! {"personalizedDescription":"Maybe.","predictedRating":5,"verdict":"maybe","reasons":["Mixed signals"]} Hope that helps.';
    const a = parsePersonalizedAnalysis(raw);
    expect(a.personalizedDescription).toBe("Maybe.");
    expect(a.predictedRating).toBe(5);
    expect(a.verdict).toBe("maybe");
  });

  it("skips an example brace in prose and picks the analysis object", () => {
    // A stray {...} earlier in the prose must not be mistaken for the analysis;
    // the first object carrying an analysis key wins.
    const raw =
      'For example a movie object looks like {"title":"Dune","year":2021}. ' +
      'Here is your analysis: {"personalizedDescription":"A strong match.",' +
      '"predictedRating":9,"verdict":"strong_yes","reasons":["Epic scale"]}';
    const a = parsePersonalizedAnalysis(raw);
    expect(a.personalizedDescription).toBe("A strong match.");
    expect(a.predictedRating).toBe(9);
    expect(a.verdict).toBe("strong_yes");
  });

  it("preserves literal triple-backticks inside a valid unfenced object", () => {
    // Raw-first parsing: strippingCodeFences would delete the ``` and the text
    // between them, silently mangling the description. The raw object must win.
    const raw = JSON.stringify({
      personalizedDescription: "Use ```code``` blocks for snippets.",
      predictedRating: 6,
      verdict: "maybe",
      reasons: ["Has ```fenced``` examples"],
    });
    const a = parsePersonalizedAnalysis(raw);
    expect(a.personalizedDescription).toBe(
      "Use ```code``` blocks for snippets.",
    );
    expect(a.reasons).toEqual(["Has ```fenced``` examples"]);
  });

  it("clamps an out-of-range rating into 1..10", () => {
    expect(
      parsePersonalizedAnalysis(
        '{"personalizedDescription":"","predictedRating":42,"verdict":"strong_yes","reasons":[]}',
      ).predictedRating,
    ).toBe(10);
    expect(
      parsePersonalizedAnalysis(
        '{"personalizedDescription":"","predictedRating":-3,"verdict":"no","reasons":[]}',
      ).predictedRating,
    ).toBe(1);
    // Rounds a fractional rating.
    expect(
      parsePersonalizedAnalysis(
        '{"personalizedDescription":"","predictedRating":7.6,"verdict":"yes","reasons":[]}',
      ).predictedRating,
    ).toBe(8);
  });

  it("accepts a numeric-string rating", () => {
    expect(
      parsePersonalizedAnalysis(
        '{"personalizedDescription":"","predictedRating":"9","verdict":"yes","reasons":[]}',
      ).predictedRating,
    ).toBe(9);
  });

  it("normalizes a bad verdict to maybe", () => {
    expect(
      parsePersonalizedAnalysis(
        '{"personalizedDescription":"","predictedRating":6,"verdict":"banana","reasons":[]}',
      ).verdict,
    ).toBe("maybe");
  });

  it("normalizes verdict spelling/spacing variants", () => {
    expect(
      parsePersonalizedAnalysis(
        '{"personalizedDescription":"","predictedRating":9,"verdict":"Strong Yes","reasons":[]}',
      ).verdict,
    ).toBe("strong_yes");
  });

  it("coerces a single-string reasons field to an array", () => {
    const a = parsePersonalizedAnalysis(
      '{"personalizedDescription":"","predictedRating":6,"verdict":"maybe","reasons":"Just one"}',
    );
    expect(a.reasons).toEqual(["Just one"]);
  });

  it("falls back to a safe maybe on unparseable input", () => {
    const a = parsePersonalizedAnalysis("not json at all");
    expect(a.verdict).toBe("maybe");
    expect(a.predictedRating).toBe(5);
    expect(a.personalizedDescription).toBe("");
    expect(a.reasons).toEqual([]);
  });
});

// MARK: - personalizedAnalysisPrompt (smoke)

describe("personalizedAnalysisPrompt", () => {
  it("includes the title, genres, and taste context", () => {
    const prompt = personalizedAnalysisPrompt({
      title: "Arrival",
      year: 2016,
      type: "movie",
      genres: ["Science Fiction", "Drama"],
      overview: "Linguist meets aliens.",
      tasteContext: "Liked genres: Science Fiction",
    });
    expect(prompt).toContain("Arrival (2016)");
    expect(prompt).toContain("Science Fiction, Drama");
    expect(prompt).toContain("Liked genres: Science Fiction");
    expect(prompt).toContain('"predictedRating"');
  });

  it("uses the non-personalized framing when the context is empty", () => {
    const prompt = personalizedAnalysisPrompt({
      title: "Dune",
      year: null,
      type: "movie",
      genres: [],
      overview: null,
      tasteContext: "",
    });
    expect(prompt).toContain("no recorded taste profile");
  });
});

// MARK: - recencyDecay

describe("recencyDecay", () => {
  const DAY_MS = 86_400_000;
  const now = new Date("2026-06-24T00:00:00.000Z").getTime();

  it("weights a just-now event at ~1.0", () => {
    expect(recencyDecay(new Date(now).toISOString(), now)).toBeCloseTo(1, 10);
  });

  it("decays linearly over the 90-day window", () => {
    const fortyFiveDaysAgo = new Date(now - 45 * DAY_MS).toISOString();
    expect(recencyDecay(fortyFiveDaysAgo, now)).toBeCloseTo(0.5, 10);
  });

  it("floors old events at the minimum weight (0.1)", () => {
    const yearAgo = new Date(now - 365 * DAY_MS).toISOString();
    expect(recencyDecay(yearAgo, now)).toBe(0.1);
  });

  it("clamps a future-dated createdAt to 1.0 (no over-weight from clock skew)", () => {
    const tenDaysAhead = new Date(now + 10 * DAY_MS).toISOString();
    expect(recencyDecay(tenDaysAhead, now)).toBe(1);
  });

  it("returns the floor for an unparseable createdAt", () => {
    expect(recencyDecay("not-a-date", now)).toBe(0.1);
  });
});

// MARK: - buildTasteContext with a fake store

/** A tiny in-memory Store covering only the methods buildTasteContext touches;
 * every other method throws so an accidental dependency surfaces loudly. */
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

function likeEvent(
  mediaId: string,
  genres: string,
  title: string,
  createdAt: string,
): TasteEventRecord {
  return {
    id: `t-${mediaId}`,
    userId: "default",
    mediaId,
    episodeId: null,
    eventType: "liked",
    signalStrength: 1,
    metadata: { genres, title },
    createdAt,
  };
}

describe("buildTasteContext", () => {
  it("surfaces a liked genre and title in the context", async () => {
    const store = makeFakeStore({
      tasteEvents: [
        likeEvent(
          "tt1",
          "Science Fiction, Drama",
          "Arrival",
          new Date().toISOString(),
        ),
      ],
    });
    const context = await buildTasteContext(store, { useCache: false });
    expect(context).toContain("Liked genres:");
    expect(context).toContain("Science Fiction");
    expect(context).toContain("Arrival");
  });

  it("returns an empty string when there is no signal", async () => {
    const store = makeFakeStore({});
    const context = await buildTasteContext(store, { useCache: false });
    expect(context).toBe("");
  });

  it("includes recently-watched and watchlist titles", async () => {
    const preview = (id: string, title: string): WatchHistoryRecord["preview"] => ({
      id,
      type: "movie",
      title,
    });
    const store = makeFakeStore({
      history: [
        {
          id: "tt9:",
          mediaId: "tt9",
          episodeId: null,
          progressSeconds: 10,
          durationSeconds: 100,
          completed: false,
          lastWatched: new Date().toISOString(),
          streamQuality: null,
          preview: preview("tt9", "Tenet"),
        },
      ],
      watchlist: [
        {
          mediaId: "tt8",
          addedAt: new Date().toISOString(),
          preview: preview("tt8", "Sicario"),
        },
      ],
    });
    const context = await buildTasteContext(store, { useCache: false });
    expect(context).toContain("Recently watched: Tenet");
    expect(context).toContain("On my watchlist: Sicario");
  });

  it("serves a fresh cached context within the TTL", async () => {
    let calls = 0;
    const settings = new Map<string, string>();
    const store = new Proxy({} as Store, {
      get(_t, prop: string) {
        switch (prop) {
          case "recentTasteEvents":
            return async () => {
              calls += 1;
              return [likeEvent("tt1", "Comedy", "Barbie", new Date().toISOString())];
            };
          case "listHistory":
            return async () => [];
          case "listWatchlist":
            return async () => [];
          case "getSetting":
            return async (key: string) => settings.get(key) ?? null;
          case "setSetting":
            return async (key: string, value: string | null) => {
              if (value == null) settings.delete(key);
              else settings.set(key, value);
            };
          default:
            return () => {
              throw new Error(`unexpected ${prop}`);
            };
        }
      },
    }) as Store;

    const first = await buildTasteContext(store);
    const second = await buildTasteContext(store);
    expect(first).toBe(second);
    // The second call is served from the KV cache, so the events are only walked once.
    expect(calls).toBe(1);
  });
});
