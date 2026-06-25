// Extra coverage for src/services/ai/types.ts — targets the rarely-hit branches
// the primary ai.test.ts / analysis.test.ts / boundedRead.test.ts don't reach:
//  - AIUsageCostEstimator family fallbacks (mini/haiku/sonnet/opus substring
//    pricing + the unknown-model total-token fallback, incl. the null returns),
//  - parsePersonalizedAnalysis: reasons supplied as objects (text/reason/value
//    keys) and as a single string, the array-only / null skip in
//    extractAnalysisPayload, and the final bare-object JSON.parse fallback,
//  - parseRecommendations: the line-fallback path that yields an indexed
//    "Recommendation N" placeholder when a list line strips to empty, and a
//    bare-object recommendation containing a literal brace inside a string,
//  - sumTokens null handling.
//
// These are pure (no network) functions, so no fetch stub / store mock is
// needed. TESTS ONLY — no source file is touched.

import { describe, expect, it } from "vitest";
import {
  AIAssistantJSONParser,
  AIUsageCostEstimator,
  parsePersonalizedAnalysis,
  sumTokens,
} from "./types";

// MARK: - AIUsageCostEstimator substring fallbacks

describe("AIUsageCostEstimator substring-rate fallbacks", () => {
  it("prices an unknown 'mini' model with the mini fallback rate", () => {
    // "gpt-9-mini" is not in KNOWN_RATES but contains "mini" -> 0.5 / 2.0.
    const cost = AIUsageCostEstimator.estimateUSD("gpt-9-mini", 1_000_000, 1_000_000, null);
    expect(cost).toBeCloseTo(0.5 + 2.0, 10);
  });

  it("prices an unknown 'haiku' model with the haiku fallback rate", () => {
    const cost = AIUsageCostEstimator.estimateUSD("claude-haiku-9", 1_000_000, 0, null);
    expect(cost).toBeCloseTo(1.0, 10);
  });

  it("prices an unknown 'sonnet' model with the sonnet fallback rate", () => {
    const cost = AIUsageCostEstimator.estimateUSD("claude-sonnet-9", 0, 1_000_000, null);
    expect(cost).toBeCloseTo(15.0, 10);
  });

  it("prices an unknown 'opus' model with the opus fallback rate", () => {
    const cost = AIUsageCostEstimator.estimateUSD("claude-opus-9", 1_000_000, 1_000_000, null);
    expect(cost).toBeCloseTo(5.0 + 25.0, 10);
  });

  it("derives output tokens from total minus input for a substring-rate model", () => {
    // outputTokens omitted -> derived = max(0, total - input) = 600_000.
    const cost = AIUsageCostEstimator.estimateUSD("x-mini", 400_000, null, 1_000_000);
    const expected = (400_000 / 1_000_000) * 0.5 + (600_000 / 1_000_000) * 2.0;
    expect(cost).toBeCloseTo(expected, 10);
  });

  it("returns null for a substring-rate model with zero input and output", () => {
    expect(AIUsageCostEstimator.estimateUSD("y-mini", 0, 0, 0)).toBeNull();
  });

  it("prices a fully-unknown model from total tokens at the conservative $2/1M", () => {
    const cost = AIUsageCostEstimator.estimateUSD("totally-unknown-model", null, null, 500_000);
    expect(cost).toBeCloseTo((500_000 / 1_000_000) * 2.0, 10);
  });

  it("returns null for a fully-unknown model with no positive total tokens", () => {
    expect(AIUsageCostEstimator.estimateUSD("totally-unknown-model", null, null, 0)).toBeNull();
    expect(AIUsageCostEstimator.estimateUSD("totally-unknown-model", null, null, null)).toBeNull();
  });

  it("returns null for an empty/whitespace model name with no total tokens", () => {
    expect(AIUsageCostEstimator.estimateUSD("   ", null, null, null)).toBeNull();
  });

  it("prices an empty model name from total tokens via the unknown fallback", () => {
    const cost = AIUsageCostEstimator.estimateUSD("", null, null, 250_000);
    expect(cost).toBeCloseTo((250_000 / 1_000_000) * 2.0, 10);
  });
});

// MARK: - sumTokens null handling

describe("sumTokens", () => {
  it("treats null and undefined operands as zero", () => {
    expect(sumTokens(null, undefined)).toBe(0);
    expect(sumTokens(7, null)).toBe(7);
    expect(sumTokens(null, 5)).toBe(5);
    expect(sumTokens(3, 4)).toBe(7);
  });
});

// MARK: - parsePersonalizedAnalysis: reasons normalization edge cases

