import { describe, expect, it, vi } from "vitest";
import {
  AIAssistantJSONParser,
  AIAssistantProviderError,
  AIUsageCostEstimator,
  boundedReadText,
  parsePersonalizedAnalysis,
  personalizedAnalysisPrompt,
  resolveFetch,
  sumTokens,
} from "./types";

describe("AIAssistantProviderError", () => {
  it("builds expected static errors", () => {
    expect(AIAssistantProviderError.missingAPIKey()).toMatchObject({
      kind: "missingAPIKey",
      message: "Missing API key.",
    });
    expect(AIAssistantProviderError.invalidResponse()).toMatchObject({
      kind: "invalidResponse",
      message: "AI provider returned an invalid response.",
    });
    expect(AIAssistantProviderError.apiError("oops")).toMatchObject({
      kind: "apiError",
      message: "oops",
    });
  });
});

describe("AIAssistantJSONParser.parseRecommendations", () => {
  it("parses wrapper payloads and applies defaults", () => {
    const output = AIAssistantJSONParser.parseRecommendations(
      JSON.stringify({
        recommendations: [
          { title: "Inception", year: 2010 },
          { title: "NoReason" },
        ],
      }),
      10,
    );

    expect(output).toHaveLength(2);
    expect(output[0]).toMatchObject({
      title: "Inception",
      year: 2010,
      reason: "Recommended by AI assistant.",
      score: 0.5,
    });
    expect(output[1].reason).toBe("Recommended by AI assistant.");
  });

  it("parses bare arrays and single objects", () => {
    const array = AIAssistantJSONParser.parseRecommendations(
      JSON.stringify([{ title: "A" }, { title: "B" }]),
      2,
    );
    expect(array.map((r) => r.title)).toEqual(["A", "B"]);

    const single = AIAssistantJSONParser.parseRecommendations(
      JSON.stringify({ title: "Only", score: 9 }),
      3,
    );
    expect(single).toHaveLength(1);
    expect(single[0].title).toBe("Only");
    expect(single[0].score).toBe(9);
  });

  it("filters out title-less rows and slices to maxResults", () => {
    const output = AIAssistantJSONParser.parseRecommendations(
      JSON.stringify({ recommendations: [{ year: 2000 }, { title: "One" }, { title: "Two" }] }),
      1,
    );
    expect(output).toEqual([
      {
        title: "One",
        year: null,
        reason: "Recommended by AI assistant.",
        score: 0.5,
        mediaId: null,
        mediaType: null,
        posterPath: null,
      },
    ]);
  });

  it("salvages complete objects from truncated JSON arrays", () => {
    const partial = '[{"title":"A"},{"title":"B"},{"title":"C"';
    const out = AIAssistantJSONParser.parseRecommendations(partial, 10);
    expect(out.map((x) => x.title)).toEqual(["A", "B"]);
  });

  it("falls back to line parsing for plain text", () => {
    const out = AIAssistantJSONParser.parseRecommendations(
      "1. First\n2. Second\n3) Third",
      2,
    );
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({
      title: "First",
      year: null,
      reason: "Suggested by AI assistant.",
      score: 1,
    });
    expect(out[1].title).toBe("Second");
  });

  it("returns [] for malformed JSON-looking text to avoid junk titles", () => {
    const out = AIAssistantJSONParser.parseRecommendations('{"title":"x"', 3);
    expect(out).toEqual([]);
  });

  it("strips markdown fences and still parses", () => {
    const raw = [
      "```json",
      '{"recommendations":[{"title":"Cloak","score":7}]}',
      "```",
    ].join("\n");
    const out = AIAssistantJSONParser.parseRecommendations(raw, 5);
    expect(out).toEqual([
      {
        title: "Cloak",
        year: null,
        reason: "Recommended by AI assistant.",
        score: 7,
        mediaId: null,
        mediaType: null,
        posterPath: null,
      },
    ]);
  });
});

describe("AIAssistantJSONParser.estimatedTokenCount & promptEnvelope", () => {
  it("estimates token count from character length", () => {
    expect(AIAssistantJSONParser.estimatedTokenCount("" )).toBe(0);
    expect(AIAssistantJSONParser.estimatedTokenCount("abcd" )).toBe(1);
    expect(AIAssistantJSONParser.estimatedTokenCount("hello world this is a test")).toBe(5);
  });

  it("caps candidate list at 30 and formats prompt lines", () => {
    const candidates = Array.from({ length: 35 }, (_, i) => `Title ${i + 1}`);
    const prompt = AIAssistantJSONParser.promptEnvelope("short" , candidates, 5);
    expect(prompt).toContain("Recommend up to 5 items.");
    expect(prompt).toContain("Preferred candidate context (optional): Title 1, Title 2, Title 30");
    expect(prompt).not.toContain("Title 31");
  });
});

