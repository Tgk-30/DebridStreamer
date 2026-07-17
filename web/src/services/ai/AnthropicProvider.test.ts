// Focused coverage for AnthropicProvider's uncovered branches. The base
// ai.test.ts covers the happy-path recommend() parse + missingAPIKey + non-2xx.
// This file targets: precise request-body construction, usage/cost mapping,
// model fallback when the response omits `model`, the empty-error-body fallback
// string, malformed/empty JSON bodies, the no-text-part -> invalidResponse
// branch, null-usage decoding, and the full analyzeTitle() delegation path
// (success, missingAPIKey, http error, no-text invalidResponse).
//
// Reuses the same FetchImpl-stub pattern as ai.test.ts: a stub that returns a
// fixed {status, text()} and captures the outgoing request.

import { describe, expect, it } from "vitest";
import type { FetchImpl } from "./types";
import { AnthropicProvider } from "./AnthropicProvider";
import type { AIAnalyzeTitleInput } from "./types";

// MARK: - fetch stub (mirrors ai.test.ts makeMockFetch)

interface MockRequest {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}

interface MockFetch {
  fetchImpl: FetchImpl;
  lastRequest: () => MockRequest | null;
  hits: () => number;
}

/** fetch stub returning a fixed status + body, capturing the request. */
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
    return { status, text: async () => body };
  };
  return {
    fetchImpl,
    lastRequest: () => captured,
    hits: () => count,
  };
}

/** A fetch stub whose text() rejects - exercises the `.catch(() => "")` path on
 * the error branch (a body read failure must degrade to the fallback message,
 * not throw the read error). */
function makeFetchTextThrows(status: number): MockFetch {
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
      text: async () => {
        throw new Error("network read failed");
      },
    };
  };
  return { fetchImpl, lastRequest: () => captured, hits: () => count };
}

function makeThrowingTextFetch(status: number): MockFetch {
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
      text: async () => {
        throw new Error("response body failed");
      },
    };
  };
  return { fetchImpl, lastRequest: () => captured, hits: () => count };
}

const analyzeInput: AIAnalyzeTitleInput = {
  title: "Arrival",
  year: 2016,
  type: "movie",
  genres: ["Sci-Fi", "Drama"],
  overview: "Linguist contacts aliens.",
  tasteContext: "Likes cerebral sci-fi.",
};

const analysisBody = JSON.stringify({
  model: "claude-haiku-4-5",
  usage: { input_tokens: 200, output_tokens: 100 },
  content: [
    {
      type: "text",
      text: JSON.stringify({
        personalizedDescription: "Right up your alley.",
        predictedRating: 9,
        verdict: "strong_yes",
        reasons: ["Cerebral", "Great direction"],
      }),
    },
  ],
});

// MARK: - recommend(): request construction

describe("AnthropicProvider.recommend request construction", () => {
  it("POSTs the messages endpoint with the trimmed key, version header, and an envelope body", async () => {
    const mock = makeMockFetch(
      200,
      JSON.stringify({
        model: "claude-haiku-4-5",
        usage: { input_tokens: 10, output_tokens: 5 },
        content: [
          {
            type: "text",
            text: '{"recommendations":[{"title":"Dune","year":2021}]}',
          },
        ],
      }),
    );
    // Key has surrounding whitespace -> must be trimmed in the header.
    const provider = new AnthropicProvider("  my-key  ", "claude-haiku-4-5", mock.fetchImpl);

    await provider.recommend("space movies", ["Dune", "Solaris"], 7);

    const req = mock.lastRequest()!;
    expect(mock.hits()).toBe(1);
    expect(req.url).toBe("https://api.anthropic.com/v1/messages");
    expect(req.method).toBe("POST");
    expect(req.headers?.["Content-Type"]).toBe("application/json");
    expect(req.headers?.["x-api-key"]).toBe("my-key");
    expect(req.headers?.["anthropic-version"]).toBe("2023-06-01");

    const parsed = JSON.parse(req.body!);
    expect(parsed.model).toBe("claude-haiku-4-5");
    expect(parsed.max_tokens).toBe(900);
    expect(parsed.messages).toHaveLength(1);
    expect(parsed.messages[0].role).toBe("user");
    // The body content is the shared prompt envelope, carrying intent + maxResults.
    expect(parsed.messages[0].content).toContain("Use this user intent: space movies");
    expect(parsed.messages[0].content).toContain("Recommend up to 7 items.");
    expect(parsed.messages[0].content).toContain("Dune, Solaris");
    // temperature is intentionally omitted.
    expect("temperature" in parsed).toBe(false);
  });

  it("defaults the model to claude-haiku-4-5 when none is supplied", async () => {
    const mock = makeMockFetch(
      200,
      JSON.stringify({
        content: [{ type: "text", text: '{"recommendations":[]}' }],
      }),
    );
    const provider = new AnthropicProvider("k", undefined, mock.fetchImpl);
    await provider.recommend("x", [], 3);
    const parsed = JSON.parse(mock.lastRequest()!.body!);
    expect(parsed.model).toBe("claude-haiku-4-5");
  });
});

