// Focused tests for OllamaProvider - covers the untested paths the shared
// ai.test.ts skips: request body shape (endpoint/model/messages/stream), the
// custom-model constructor arg, analyzeTitle success, HTTP non-2xx mapping
// (with body + empty-body fallback), malformed JSON bodies, and the
// null/missing `message.content` -> invalidResponse branch.
//
// Network is stubbed via an injected FetchImpl (same pattern as ai.test.ts).

import { describe, expect, it } from "vitest";
import { type FetchImpl } from "./types";
import { OllamaProvider } from "./OllamaProvider";

const ENDPOINT = "http://localhost:11434/api/chat";

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
    return { status, text: async () => body };
  };
  return {
    fetchImpl,
    lastRequest: () => captured,
    hits: () => count,
  };
}

/** A fetch stub whose text() rejects - exercises the `.catch(() => "")`
 * fallback on the error path. */
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
        throw new Error("body read failed");
      },
    };
  };
  return { fetchImpl, lastRequest: () => captured, hits: () => count };
}

const recommendBody = JSON.stringify({
  message: {
    role: "assistant",
    content:
      '{"recommendations":[{"title":"Blade Runner 2049","year":2017,"reason":"Atmospheric sci-fi","score":0.93}]}',
  },
});

const analysisBody = JSON.stringify({
  message: {
    role: "assistant",
    content:
      '{"personalizedDescription":"You will like the moody visuals.","predictedRating":8,"verdict":"yes","reasons":["Strong direction","Great score"]}',
  },
});

describe("OllamaProvider.recommend - request build", () => {
  it("POSTs to the supplied endpoint with the default model, JSON content-type, no auth, and stream:false", async () => {
    const mock = makeMockFetch(200, recommendBody);
    const provider = new OllamaProvider(ENDPOINT, undefined, mock.fetchImpl);

    await provider.recommend("Recommend me sci-fi", ["Dune", "Arrival"], 5);

    const req = mock.lastRequest()!;
    expect(mock.hits()).toBe(1);
    expect(req.url).toBe(ENDPOINT);
    expect(req.method).toBe("POST");
    expect(req.headers?.["Content-Type"]).toBe("application/json");
    // Local model -> no Authorization / api-key headers of any kind.
    expect(req.headers?.Authorization).toBeUndefined();
    expect(req.headers?.["x-api-key"]).toBeUndefined();

    const sent = JSON.parse(req.body!);
    expect(sent.model).toBe("llama3.1:8b");
    expect(sent.stream).toBe(false);
    expect(sent.messages).toHaveLength(1);
    expect(sent.messages[0].role).toBe("user");
    // The single user message carries the envelope built from the prompt.
    expect(typeof sent.messages[0].content).toBe("string");
    expect(sent.messages[0].content).toContain("Recommend me sci-fi");
  });

  it("uses a caller-supplied custom model in both the request body and the result", async () => {
    const mock = makeMockFetch(200, recommendBody);
    const provider = new OllamaProvider(ENDPOINT, "qwen2.5:14b", mock.fetchImpl);

    const result = await provider.recommend("Sci-fi", [], 3);

    const sent = JSON.parse(mock.lastRequest()!.body!);
    expect(sent.model).toBe("qwen2.5:14b");
    expect(result.model).toBe("qwen2.5:14b");
  });
});

describe("OllamaProvider.recommend - success parse", () => {
  it("parses recommendations and fills heuristic usage with zero cost", async () => {
    const mock = makeMockFetch(200, recommendBody);
    const provider = new OllamaProvider(ENDPOINT, undefined, mock.fetchImpl);

    const result = await provider.recommend("Recommend me sci-fi", [], 5);

    expect(result.recommendations).toHaveLength(1);
    expect(result.recommendations[0].title).toBe("Blade Runner 2049");
    expect(result.recommendations[0].year).toBe(2017);
    expect(result.rawText).toContain("Blade Runner 2049");
    expect(result.model).toBe("llama3.1:8b");

    // Heuristic usage: both halves > 0, total is their sum, cost always 0.
    const usage = result.usage!;
    const inTok = usage.inputTokens ?? 0;
    const outTok = usage.outputTokens ?? 0;
    expect(inTok).toBeGreaterThan(0);
    expect(outTok).toBeGreaterThan(0);
    expect(usage.totalTokens).toBe(inTok + outTok);
    expect(usage.estimatedCostUSD).toBe(0);
  });
});