describe("personalizedAnalysisPrompt", () => {
  it("builds a non-empty profile-aware prompt for movies", () => {
    const prompt = personalizedAnalysisPrompt({
      title: "Matrix",
      year: 1999,
      type: "movie",
      genres: ["Action", "Sci-Fi"],
      overview: "A man sees beyond",
      tasteContext: "Likes smart sci-fi.",
    });
    expect(prompt).toContain("Analyze this movie");
    expect(prompt).toContain("Title: Matrix (1999)");
    expect(prompt).toContain("Genres: Action, Sci-Fi.");
  });

  it("defaults to no-profile wording when taste context is empty", () => {
    const prompt = personalizedAnalysisPrompt({
      title: "Show",
      type: "series",
      genres: [],
      tasteContext: "   ",
    });
    expect(prompt).toContain("no recorded taste profile");
    expect(prompt).toContain("Type: TV Series");
  });
});

describe("parsePersonalizedAnalysis", () => {
  it("parses fenced analysis payload and normalizes values", () => {
    const input = [
      "```json",
      JSON.stringify({
        personalizedDescription: "Great pacing.",
        predictedRating: "8.2",
        verdict: "YES",
        reasons: ["Action", { text: "Strong visuals" }, { reason: " " }, ""],
      }),
      "```",
    ].join("\n");
    const result = parsePersonalizedAnalysis(input);
    expect(result).toEqual({
      personalizedDescription: "Great pacing.",
      predictedRating: 8,
      verdict: "yes",
      reasons: ["Action", "Strong visuals"],
    });
  });

  it("clamps nonfinite or out-of-range predictedRating and normalizes verdict", () => {
    const result = parsePersonalizedAnalysis(
      JSON.stringify({ predictedRating: 123, verdict: "maybe, maybe" }),
    );
    expect(result.predictedRating).toBe(10);
    expect(result.verdict).toBe("maybe");
  });

  it("normalizes a single reason string and ignores unrelated parse keys", () => {
    const result = parsePersonalizedAnalysis('{"title":"noise","reasons":"Great cast"}');
    expect(result.predictedRating).toBe(5);
    expect(result.reasons).toEqual(["Great cast"]);
    expect(result.verdict).toBe("maybe");
  });

  it("falls back to defaults when payload is not JSON-shaped", () => {
    const result = parsePersonalizedAnalysis("Not JSON\nMaybe this is interesting");
    expect(result).toMatchObject({
      personalizedDescription: "",
      predictedRating: 5,
      verdict: "maybe",
      reasons: [],
    });
  });
});

describe("resolveFetch", () => {
  it("passes through non-streaming fetch stubs unchanged", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      status: 200,
      text: async () => "legacy",
    });
    const wrapped = resolveFetch(fetchImpl);
    const out = await wrapped("/v1/test");
    expect(fetchImpl).toHaveBeenCalledWith("/v1/test", undefined);
    expect(await out.text()).toBe("legacy");
  });

  it("bounds readable stream responses via boundedReadText", async () => {
    const payload = "hello";
    const response = new Response(payload);
    const fetchImpl = vi.fn(async () => response);
    const wrapped = resolveFetch(fetchImpl);
    const out = await wrapped("/stream");
    expect(await out.text()).toBe(payload);
    expect(out.status).toBe(200);
  });

  it("drops oversized content-length responses before reading body", async () => {
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("a"));
      },
    });
    const response = new Response(body, {
      headers: {
        "content-length": String(3_000_000),
      },
    });
    const wrapped = resolveFetch(() => Promise.resolve(response));
    const result = await wrapped("/too-large");
    expect(await result.text()).toBe("");
  });
});

describe("boundedReadText", () => {
  it("falls back to response.text when no stream exists", async () => {
    const response = new Response("abc");
    const out = await boundedReadText(response, 2);
    expect(out).toBe("ab");
  });
});

describe("AIUsageCostEstimator", () => {
  it("uses known model rates", () => {
    const usd = AIUsageCostEstimator.estimateUSD("gpt-4o-mini", 1000, 3000, 5000);
    expect(usd).not.toBeNull();
    expect(Math.round((usd ?? 0) * 1_000_000)).toBe(3300); // 0.15 + 1.8
  });

  it("falls back for mini/haiku/sonnet/opus by name", () => {
    expect(AIUsageCostEstimator.estimateUSD("custom-mini", 1000, 1000, 2000)).toBeCloseTo(
      0.0025,
      10,
    );
    expect(AIUsageCostEstimator.estimateUSD("my-haiku", 1000, 0, 1000)).toBeCloseTo(
      0.001,
      10,
    );
    expect(AIUsageCostEstimator.estimateUSD("super-sonnet", 1000, 1000, 2000)).toBeCloseTo(
      0.018,
      10,
    );
    expect(AIUsageCostEstimator.estimateUSD("opus-lite", 500, 500, 1000)).toBeCloseTo(
      0.015,
      10,
    );
  });

  it("falls back to unknown-model 2.0 USD per million when only total tokens exist", () => {
    expect(AIUsageCostEstimator.estimateUSD("mystery", null, null, 2_000_000)).toBe(4.0);
  });

  it("returns null when no tokens are available", () => {
    expect(AIUsageCostEstimator.estimateUSD("unknown", null, null, null)).toBeNull();
    expect(AIUsageCostEstimator.estimateUSD("", null, null, null)).toBeNull();
  });
});

describe("sumTokens", () => {
  it("adds optional token counts and drops nullish values", () => {
    expect(sumTokens(3, 4)).toBe(7);
    expect(sumTokens(null, 4)).toBe(4);
    expect(sumTokens(undefined, undefined)).toBe(0);
  });
});
