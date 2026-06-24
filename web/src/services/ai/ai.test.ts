// Mirrors the Swift AI tests:
//  - Tests/.../AIAssistantManagerTests.swift  -> AIAssistantJSONParserTests
//    (the pure, no-network JSON parser cases)
//  - Tests/.../AnthropicProviderTests.swift    (text-block response parse)
//  - Tests/.../OpenAIProviderTests.swift       (chat-completion parse + missing key)
//  - Tests/.../OllamaProviderTests.swift       (ollama chat parse, heuristic usage)
//  - Tests/.../AIUsageCostEstimatorTests.swift (known/unknown/no-token pricing)
//
// The Swift tests stub the network with a MockURLProtocol handler keyed per
// session. Here we inject a `FetchImpl` stub that plays the same role: it
// captures the request and counts calls. The canned JSON bodies are the exact
// shapes used in the Swift test files.

import { describe, expect, it } from "vitest";
import {
  AIAssistantJSONParser,
  AIUsageCostEstimator,
  type FetchImpl,
} from "./types";
import { AnthropicProvider } from "./AnthropicProvider";
import { OpenAIProvider } from "./OpenAIProvider";
import { OllamaProvider } from "./OllamaProvider";

// MARK: - fetch stub (mirrors MockURLProtocol + makeMockSession)

interface MockRequest {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}

interface MockFetch {
  fetchImpl: FetchImpl;
  /** The last request captured. */
  lastRequest: () => MockRequest | null;
  /** Number of times the stub was invoked. */
  hits: () => number;
}

/** Builds a fetch stub returning a fixed status + body, capturing the request. */
function makeMockFetch(status: number, body: string): MockFetch {
  let count = 0;
  let captured: MockRequest | null = null;
  const fetchImpl: FetchImpl = async (url, init) => {
    count += 1;
    captured = {
      url,
      method: init?.method,
      headers: init?.headers,
      body: init?.body,
    };
    return {
      status,
      text: async () => body,
    };
  };
  return {
    fetchImpl,
    lastRequest: () => captured,
    hits: () => count,
  };
}

// MARK: - Canned JSON (the exact shapes from the Swift provider tests)

// AnthropicProviderTests.parsesRecommendations
const anthropicBody = JSON.stringify({
  model: "claude-3-7-sonnet-latest",
  usage: {
    input_tokens: 90,
    output_tokens: 45,
  },
  content: [
    {
      type: "text",
      text: '{"recommendations":[{"title":"Arrival","year":2016,"reason":"Smart sci-fi","score":0.88}]}',
    },
  ],
});

// OpenAIProviderTests.parsesRecommendations
const openAIBody = JSON.stringify({
  model: "gpt-4.1-mini",
  usage: {
    prompt_tokens: 120,
    completion_tokens: 80,
    total_tokens: 200,
  },
  choices: [
    {
      message: {
        content:
          '{"recommendations":[{"title":"Dune","year":2021,"reason":"Sci-fi epic","score":0.9}]}',
      },
    },
  ],
});

// OllamaProviderTests.parsesResponse
const ollamaBody = JSON.stringify({
  message: {
    role: "assistant",
    content:
      '{"recommendations":[{"title":"Blade Runner 2049","year":2017,"reason":"Atmospheric sci-fi","score":0.93}]}',
  },
});

// MARK: - AIAssistantJSONParser (pure, no network) — mirrors AIAssistantJSONParserTests