// MARK: - recommend(): response parsing branches

describe("AnthropicProvider.recommend response parsing", () => {
  it("maps usage + estimated cost from the decoded response", async () => {
    const mock = makeMockFetch(
      200,
      JSON.stringify({
        model: "claude-haiku-4-5",
        usage: { input_tokens: 1000, output_tokens: 500 },
        content: [
          { type: "text", text: '{"recommendations":[{"title":"Dune","year":2021}]}' },
        ],
      }),
    );
    const provider = new AnthropicProvider("k", "claude-haiku-4-5", mock.fetchImpl);
    const result = await provider.recommend("x", [], 5);

    expect(result.usage?.inputTokens).toBe(1000);
    expect(result.usage?.outputTokens).toBe(500);
    expect(result.usage?.totalTokens).toBe(1500);
    // haiku-4-5: 1000/1M*1.0 + 500/1M*5.0 = 0.001 + 0.0025 = 0.0035
    expect(result.usage?.estimatedCostUSD).toBeCloseTo(0.0035, 10);
    expect(result.rawText).toContain("Dune");
  });

  it("falls back to the configured model when the response omits `model`", async () => {
    const mock = makeMockFetch(
      200,
      JSON.stringify({
        // no `model`
        usage: { input_tokens: 4, output_tokens: 2 },
        content: [{ type: "text", text: '{"recommendations":[{"title":"A"}]}' }],
      }),
    );
    const provider = new AnthropicProvider("k", "claude-sonnet-4-6", mock.fetchImpl);
    const result = await provider.recommend("x", [], 5);
    expect(result.model).toBe("claude-sonnet-4-6");
  });

  it("yields null token metrics and null cost when usage is absent", async () => {
    const mock = makeMockFetch(
      200,
      JSON.stringify({
        model: "claude-haiku-4-5",
        // no usage
        content: [{ type: "text", text: '{"recommendations":[{"title":"A"}]}' }],
      }),
    );
    const provider = new AnthropicProvider("k", undefined, mock.fetchImpl);
    const result = await provider.recommend("x", [], 5);
    expect(result.usage?.inputTokens).toBeNull();
    expect(result.usage?.outputTokens).toBeNull();
    // sumTokens(null, null) === 0
    expect(result.usage?.totalTokens).toBe(0);
    // estimate() returns null when both input and output are 0.
    expect(result.usage?.estimatedCostUSD).toBeNull();
  });

  it("selects the first text content-part and ignores non-text parts", async () => {
    const mock = makeMockFetch(
      200,
      JSON.stringify({
        model: "claude-haiku-4-5",
        content: [
          { type: "thinking", text: "ignored reasoning" },
          { type: "text", text: '{"recommendations":[{"title":"Picked","year":1999}]}' },
        ],
      }),
    );
    const provider = new AnthropicProvider("k", undefined, mock.fetchImpl);
    const result = await provider.recommend("x", [], 5);
    expect(result.recommendations).toHaveLength(1);
    expect(result.recommendations[0].title).toBe("Picked");
  });

  it("throws invalidResponse when there is no text content-part", async () => {
    const mock = makeMockFetch(
      200,
      JSON.stringify({
        model: "claude-haiku-4-5",
        content: [{ type: "image" }],
      }),
    );
    const provider = new AnthropicProvider("k", undefined, mock.fetchImpl);
    await expect(provider.recommend("x", [], 5)).rejects.toMatchObject({
      kind: "invalidResponse",
    });
  });

  it("throws invalidResponse when the text part is explicitly null", async () => {
    const mock = makeMockFetch(
      200,
      JSON.stringify({
        content: [{ type: "text", text: null }],
      }),
    );
    const provider = new AnthropicProvider("k", undefined, mock.fetchImpl);
    await expect(provider.recommend("x", [], 5)).rejects.toMatchObject({
      kind: "invalidResponse",
    });
  });
});