describe("parsePersonalizedAnalysis reasons normalization", () => {
  it("extracts text from object reason entries (text / reason / value keys)", () => {
    const raw = JSON.stringify({
      personalizedDescription: "ok",
      predictedRating: 7,
      verdict: "yes",
      reasons: [
        { text: " From text " },
        { reason: "From reason" },
        { value: "From value" },
        { unrelated: "dropped" },
        "   ",
      ],
    });
    const a = parsePersonalizedAnalysis(raw);
    expect(a.reasons).toEqual(["From text", "From reason", "From value"]);
  });

  it("accepts a single string reason and wraps it into a one-element array", () => {
    const raw = JSON.stringify({
      personalizedDescription: "ok",
      predictedRating: 7,
      verdict: "yes",
      reasons: "Just one reason",
    });
    const a = parsePersonalizedAnalysis(raw);
    expect(a.reasons).toEqual(["Just one reason"]);
  });

  it("yields no reasons for a blank single-string reasons value", () => {
    const raw = JSON.stringify({
      personalizedDescription: "ok",
      predictedRating: 7,
      verdict: "yes",
      reasons: "   ",
    });
    expect(parsePersonalizedAnalysis(raw).reasons).toEqual([]);
  });

  it("defaults to a safe 'maybe' / rating-5 when the model returns a bare array", () => {
    // A top-level array is not an analysis object: extractAnalysisPayload skips
    // it (Array.isArray guard) and falls through to the empty-payload defaults.
    const a = parsePersonalizedAnalysis('[{"title":"x"}]');
    expect(a.verdict).toBe("maybe");
    expect(a.predictedRating).toBe(5);
    expect(a.personalizedDescription).toBe("");
    expect(a.reasons).toEqual([]);
  });

  it("falls back to the first parseable non-analysis object when no analysis keys appear", () => {
    // No ANALYSIS_KEYS anywhere -> firstParseable object is returned, whose
    // fields are then coerced (no verdict -> "maybe", no rating -> 5).
    const a = parsePersonalizedAnalysis('Here: {"foo":"bar"} done');
    expect(a.verdict).toBe("maybe");
    expect(a.predictedRating).toBe(5);
  });

  it("parses an analysis object even when an unrelated brace object precedes it", () => {
    const raw =
      '{"foo":"bar"} then {"personalizedDescription":"D","predictedRating":8,"verdict":"yes","reasons":["R"]}';
    const a = parsePersonalizedAnalysis(raw);
    expect(a.personalizedDescription).toBe("D");
    expect(a.predictedRating).toBe(8);
    expect(a.verdict).toBe("yes");
    expect(a.reasons).toEqual(["R"]);
  });
});

// MARK: - parseRecommendations line fallback + bare-object salvage

describe("AIAssistantJSONParser.parseRecommendations edge paths", () => {
  it("emits an indexed placeholder title when a list line strips to empty", () => {
    // "1." strips its leading number/punctuation to "" -> "Recommendation 1".
    const recs = AIAssistantJSONParser.parseRecommendations("1.\n2. Inception", 5);
    expect(recs).toHaveLength(2);
    expect(recs[0].title).toBe("Recommendation 1");
    expect(recs[1].title).toBe("Inception");
    // Score decays by index in the line fallback.
    expect(recs[0].score).toBeCloseTo(1.0, 10);
    expect(recs[1].score).toBeCloseTo(0.9, 10);
  });

  it("parses a single bare recommendation object whose reason embeds a literal brace", () => {
    const raw = '{"title":"Brace Movie","reason":"contains a } brace","score":0.7}';
    const recs = AIAssistantJSONParser.parseRecommendations(raw, 5);
    expect(recs).toHaveLength(1);
    expect(recs[0].title).toBe("Brace Movie");
    expect(recs[0].reason).toBe("contains a } brace");
    expect(recs[0].score).toBe(0.7);
  });

  it("returns an empty list for JSON-shaped but unsalvageable truncated input", () => {
    // Opens with '{' (JSON-shaped) but no complete recommendation to salvage.
    expect(AIAssistantJSONParser.parseRecommendations('{"recommendations":[{', 5)).toEqual([]);
  });

  it("estimatedTokenCount floors at 1 for non-empty text and 0 for blank", () => {
    expect(AIAssistantJSONParser.estimatedTokenCount("")).toBe(0);
    expect(AIAssistantJSONParser.estimatedTokenCount("   ")).toBe(0);
    expect(AIAssistantJSONParser.estimatedTokenCount("ab")).toBe(1);
    expect(AIAssistantJSONParser.estimatedTokenCount("12345678")).toBe(2);
  });
});