describe("AIAssistantJSONParser", () => {
  it("parses a clean JSON object", () => {
    const text =
      '{"recommendations":[{"title":"Dune","year":2021,"reason":"Epic","score":0.9}]}';
    const recs = AIAssistantJSONParser.parseRecommendations(text, 5);
    expect(recs.length).toBe(1);
    expect(recs[0].title).toBe("Dune");
    expect(recs[0].year).toBe(2021);
  });

  it("extracts JSON wrapped in markdown code fences", () => {
    const text = [
      "Here are my picks:",
      "```json",
      '{"recommendations":[{"title":"Arrival","year":2016,"reason":"Smart","score":0.8}]}',
      "```",
      "Hope that helps!",
    ].join("\n");
    const recs = AIAssistantJSONParser.parseRecommendations(text, 5);
    expect(recs.length).toBe(1);
    expect(recs[0].title).toBe("Arrival");
  });

  it("picks the first balanced object when multiple JSON objects are present", () => {
    const text = [
      '{"recommendations":[{"title":"Interstellar","year":2014,"reason":"Scale","score":0.85}]}',
      '{"recommendations":[{"title":"Tenet","year":2020,"reason":"Time","score":0.7}]}',
    ].join("\n");
    const recs = AIAssistantJSONParser.parseRecommendations(text, 5);
    expect(recs.length).toBe(1);
    expect(recs[0].title).toBe("Interstellar");
  });

  it("does not break on braces inside string values", () => {
    const text =
      '{"recommendations":[{"title":"The } Movie {","year":2024,"reason":"Has braces } in it","score":0.6}]}';
    const recs = AIAssistantJSONParser.parseRecommendations(text, 5);
    expect(recs.length).toBe(1);
    expect(recs[0].title).toBe("The } Movie {");
  });

  it("falls back to line parsing when no JSON object is present", () => {
    const text = ["1. Dune", "2. Arrival"].join("\n");
    const recs = AIAssistantJSONParser.parseRecommendations(text, 5);
    expect(recs.length).toBe(2);
    expect(recs[0].title).toBe("Dune");
    expect(recs[1].title).toBe("Arrival");
  });

  it("applies defaults for missing reason/score and respects maxResults", () => {
    const text =
      '{"recommendations":[{"title":"A"},{"title":"B"},{"title":"C"}]}';
    const recs = AIAssistantJSONParser.parseRecommendations(text, 2);
    expect(recs.length).toBe(2); // capped by maxResults
    expect(recs[0].reason).toBe("Recommended by AI assistant.");
    expect(recs[0].score).toBe(0.5);
  });

  it("parses a bare top-level JSON array (common LLM schema deviation)", () => {
    // The model dropped the {recommendations:...} wrapper and returned an array.
    const text =
      '[{"title":"A","year":2000},{"title":"B","year":2001},{"title":"C"}]';
    const recs = AIAssistantJSONParser.parseRecommendations(text, 5);
    expect(recs.map((r) => r.title)).toEqual(["A", "B", "C"]);
    expect(recs[0].year).toBe(2000);
  });

  it("parses a single bare recommendation object", () => {
    const text = '{"title":"Solo","year":2018,"reason":"One pick","score":0.7}';
    const recs = AIAssistantJSONParser.parseRecommendations(text, 5);
    expect(recs.length).toBe(1);
    expect(recs[0].title).toBe("Solo");
  });

  it("salvages complete elements from truncated array output (no JSON junk title)", () => {
    // max_tokens cut the model off mid-object: keep the complete ones, drop the
    // partial tail, and never emit the raw blob as a single recommendation.
    const text =
      '{"recommendations":[{"title":"Inception","year":2010},{"title":"Interst';
    const recs = AIAssistantJSONParser.parseRecommendations(text, 5);
    expect(recs.length).toBe(1);
    expect(recs[0].title).toBe("Inception");
    expect(recs[0].year).toBe(2010);
  });

  it("salvages a truncated bare array too", () => {
    const text = '[{"title":"A","year":2000},{"title":"B","yea';
    const recs = AIAssistantJSONParser.parseRecommendations(text, 5);
    expect(recs.map((r) => r.title)).toEqual(["A"]);
  });

  it("returns nothing (not junk) for unsalvageable JSON-shaped output", () => {
    // First object never closes → no complete element to salvage. Must NOT turn
    // the raw blob into a bogus title via the line fallback.
    const text = '{"recommendations":[{"title":"Inc';
    const recs = AIAssistantJSONParser.parseRecommendations(text, 5);
    expect(recs).toEqual([]);
  });

  it("drops entries with no usable title", () => {
    const text = '{"recommendations":[{"title":"Keep"},{"year":2020},{}]}';
    const recs = AIAssistantJSONParser.parseRecommendations(text, 5);
    expect(recs.map((r) => r.title)).toEqual(["Keep"]);
  });

  it("skips a nested array inside a top-level array (no silent drop)", () => {
    // typeof [] === "object" — a nested-array element must be filtered, not
    // passed through as a title-less recommendation.
    const text = '[[{"title":"Nested"}],{"title":"Real","year":2001}]';
    const recs = AIAssistantJSONParser.parseRecommendations(text, 5);
    expect(recs.map((r) => r.title)).toEqual(["Real"]);
  });

  it("does not salvage objects from an unrelated array (no recommendations key)", () => {
    // JSON-shaped, but the array is `meta`, not `recommendations`. Salvage must
    // NOT grab those objects; with no real recommendations the result is [].
    const text = '{"meta":[{"title":"WrongA"},{"title":"WrongB"}]}';
    const recs = AIAssistantJSONParser.parseRecommendations(text, 5);
    expect(recs).toEqual([]);
  });
});

// MARK: - AnthropicProvider — mirrors AnthropicProviderTests.parsesRecommendations