// MARK: - recommend(): error/malformed-body branches

describe("AnthropicProvider.recommend error handling", () => {
  it("includes the error body text in an apiError on a non-2xx response", async () => {
    const mock = makeMockFetch(429, "rate limited, slow down");
    const provider = new AnthropicProvider("k", undefined, mock.fetchImpl);
    await expect(provider.recommend("x", [], 5)).rejects.toMatchObject({
      kind: "apiError",
      message: "rate limited, slow down",
    });
  });

  it("falls back to 'Anthropic error' when the non-2xx body is empty", async () => {
    const mock = makeMockFetch(500, "");
    const provider = new AnthropicProvider("k", undefined, mock.fetchImpl);
    await expect(provider.recommend("x", [], 5)).rejects.toMatchObject({
      kind: "apiError",
      message: "Anthropic error",
    });
  });

  it("falls back to 'Anthropic error' when reading the error body throws", async () => {
    const mock = makeFetchTextThrows(503);
    const provider = new AnthropicProvider("k", undefined, mock.fetchImpl);
    await expect(provider.recommend("x", [], 5)).rejects.toMatchObject({
      kind: "apiError",
      message: "Anthropic error",
    });
  });

  it("treats status 199 (just below 2xx) as an error", async () => {
    const mock = makeMockFetch(199, "informational");
    const provider = new AnthropicProvider("k", undefined, mock.fetchImpl);
    await expect(provider.recommend("x", [], 5)).rejects.toMatchObject({
      kind: "apiError",
    });
  });

  it("treats status 299 (top of 2xx) as success", async () => {
    const mock = makeMockFetch(
      299,
      JSON.stringify({ content: [{ type: "text", text: '{"recommendations":[{"title":"OK"}]}' }] }),
    );
    const provider = new AnthropicProvider("k", undefined, mock.fetchImpl);
    const result = await provider.recommend("x", [], 5);
    expect(result.recommendations[0].title).toBe("OK");
  });

  it("propagates a JSON.parse error on a 2xx but non-JSON body", async () => {
    const mock = makeMockFetch(200, "not json at all <<<");
    const provider = new AnthropicProvider("k", undefined, mock.fetchImpl);
    // The provider does JSON.parse(await text()) without a try/catch on success.
    await expect(provider.recommend("x", [], 5)).rejects.toThrow(SyntaxError);
  });

  it("propagates a JSON.parse error on an empty 2xx body", async () => {
    const mock = makeMockFetch(200, "");
    const provider = new AnthropicProvider("k", undefined, mock.fetchImpl);
    await expect(provider.recommend("x", [], 5)).rejects.toThrow(SyntaxError);
  });

  it("throws missingAPIKey before any fetch when the key is whitespace", async () => {
    const mock = makeMockFetch(200, "{}");
    const provider = new AnthropicProvider("\t  \n", undefined, mock.fetchImpl);
    await expect(provider.recommend("x", [], 5)).rejects.toMatchObject({
      kind: "missingAPIKey",
    });
    // No network call should have been made.
    expect(mock.hits()).toBe(0);
  });
});

// MARK: - analyzeTitle(): delegation + branches

