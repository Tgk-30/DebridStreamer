// Pure subtitle cue logic - parse, VTT convert, delay shift, AI-translation
// batching + reply stitching. No network, no DOM.

import { describe, expect, it, vi } from "vitest";
vi.mock("subsrt-ts", async () => {
  const actual = await vi.importActual<typeof import("subsrt-ts")>("subsrt-ts");
  return {
    __esModule: true,
    ...actual,
    default: {
      ...actual.default,
      parse: vi.fn(actual.default.parse),
    },
  };
});
import * as subsrt from "subsrt-ts";
import {
  applyTranslations,
  batchCuesForTranslation,
  cuesToVTT,
  parseSubtitles,
  parseTranslationReply,
  shiftCues,
  type SubtitleCue,
} from "./cues";

const SRT = [
  "1",
  "00:00:01,000 --> 00:00:04,000",
  "Hello world",
  "",
  "2",
  "00:00:05,500 --> 00:00:08,000",
  "Second line",
  "with break",
  "",
].join("\n");

describe("parseSubtitles", () => {
  it("parses SRT into ms-based cues", () => {
    const cues = parseSubtitles(SRT);
    expect(cues.length).toBe(2);
    expect(cues[0]).toMatchObject({ start: 1000, end: 4000, text: "Hello world" });
    expect(cues[1].start).toBe(5500);
    expect(cues[1].text).toBe("Second line\nwith break");
  });

  it("auto-detects WebVTT input", () => {
    const vtt = [
      "WEBVTT",
      "",
      "00:00:02.000 --> 00:00:03.000",
      "Caption",
      "",
    ].join("\n");
    const cues = parseSubtitles(vtt);
    expect(cues.length).toBe(1);
    expect(cues[0]).toMatchObject({ start: 2000, end: 3000, text: "Caption" });
  });

  it("returns [] for empty or garbage input", () => {
    expect(parseSubtitles("")).toEqual([]);
    expect(parseSubtitles("   ")).toEqual([]);
    expect(parseSubtitles("not a subtitle file at all")).toEqual([]);
  });

  it("filters non-caption and malformed nodes", () => {
    const parseSpy = vi.mocked(subsrt.default.parse);
    parseSpy.mockImplementationOnce(() => [
      { type: "style", start: 100, end: 200, text: "skip style" },
      { type: "caption", start: "1" as any, end: 5000, text: "bad start type" },
      { type: "caption", start: 5000, end: "2" as any, text: "bad end type" },
      { type: "caption", start: 6000, end: 5000, text: "inverted" },
      { type: "caption", start: 7000, end: 8000, text: " from text " },
      { type: "caption", start: 1000, end: 2000, content: " good  \r\n line " },
      { type: "caption", start: 9000, end: 10000 },
    ] as any);

    const cues = parseSubtitles("raw");

    expect(cues).toHaveLength(3);
    expect(cues[0]).toMatchObject({
      start: 7000,
      end: 8000,
      text: "from text",
    });
    expect(cues[1]).toMatchObject({ start: 1000, end: 2000, text: "good\n line" });
    expect(cues[2]).toMatchObject({ start: 9000, end: 10000, text: "" });
  });
});

describe("cuesToVTT", () => {
  it("emits a WEBVTT header and the cue timings", () => {
    const cues = parseSubtitles(SRT);
    const vtt = cuesToVTT(cues);
    expect(vtt.startsWith("WEBVTT")).toBe(true);
    expect(vtt).toContain("00:00:01.000 --> 00:00:04.000");
    expect(vtt).toContain("Hello world");
  });

  it("round-trips through parse without losing cues", () => {
    const cues = parseSubtitles(SRT);
    const reparsed = parseSubtitles(cuesToVTT(cues));
    expect(reparsed.length).toBe(cues.length);
    expect(reparsed[0].text).toBe(cues[0].text);
  });

  it("handles an empty cue list", () => {
    expect(cuesToVTT([]).startsWith("WEBVTT")).toBe(true);
  });
});

describe("shiftCues", () => {
  const cues: SubtitleCue[] = [
    { start: 1000, end: 2000, text: "a" },
    { start: 3000, end: 4000, text: "b" },
  ];

  it("delays cues forward", () => {
    const out = shiftCues(cues, 500);
    expect(out[0]).toMatchObject({ start: 1500, end: 2500 });
    expect(out[1].start).toBe(3500);
  });

  it("advances cues and clamps at zero", () => {
    const out = shiftCues(cues, -1500);
    expect(out[0].start).toBe(0); // clamped (would be -500)
    expect(out[1].start).toBe(1500);
  });

  it("does not mutate the input", () => {
    shiftCues(cues, 1000);
    expect(cues[0].start).toBe(1000);
  });

  it("returns a cloned array when delay is zero", () => {
    const out = shiftCues(cues, 0);
    expect(out).toHaveLength(2);
    expect(out[0]).not.toBe(cues[0]);
    expect(out[0]).toMatchObject({ start: 1000, end: 2000, text: "a" });
  });
});