describe("AnthropicProvider", () => {
  it("parses a text block response into recommendations with usage and model", async () => {
    const mock = makeMockFetch(200, anthropicBody);
    const provider = new AnthropicProvider("test-key", undefined, mock.fetchImpl);

    const result = await provider.recommend("Sci-fi", [], 5);

    expect(result.recommendations.length).toBe(1);
    expect(result.recommendations[0].title).toBe("Arrival");
    expect(result.recommendations[0].year).toBe(2016);
    expect(result.usage?.inputTokens).toBe(90);
    expect(result.model).toBe("claude-3-7-sonnet-latest");

    // Request shape: endpoint + Anthropic headers.
    const req = mock.lastRequest()!;
    expect(req.url).toBe("https://api.anthropic.com/v1/messages");
    expect(req.headers?.["x-api-key"]).toBe("test-key");
    expect(req.headers?.["anthropic-version"]).toBe("2023-06-01");
  });

  it("throws missingAPIKey when the key is blank", async () => {
    const provider = new AnthropicProvider("   ");
    await expect(provider.recommend("Anything", [], 3)).rejects.toMatchObject({
      kind: "missingAPIKey",
    });
  });

  it("maps a non-2xx response to an apiError carrying the body", async () => {
    const mock = makeMockFetch(400, '{"error":"temperature unsupported"}');
    const provider = new AnthropicProvider("test-key", undefined, mock.fetchImpl);
    await expect(provider.recommend("Sci-fi", [], 5)).rejects.toMatchObject({
      kind: "apiError",
    });
  });
});

// MARK: - OpenAIProvider — mirrors OpenAIProviderTests

describe("OpenAIProvider", () => {
  it("parses JSON recommendations from a chat completion response", async () => {
    const mock = makeMockFetch(200, openAIBody);
    const provider = new OpenAIProvider("test-key", undefined, mock.fetchImpl);

    const result = await provider.recommend("Sci-fi recommendations", [], 5);

    expect(result.recommendations.length).toBe(1);
    expect(result.recommendations[0].title).toBe("Dune");
    expect(result.recommendations[0].year).toBe(2021);
    expect(result.usage?.totalTokens).toBe(200);
    expect(result.model).toBe("gpt-4.1-mini");

    const req = mock.lastRequest()!;
    expect(req.url).toBe("https://api.openai.com/v1/chat/completions");
    expect(req.headers?.Authorization).toBe("Bearer test-key");
  });

  it("fails fast with missingAPIKey when the key is empty", async () => {
    const provider = new OpenAIProvider("");
    await expect(provider.recommend("Anything", [], 3)).rejects.toMatchObject({
      kind: "missingAPIKey",
    });
  });
});

// MARK: - OllamaProvider — mirrors OllamaProviderTests.parsesResponse

describe("OllamaProvider", () => {
  it("parses an Ollama chat response and fills heuristic usage", async () => {
    const mock = makeMockFetch(200, ollamaBody);
    const provider = new OllamaProvider(
      "http://localhost:11434/api/chat",
      undefined,
      mock.fetchImpl,
    );

    const result = await provider.recommend("Recommend me sci-fi", [], 5);

    expect(result.recommendations.length).toBe(1);
    expect(result.recommendations[0].title).toBe("Blade Runner 2049");
    expect(result.recommendations[0].year).toBe(2017);
    expect(result.model).toBe("llama3.1:8b");
    // No official usage from Ollama -> heuristic token count must be > 0.
    const total =
      (result.usage?.totalTokens ?? 0) > 0 ? result.usage!.totalTokens! : 0;
    expect(total).toBeGreaterThan(0);
    expect(result.usage?.estimatedCostUSD).toBe(0);

    // POSTs to the supplied endpoint, no auth header.
    const req = mock.lastRequest()!;
    expect(req.url).toBe("http://localhost:11434/api/chat");
    expect(req.method).toBe("POST");
  });
});

// MARK: - AIUsageCostEstimator — mirrors AIUsageCostEstimatorTests

describe("AIUsageCostEstimator", () => {
  it("known model pricing produces a non-zero estimate", () => {
    const estimated = AIUsageCostEstimator.estimateUSD(
      "gpt-4.1-mini",
      1_000,
      500,
      1_500,
    );
    expect(estimated).not.toBeNull();
    expect(estimated!).toBeGreaterThan(0);
  });

  it("unknown model falls back to a total-token estimate", () => {
    const estimated = AIUsageCostEstimator.estimateUSD(
      "unknown-model",
      null,
      null,
      2_000,
    );
    expect(estimated).not.toBeNull();
    expect(estimated!).toBeGreaterThan(0);
  });

  it("no token usage returns null", () => {
    const estimated = AIUsageCostEstimator.estimateUSD("gpt-4.1-mini", 0, 0, 0);
    expect(estimated).toBeNull();
  });
});