describe("AnthropicProvider.analyzeTitle", () => {
  it("constructs a max_tokens=700 request carrying the personalized prompt", async () => {
    const mock = makeMockFetch(200, analysisBody);
    const provider = new AnthropicProvider("  key2  ", "claude-haiku-4-5", mock.fetchImpl);

    await provider.analyzeTitle!(analyzeInput);

    const req = mock.lastRequest()!;
    expect(req.url).toBe("https://api.anthropic.com/v1/messages");
    expect(req.headers?.["x-api-key"]).toBe("key2");
    const parsed = JSON.parse(req.body!);
    expect(parsed.max_tokens).toBe(700);
    expect(parsed.messages).toHaveLength(1);
    // Prompt should mention the title and the taste-profile context.
    expect(parsed.messages[0].content).toContain("Arrival");
    expect(parsed.messages[0].content).toContain("Likes cerebral sci-fi.");
  });

  it("parses the analysis, usage, and model from a successful response", async () => {
    const mock = makeMockFetch(200, analysisBody);
    const provider = new AnthropicProvider("k", "claude-haiku-4-5", mock.fetchImpl);

    const result = await provider.analyzeTitle!(analyzeInput);

    expect(result.model).toBe("claude-haiku-4-5");
    expect(result.analysis.predictedRating).toBe(9);
    expect(result.analysis.verdict).toBe("strong_yes");
    expect(result.analysis.reasons).toEqual(["Cerebral", "Great direction"]);
    expect(result.analysis.personalizedDescription).toBe("Right up your alley.");
    expect(result.usage?.inputTokens).toBe(200);
    expect(result.usage?.outputTokens).toBe(100);
    expect(result.usage?.totalTokens).toBe(300);
    // haiku-4-5: 200/1M*1.0 + 100/1M*5.0 = 0.0002 + 0.0005 = 0.0007
    expect(result.usage?.estimatedCostUSD).toBeCloseTo(0.0007, 10);
    expect(result.rawText).toContain("strong_yes");
  });

  it("falls back to the configured model when analysis response omits `model`", async () => {
    const mock = makeMockFetch(
      200,
      JSON.stringify({
        content: [
          {
            type: "text",
            text: '{"personalizedDescription":"ok","predictedRating":6,"verdict":"maybe","reasons":[]}',
          },
        ],
      }),
    );
    const provider = new AnthropicProvider("k", "claude-opus-4-8", mock.fetchImpl);
    const result = await provider.analyzeTitle!(analyzeInput);
    expect(result.model).toBe("claude-opus-4-8");
    // No usage -> null tokens and null cost.
    expect(result.usage?.totalTokens).toBe(0);
    expect(result.usage?.estimatedCostUSD).toBeNull();
  });

  it("throws missingAPIKey (no fetch) when the key is blank", async () => {
    const mock = makeMockFetch(200, analysisBody);
    const provider = new AnthropicProvider("   ", undefined, mock.fetchImpl);
    await expect(provider.analyzeTitle!(analyzeInput)).rejects.toMatchObject({
      kind: "missingAPIKey",
    });
    expect(mock.hits()).toBe(0);
  });

  it("maps a non-2xx analysis response to an apiError with the body", async () => {
    const mock = makeMockFetch(401, "invalid api key");
    const provider = new AnthropicProvider("k", undefined, mock.fetchImpl);
    await expect(provider.analyzeTitle!(analyzeInput)).rejects.toMatchObject({
      kind: "apiError",
      message: "invalid api key",
    });
  });

  it("falls back to 'Anthropic error' on an empty non-2xx analysis body", async () => {
    const mock = makeMockFetch(500, "");
    const provider = new AnthropicProvider("k", undefined, mock.fetchImpl);
    await expect(provider.analyzeTitle!(analyzeInput)).rejects.toMatchObject({
      kind: "apiError",
      message: "Anthropic error",
    });
  });

  it("falls back to 'Anthropic error' when reading a non-2xx analysis body throws", async () => {
    const mock = makeThrowingTextFetch(502);
    const provider = new AnthropicProvider("k", undefined, mock.fetchImpl);

    await expect(provider.analyzeTitle!(analyzeInput)).rejects.toMatchObject({
      kind: "apiError",
      message: "Anthropic error",
    });
  });

  it("throws invalidResponse when the analysis response has no text part", async () => {
    const mock = makeMockFetch(
      200,
      JSON.stringify({ model: "claude-haiku-4-5", content: [{ type: "image" }] }),
    );
    const provider = new AnthropicProvider("k", undefined, mock.fetchImpl);
    await expect(provider.analyzeTitle!(analyzeInput)).rejects.toMatchObject({
      kind: "invalidResponse",
    });
  });

  it("propagates a JSON.parse error on a malformed 2xx analysis body", async () => {
    const mock = makeMockFetch(200, "<<<not json>>>");
    const provider = new AnthropicProvider("k", undefined, mock.fetchImpl);
    await expect(provider.analyzeTitle!(analyzeInput)).rejects.toThrow(SyntaxError);
  });

  it("defaults rating to 5 / verdict to maybe when the model returns junk analysis text", async () => {
    // A valid text part whose content is not analysis-shaped JSON -> the
    // tolerant parser supplies safe defaults rather than throwing.
    const mock = makeMockFetch(
      200,
      JSON.stringify({
        model: "claude-haiku-4-5",
        content: [{ type: "text", text: "I cannot help with that." }],
      }),
    );
    const provider = new AnthropicProvider("k", undefined, mock.fetchImpl);
    const result = await provider.analyzeTitle!(analyzeInput);
    expect(result.analysis.predictedRating).toBe(5);
    expect(result.analysis.verdict).toBe("maybe");
    expect(result.analysis.reasons).toEqual([]);
    expect(result.analysis.personalizedDescription).toBe("");
  });
});