describe("OllamaProvider.recommend - error / bad-response paths", () => {
  it("maps a non-2xx response to an apiError carrying the body text", async () => {
    const mock = makeMockFetch(500, "model not found");
    const provider = new OllamaProvider(ENDPOINT, undefined, mock.fetchImpl);

    await expect(provider.recommend("Sci-fi", [], 5)).rejects.toMatchObject({
      kind: "apiError",
      message: "model not found",
    });
  });

  it("falls back to 'Ollama error' when the error body is empty", async () => {
    const mock = makeMockFetch(503, "");
    const provider = new OllamaProvider(ENDPOINT, undefined, mock.fetchImpl);

    await expect(provider.recommend("Sci-fi", [], 5)).rejects.toMatchObject({
      kind: "apiError",
      message: "Ollama error",
    });
  });

  it("falls back to 'Ollama error' when reading the error body throws", async () => {
    const mock = makeThrowingTextFetch(404);
    const provider = new OllamaProvider(ENDPOINT, undefined, mock.fetchImpl);

    await expect(provider.recommend("Sci-fi", [], 5)).rejects.toMatchObject({
      kind: "apiError",
      message: "Ollama error",
    });
  });

  it("treats status 199 (just below 200) as a non-2xx error", async () => {
    const mock = makeMockFetch(199, "too early");
    const provider = new OllamaProvider(ENDPOINT, undefined, mock.fetchImpl);

    await expect(provider.recommend("Sci-fi", [], 5)).rejects.toMatchObject({
      kind: "apiError",
    });
  });

  it("treats status 300 (just above 299) as a non-2xx error", async () => {
    const mock = makeMockFetch(300, "redirect");
    const provider = new OllamaProvider(ENDPOINT, undefined, mock.fetchImpl);

    await expect(provider.recommend("Sci-fi", [], 5)).rejects.toMatchObject({
      kind: "apiError",
    });
  });

  it("propagates a SyntaxError when the 2xx body is not valid JSON", async () => {
    const mock = makeMockFetch(200, "not json at all");
    const provider = new OllamaProvider(ENDPOINT, undefined, mock.fetchImpl);

    // The provider does JSON.parse(text) directly with no guard.
    await expect(provider.recommend("Sci-fi", [], 5)).rejects.toThrow(
      SyntaxError,
    );
  });

  it("throws invalidResponse when the JSON has no `message` object", async () => {
    const mock = makeMockFetch(200, JSON.stringify({ done: true }));
    const provider = new OllamaProvider(ENDPOINT, undefined, mock.fetchImpl);

    await expect(provider.recommend("Sci-fi", [], 5)).rejects.toMatchObject({
      kind: "invalidResponse",
    });
  });

  it("throws invalidResponse when `message` is explicitly null", async () => {
    const mock = makeMockFetch(200, JSON.stringify({ message: null }));
    const provider = new OllamaProvider(ENDPOINT, undefined, mock.fetchImpl);

    await expect(provider.recommend("Sci-fi", [], 5)).rejects.toMatchObject({
      kind: "invalidResponse",
    });
  });
});

describe("OllamaProvider.analyzeTitle", () => {
  const input = {
    title: "Blade Runner 2049",
    year: 2017,
    type: "movie" as const,
    genres: ["Sci-Fi", "Drama"],
    overview: "A young blade runner uncovers a long-buried secret.",
    tasteContext: "Loves atmospheric, slow-burn sci-fi.",
  };

  it("builds the personalized prompt request and parses the analysis", async () => {
    const mock = makeMockFetch(200, analysisBody);
    const provider = new OllamaProvider(ENDPOINT, undefined, mock.fetchImpl);

    const result = await provider.analyzeTitle(input);

    const sent = JSON.parse(mock.lastRequest()!.body!);
    expect(sent.model).toBe("llama3.1:8b");
    expect(sent.stream).toBe(false);
    expect(sent.messages[0].role).toBe("user");
    expect(sent.messages[0].content).toContain("Blade Runner 2049");
    expect(sent.messages[0].content).toContain("atmospheric, slow-burn sci-fi");

    expect(result.analysis.verdict).toBe("yes");
    expect(result.analysis.predictedRating).toBe(8);
    expect(result.analysis.reasons).toEqual(["Strong direction", "Great score"]);
    expect(result.analysis.personalizedDescription).toBe(
      "You will like the moody visuals.",
    );
    expect(result.model).toBe("llama3.1:8b");
    expect(result.usage?.estimatedCostUSD).toBe(0);
    expect(result.usage?.totalTokens).toBeGreaterThan(0);
  });

  it("maps a non-2xx response to apiError", async () => {
    const mock = makeMockFetch(500, "boom");
    const provider = new OllamaProvider(ENDPOINT, undefined, mock.fetchImpl);

    await expect(provider.analyzeTitle(input)).rejects.toMatchObject({
      kind: "apiError",
      message: "boom",
    });
  });

  it("falls back to 'Ollama error' for an empty analyze 2xx error response", async () => {
    const mock = makeMockFetch(500, "");
    const provider = new OllamaProvider(ENDPOINT, undefined, mock.fetchImpl);

    await expect(provider.analyzeTitle(input)).rejects.toMatchObject({
      kind: "apiError",
      message: "Ollama error",
    });
  });

  it("falls back to 'Ollama error' when analyze-title error body reading fails", async () => {
    const mock = makeThrowingTextFetch(503);
    const provider = new OllamaProvider(ENDPOINT, undefined, mock.fetchImpl);

    await expect(provider.analyzeTitle(input)).rejects.toMatchObject({
      kind: "apiError",
      message: "Ollama error",
    });
  });

  it("throws invalidResponse when content is missing", async () => {
    const mock = makeMockFetch(200, JSON.stringify({ message: { role: "assistant" } }));
    const provider = new OllamaProvider(ENDPOINT, undefined, mock.fetchImpl);

    await expect(provider.analyzeTitle(input)).rejects.toMatchObject({
      kind: "invalidResponse",
    });
  });

  it("defaults to a safe 'maybe' analysis when the model returns non-analysis JSON", async () => {
    // Valid JSON object, but none of the analysis keys -> parser supplies
    // defaults: verdict 'maybe', rating 5, empty reasons/description.
    const mock = makeMockFetch(
      200,
      JSON.stringify({ message: { content: '{"unrelated":true}' } }),
    );
    const provider = new OllamaProvider(ENDPOINT, undefined, mock.fetchImpl);

    const result = await provider.analyzeTitle(input);
    expect(result.analysis.verdict).toBe("maybe");
    expect(result.analysis.predictedRating).toBe(5);
    expect(result.analysis.reasons).toEqual([]);
    expect(result.analysis.personalizedDescription).toBe("");
  });
});
