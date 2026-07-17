import { describe, expect, it } from "vitest";
import {
  AIProviderKind,
  AIUsageMetrics,
  AIMovieRecommendation,
  makeAIMovieRecommendation,
} from "./models";

describe("AIProviderKind", () => {
  it("exposes provider constants and human labels", () => {
    expect(AIProviderKind.openAI).toBe("openai");
    expect(AIProviderKind.anthropic).toBe("anthropic");
    expect(AIProviderKind.ollama).toBe("ollama");
    expect(AIProviderKind.displayName("openai")).toBe("OpenAI");
    expect(AIProviderKind.displayName("anthropic")).toBe("Anthropic");
    expect(AIProviderKind.displayName("ollama")).toBe("Ollama");
  });

  it("returns all provider kinds", () => {
    expect(AIProviderKind.allCases()).toEqual([
      "anthropic",
      "openai",
      "gemini",
      "openrouter",
      "groq",
      "mistral",
      "deepseek",
      "xai",
      "ollama",
    ]);
  });
});

describe("makeAIMovieRecommendation", () => {
  it("normalizes optional properties to null by default", () => {
    const rec = makeAIMovieRecommendation({
      title: "Dune",
      reason: "Strong world-building.",
      score: 0.93,
    });
    expect(rec).toMatchObject({
      title: "Dune",
      reason: "Strong world-building.",
      score: 0.93,
      year: null,
      mediaId: null,
      mediaType: null,
      posterPath: null,
    });
  });

  it("preserves explicit optional values when provided", () => {
    const rec = makeAIMovieRecommendation({
      title: "Dune",
      reason: "Sci-fi",
      score: 0.7,
      year: 2024,
      mediaId: "tt123",
      mediaType: "movie",
      posterPath: "/poster.jpg",
    });
    expect(rec.year).toBe(2024);
    expect(rec.mediaId).toBe("tt123");
    expect(rec.mediaType).toBe("movie");
    expect(rec.posterPath).toBe("/poster.jpg");
  });
});

describe("AIMovieRecommendation helpers", () => {
  it("prefers mediaId in id()", () => {
    const idd = AIMovieRecommendation.id({
      title: "No Key",
      year: 1994,
      reason: "x",
      score: 1,
      mediaId: "tmdb-42",
    } as AIMovieRecommendation);
    expect(idd).toBe("tmdb-42");
  });

  it("falls back to lowercased title + year in id()", () => {
    const idd = AIMovieRecommendation.id({
      title: "The Matrix",
      year: 1999,
      reason: "x",
      score: 1,
    });
    expect(idd).toBe("the matrix-1999");
  });

  it("builds poster URLs from posterPath and returns null otherwise", () => {
    expect(
      AIMovieRecommendation.posterURL({
        title: "A",
        reason: "r",
        score: 1,
        posterPath: "/abc.jpg",
      } as AIMovieRecommendation),
    ).toBe("https://image.tmdb.org/t/p/w342/abc.jpg");
    expect(
      AIMovieRecommendation.posterURL({
        title: "B",
        reason: "r",
        score: 0,
      } as AIMovieRecommendation),
    ).toBeNull();
  });
});

describe("AIUsageMetrics.safeTotalTokens", () => {
  it("returns totalTokens when provided", () => {
    expect(
      AIUsageMetrics.safeTotalTokens({ totalTokens: 120, inputTokens: 10, outputTokens: 20 }),
    ).toBe(120);
  });

  it("falls back to summed input/output tokens when total is missing", () => {
    expect(
      AIUsageMetrics.safeTotalTokens({ inputTokens: 7, outputTokens: 9, totalTokens: null }),
    ).toBe(16);
  });

  it("clamps negative totals to zero", () => {
    expect(
      AIUsageMetrics.safeTotalTokens({ inputTokens: -5, outputTokens: -7, totalTokens: -1 }),
    ).toBe(0);
  });
});