describe("batchCuesForTranslation", () => {
  function makeCues(n: number): SubtitleCue[] {
    return Array.from({ length: n }, (_, i) => ({
      start: i * 1000,
      end: i * 1000 + 800,
      text: `line ${i}`,
    }));
  }

  it("groups cues into line-capped batches with local markers from 0", () => {
    const batches = batchCuesForTranslation(makeCues(85), 40);
    expect(batches.length).toBe(3); // 40 + 40 + 5
    // Every batch's payload restarts marker numbering at [[0]].
    for (const b of batches) {
      expect(b.payload.startsWith("[[0]] ")).toBe(true);
      expect(b.indices.length).toBeLessThanOrEqual(40);
    }
    // Indices are contiguous across batches.
    const all = batches.flatMap((b) => b.indices);
    expect(all).toEqual(Array.from({ length: 85 }, (_, i) => i));
  });

  it("splits on the character budget too", () => {
    const long: SubtitleCue[] = Array.from({ length: 10 }, (_, i) => ({
      start: i * 1000,
      end: i * 1000 + 900,
      text: "x".repeat(500),
    }));
    const batches = batchCuesForTranslation(long, 40, 1200);
    expect(batches.length).toBeGreaterThan(1);
  });

  it("encodes in-cue line breaks with a sentinel", () => {
    const batches = batchCuesForTranslation([
      { start: 0, end: 1000, text: "line one\nline two" },
    ]);
    expect(batches[0].payload).toContain("⏎");
    expect(batches[0].payload).not.toContain("\n");
  });

  it("returns no batches for empty input", () => {
    expect(batchCuesForTranslation([])).toEqual([]);
  });
});

describe("parseTranslationReply + applyTranslations", () => {
  it("maps markers back to text and restores line breaks", () => {
    const reply = ["[[0]] Hola mundo", "[[1]] Segunda línea ⏎ con salto"].join(
      "\n",
    );
    const map = parseTranslationReply(reply);
    expect(map.get(0)).toBe("Hola mundo");
    expect(map.get(1)).toBe("Segunda línea\ncon salto");
  });

  it("attaches marker-less continuation lines to the previous marker", () => {
    const reply = ["[[0]] First", "still first"].join("\n");
    const map = parseTranslationReply(reply);
    expect(map.get(0)).toBe("First\nstill first");
  });

  it("merges multi-line continuation text to the active marker", () => {
    const reply = ["[[2]] Start", "continues here", "and here"].join("\n");
    const map = parseTranslationReply(reply);
    expect(map.get(2)).toBe("Start\ncontinues here\nand here");
  });

  it("ignores whitespace-only continuation lines", () => {
    const reply = ["[[3]] Head", "   "].join("\n");
    const map = parseTranslationReply(reply);
    expect(map.get(3)).toBe("Head");
  });

  it("falls back to empty previous text if a cache lookup misses", () => {
    const originalGet = Map.prototype.get;
    let callCount = 0;
    const getSpy = vi
      .spyOn(Map.prototype, "get")
      .mockImplementation(function (this: Map<number, string>, key: number) {
        callCount += 1;
        if (this.size > 0 && callCount === 1) return undefined;
        return originalGet.call(this, key);
      });

    const reply = ["[[4]] Head", "second"].join("\n");
    const map = parseTranslationReply(reply);

    expect(map.get(4)).toBe("second");
    getSpy.mockRestore();
  });

  it("applies translations over a full batch, preserving timing", () => {
    const cues = parseSubtitles(SRT);
    const batches = batchCuesForTranslation(cues);
    // Simulate a translator reply for the single batch.
    const reply = batches[0].indices
      .map((_, local) => `[[${local}]] traducido ${local}`)
      .join("\n");
    const map = parseTranslationReply(reply);
    const sourceMap = new Map<number, string>();
    batches[0].indices.forEach((srcIdx, local) => {
      const t = map.get(local);
      if (t != null) sourceMap.set(srcIdx, t);
    });
    const out = applyTranslations(cues, sourceMap);
    expect(out.length).toBe(cues.length);
    expect(out[0].text).toBe("traducido 0");
    expect(out[0].start).toBe(cues[0].start); // timing preserved
    expect(out[0].end).toBe(cues[0].end);
  });

  it("falls back to the original text where a translation is missing", () => {
    const cues: SubtitleCue[] = [
      { start: 0, end: 1000, text: "keep me" },
    ];
    const out = applyTranslations(cues, new Map());
    expect(out[0].text).toBe("keep me");
  });
});
