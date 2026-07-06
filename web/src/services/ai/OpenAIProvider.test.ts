// Focused coverage for OpenAIProvider beyond the happy-path case already in
// ai.test.ts. Exercises request construction, key trimming, the non-2xx ->
// apiError mapping (with and without a body), malformed JSON bodies, the
// `choices[0].message.content` null guard (missing choices / empty array /
// missing message), model/usage fallbacks, empty-string content passthrough,
// and the parallel `analyzeTitle` code path.

import { describe, expect, it } from "vitest";
import {
  AIAssistantProviderError,
  type AIAnalyzeTitleInput,
  type FetchImpl,
} from "./types";
import { OpenAIProvider } from "./OpenAIProvider";

const OPENAI_URL = "https://api.openai.com/v1/chat/completions";

// MARK: - fetch stub (mirrors the one in ai.test.ts, plus a text() override)

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

/** A fetch stub whose `text()` rejects — mirrors a network/stream read failure
 * after a non-2xx status, exercising the `.catch(() => "")` branch. */
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
        throw new Error("stream read failed");
      },
    };
  };
  return { fetchImpl, lastRequest: () => captured, hits: () => count };
}

/** A successful OpenAI chat-completion body with a JSON recommendations payload. */
function okBody(
  content = '{"recommendations":[{"title":"Dune","year":2021,"reason":"Sci-fi epic","score":0.9}]}',
  opts: {
    model?: string | null | undefined;
    usage?: Record<string, unknown> | null;
    omitModel?: boolean;
    omitUsage?: boolean;
  } = {},
): string {
  const obj: Record<string, unknown> = {
    choices: [{ message: { content } }],
  };
  if (!opts.omitModel) {
    // Distinguish "caller passed null" from "caller passed nothing".
    obj.model = "model" in opts ? opts.model : "gpt-4.1-mini";
  }
  if (!opts.omitUsage) {
    obj.usage =
      opts.usage ?? {
        prompt_tokens: 120,
        completion_tokens: 80,
        total_tokens: 200,
      };
  }
  return JSON.stringify(obj);
}

const analyzeInput: AIAnalyzeTitleInput = {
  title: "Dune",
  year: 2021,
  type: "movie",
  genres: ["Sci-Fi"],
  overview: "A noble family is drawn into a war.",
  tasteContext: "Loves cerebral sci-fi.",
};

const analysisBody = JSON.stringify({
  model: "gpt-4o-mini",
  usage: { prompt_tokens: 50, completion_tokens: 30, total_tokens: 80 },
  choices: [
    {
      message: {
        content:
          '{"personalizedDescription":"Right up your alley.","predictedRating":9,"verdict":"strong_yes","reasons":["Cerebral","Epic scope"]}',
      },
    },
  ],
});

// MARK: - recommend(): request construction

describe("OpenAIProvider.recommend request building", () => {
  it("POSTs to the chat-completions endpoint with the expected headers and body", async () => {
    const mock = makeMockFetch(200, okBody());
    const provider = new OpenAIProvider("test-key", "gpt-4o-mini", mock.fetchImpl);

    await provider.recommend("Sci-fi recommendations", ["Alien", "Arrival"], 4);

    const req = mock.lastRequest()!;
    expect(req.url).toBe(OPENAI_URL);
    expect(req.method).toBe("POST");
    expect(req.headers?.["Content-Type"]).toBe("application/json");
    expect(req.headers?.Authorization).toBe("Bearer test-key");

    const payload = JSON.parse(req.body!);
    expect(payload.model).toBe("gpt-4o-mini");
    expect(payload.temperature).toBe(0.4);
    expect(payload.messages).toHaveLength(2);
    expect(payload.messages[0].role).toBe("system");
    expect(payload.messages[0].content).toBe(
      "You produce concise recommendations in JSON.",
    );
    expect(payload.messages[1].role).toBe("user");
    // The user message carries the shared prompt envelope.
    expect(payload.messages[1].content).toContain(
      "You are a movie recommendation assistant.",
    );
    expect(payload.messages[1].content).toContain("Recommend up to 4 items.");
    expect(payload.messages[1].content).toContain("Sci-fi recommendations");
    expect(payload.messages[1].content).toContain("Alien, Arrival");
  });

  it("trims surrounding whitespace from the API key in the Authorization header", async () => {
    const mock = makeMockFetch(200, okBody());
    const provider = new OpenAIProvider("  test-key  ", undefined, mock.fetchImpl);

    await provider.recommend("anything", [], 5);

    expect(mock.lastRequest()!.headers?.Authorization).toBe("Bearer test-key");
  });

  it("defaults the model to gpt-4o-mini when none is supplied", async () => {
    const mock = makeMockFetch(200, okBody());
    const provider = new OpenAIProvider("test-key", undefined, mock.fetchImpl);

    await provider.recommend("anything", [], 5);

    expect(JSON.parse(mock.lastRequest()!.body!).model).toBe("gpt-4o-mini");
  });
});

// MARK: - recommend(): missing key (fails before any fetch)

describe("OpenAIProvider.recommend missing key", () => {
  it("throws missingAPIKey for an empty key without calling fetch", async () => {
    const mock = makeMockFetch(200, okBody());
    const provider = new OpenAIProvider("", undefined, mock.fetchImpl);

    await expect(provider.recommend("anything", [], 3)).rejects.toMatchObject({
      kind: "missingAPIKey",
    });
    expect(mock.hits()).toBe(0);
  });

  it("throws missingAPIKey for a whitespace-only key", async () => {
    const mock = makeMockFetch(200, okBody());
    const provider = new OpenAIProvider("   \t  ", undefined, mock.fetchImpl);

    await expect(provider.recommend("anything", [], 3)).rejects.toMatchObject({
      kind: "missingAPIKey",
    });
    expect(mock.hits()).toBe(0);
  });
});

// MARK: - recommend(): success parse, model + usage fallbacks

describe("OpenAIProvider.recommend success parsing", () => {
  it("parses recommendations, model, raw text, and usage from a 2xx body", async () => {
    const mock = makeMockFetch(200, okBody());
    const provider = new OpenAIProvider("test-key", undefined, mock.fetchImpl);

    const result = await provider.recommend("Sci-fi", [], 5);

    expect(result.model).toBe("gpt-4.1-mini");
    expect(result.recommendations).toHaveLength(1);
    expect(result.recommendations[0].title).toBe("Dune");
    expect(result.recommendations[0].year).toBe(2021);
    expect(result.rawText).toContain("Dune");
    expect(result.usage?.inputTokens).toBe(120);
    expect(result.usage?.outputTokens).toBe(80);
    expect(result.usage?.totalTokens).toBe(200);
    expect(result.usage?.estimatedCostUSD).not.toBeNull();
    expect(result.usage!.estimatedCostUSD!).toBeGreaterThan(0);
  });

  it("falls back to the constructor model when the response omits `model`", async () => {
    const mock = makeMockFetch(200, okBody(undefined, { omitModel: true }));
    const provider = new OpenAIProvider("test-key", "gpt-4o", mock.fetchImpl);

    const result = await provider.recommend("Sci-fi", [], 5);

    expect(result.model).toBe("gpt-4o");
  });

  it("falls back to the constructor model when `model` is explicitly null", async () => {
    const mock = makeMockFetch(200, okBody(undefined, { model: null }));
    const provider = new OpenAIProvider("test-key", "gpt-4o", mock.fetchImpl);

    const result = await provider.recommend("Sci-fi", [], 5);

    expect(result.model).toBe("gpt-4o");
  });

  it("yields null token counts and null cost when usage is absent", async () => {
    const mock = makeMockFetch(200, okBody(undefined, { omitUsage: true }));
    const provider = new OpenAIProvider("test-key", undefined, mock.fetchImpl);

    const result = await provider.recommend("Sci-fi", [], 5);

    expect(result.usage?.inputTokens).toBeNull();
    expect(result.usage?.outputTokens).toBeNull();
    expect(result.usage?.totalTokens).toBeNull();
    // No tokens to price -> estimator returns null.
    expect(result.usage?.estimatedCostUSD).toBeNull();
  });

  it("treats null usage fields as null token counts", async () => {
    const mock = makeMockFetch(
      200,
      okBody(undefined, {
        usage: {
          prompt_tokens: null,
          completion_tokens: null,
          total_tokens: null,
        },
      }),
    );
    const provider = new OpenAIProvider("test-key", undefined, mock.fetchImpl);

    const result = await provider.recommend("Sci-fi", [], 5);

    expect(result.usage?.inputTokens).toBeNull();
    expect(result.usage?.outputTokens).toBeNull();
    expect(result.usage?.totalTokens).toBeNull();
  });

  it("respects maxResults when the body returns more items", async () => {
    const content = JSON.stringify({
      recommendations: [
        { title: "A", year: 2000 },
        { title: "B", year: 2001 },
        { title: "C", year: 2002 },
      ],
    });
    const mock = makeMockFetch(200, okBody(content));
    const provider = new OpenAIProvider("test-key", undefined, mock.fetchImpl);

    const result = await provider.recommend("Sci-fi", [], 2);

    expect(result.recommendations.map((r) => r.title)).toEqual(["A", "B"]);
  });
});

// MARK: - recommend(): HTTP error mapping

describe("OpenAIProvider.recommend HTTP errors", () => {
  it("maps a non-2xx response to apiError carrying the response body", async () => {
    const mock = makeMockFetch(401, '{"error":"invalid api key"}');
    const provider = new OpenAIProvider("test-key", undefined, mock.fetchImpl);

    await expect(provider.recommend("Sci-fi", [], 5)).rejects.toMatchObject({
      kind: "apiError",
      message: '{"error":"invalid api key"}',
    });
  });

  it("uses the 'OpenAI error' placeholder when the error body is empty", async () => {
    const mock = makeMockFetch(500, "");
    const provider = new OpenAIProvider("test-key", undefined, mock.fetchImpl);

    await expect(provider.recommend("Sci-fi", [], 5)).rejects.toMatchObject({
      kind: "apiError",
      message: "OpenAI error",
    });
  });

  it("uses the placeholder when reading the error body throws", async () => {
    const mock = makeThrowingTextFetch(503);
    const provider = new OpenAIProvider("test-key", undefined, mock.fetchImpl);

    await expect(provider.recommend("Sci-fi", [], 5)).rejects.toMatchObject({
      kind: "apiError",
      message: "OpenAI error",
    });
  });

  it("treats status 199 (just below 200) as an error", async () => {
    const mock = makeMockFetch(199, "too early");
    const provider = new OpenAIProvider("test-key", undefined, mock.fetchImpl);

    await expect(provider.recommend("Sci-fi", [], 5)).rejects.toMatchObject({
      kind: "apiError",
      message: "too early",
    });
  });

  it("treats status 299 as success (inclusive upper bound)", async () => {
    const mock = makeMockFetch(299, okBody());
    const provider = new OpenAIProvider("test-key", undefined, mock.fetchImpl);

    const result = await provider.recommend("Sci-fi", [], 5);

    expect(result.recommendations[0].title).toBe("Dune");
  });

  it("treats status 300 as an error (just above the 2xx range)", async () => {
    const mock = makeMockFetch(300, "redirect");
    const provider = new OpenAIProvider("test-key", undefined, mock.fetchImpl);

    await expect(provider.recommend("Sci-fi", [], 5)).rejects.toMatchObject({
      kind: "apiError",
      message: "redirect",
    });
  });
});

// MARK: - recommend(): malformed / missing-content bodies

describe("OpenAIProvider.recommend malformed bodies", () => {
  it("propagates a SyntaxError (not an AIAssistantProviderError) for non-JSON bodies", async () => {
    const mock = makeMockFetch(200, "not json at all");
    const provider = new OpenAIProvider("test-key", undefined, mock.fetchImpl);

    // The provider does a bare JSON.parse on a 2xx body, so a malformed body
    // surfaces as the raw parse error rather than a typed provider error.
    await expect(provider.recommend("Sci-fi", [], 5)).rejects.toThrow(SyntaxError);
  });

  it("throws on an empty 2xx body (empty string is not valid JSON)", async () => {
    const mock = makeMockFetch(200, "");
    const provider = new OpenAIProvider("test-key", undefined, mock.fetchImpl);

    await expect(provider.recommend("Sci-fi", [], 5)).rejects.toThrow(SyntaxError);
  });

  it("throws invalidResponse when `choices` is missing", async () => {
    const mock = makeMockFetch(200, JSON.stringify({ model: "gpt-4o-mini" }));
    const provider = new OpenAIProvider("test-key", undefined, mock.fetchImpl);

    await expect(provider.recommend("Sci-fi", [], 5)).rejects.toMatchObject({
      kind: "invalidResponse",
    });
  });

  it("throws invalidResponse when `choices` is an empty array", async () => {
    const mock = makeMockFetch(200, JSON.stringify({ choices: [] }));
    const provider = new OpenAIProvider("test-key", undefined, mock.fetchImpl);

    await expect(provider.recommend("Sci-fi", [], 5)).rejects.toMatchObject({
      kind: "invalidResponse",
    });
  });

  it("throws invalidResponse when the first choice has no message", async () => {
    const mock = makeMockFetch(200, JSON.stringify({ choices: [{}] }));
    const provider = new OpenAIProvider("test-key", undefined, mock.fetchImpl);

    await expect(provider.recommend("Sci-fi", [], 5)).rejects.toMatchObject({
      kind: "invalidResponse",
    });
  });

  it("throws invalidResponse when choices[0].message.content is null", async () => {
    const mock = makeMockFetch(
      200,
      JSON.stringify({ choices: [{ message: { content: null } }] }),
    );
    const provider = new OpenAIProvider("test-key", undefined, mock.fetchImpl);

    await expect(provider.recommend("Sci-fi", [], 5)).rejects.toMatchObject({
      kind: "invalidResponse",
    });
  });

  it("does NOT throw for empty-string content — it parses to zero recommendations", async () => {
    // "" is not null, so the content null-guard passes and the JSON parser runs
    // on an empty string, which yields no recommendations.
    const mock = makeMockFetch(200, okBody(""));
    const provider = new OpenAIProvider("test-key", undefined, mock.fetchImpl);

    const result = await provider.recommend("Sci-fi", [], 5);

    expect(result.recommendations).toEqual([]);
    expect(result.rawText).toBe("");
  });
});

// MARK: - analyzeTitle(): parallel path

describe("OpenAIProvider.analyzeTitle", () => {
  it("builds a strict-JSON system prompt and parses the analysis payload", async () => {
    const mock = makeMockFetch(200, analysisBody);
    const provider = new OpenAIProvider("test-key", "gpt-4o-mini", mock.fetchImpl);

    const result = await provider.analyzeTitle(analyzeInput);

    const req = mock.lastRequest()!;
    expect(req.url).toBe(OPENAI_URL);
    expect(req.headers?.Authorization).toBe("Bearer test-key");
    const payload = JSON.parse(req.body!);
    expect(payload.temperature).toBe(0.4);
    expect(payload.messages[0].role).toBe("system");
    expect(payload.messages[0].content).toBe(
      "You produce a single, strict JSON object analyzing a title for the user.",
    );
    expect(payload.messages[1].content).toContain("Title: Dune (2021)");

    expect(result.model).toBe("gpt-4o-mini");
    expect(result.analysis.predictedRating).toBe(9);
    expect(result.analysis.verdict).toBe("strong_yes");
    expect(result.analysis.reasons).toEqual(["Cerebral", "Epic scope"]);
    expect(result.usage?.totalTokens).toBe(80);
  });

  it("throws missingAPIKey before fetching when the key is blank", async () => {
    const mock = makeMockFetch(200, analysisBody);
    const provider = new OpenAIProvider("  ", undefined, mock.fetchImpl);

    await expect(provider.analyzeTitle(analyzeInput)).rejects.toMatchObject({
      kind: "missingAPIKey",
    });
    expect(mock.hits()).toBe(0);
  });

  it("maps a non-2xx response to apiError", async () => {
    const mock = makeMockFetch(429, "rate limited");
    const provider = new OpenAIProvider("test-key", undefined, mock.fetchImpl);

    await expect(provider.analyzeTitle(analyzeInput)).rejects.toMatchObject({
      kind: "apiError",
      message: "rate limited",
    });
  });

  it("falls back to 'OpenAI error' for an empty non-2xx analyze response body", async () => {
    const mock = makeMockFetch(500, "");
    const provider = new OpenAIProvider("test-key", undefined, mock.fetchImpl);

    await expect(provider.analyzeTitle(analyzeInput)).rejects.toMatchObject({
      kind: "apiError",
      message: "OpenAI error",
    });
  });

  it("falls back to 'OpenAI error' when analyze-title error body reading fails", async () => {
    const mock = makeThrowingTextFetch(502);
    const provider = new OpenAIProvider("test-key", undefined, mock.fetchImpl);

    await expect(provider.analyzeTitle(analyzeInput)).rejects.toMatchObject({
      kind: "apiError",
      message: "OpenAI error",
    });
  });

  it("throws invalidResponse when content is missing", async () => {
    const mock = makeMockFetch(200, JSON.stringify({ choices: [] }));
    const provider = new OpenAIProvider("test-key", undefined, mock.fetchImpl);

    await expect(provider.analyzeTitle(analyzeInput)).rejects.toMatchObject({
      kind: "invalidResponse",
    });
  });

  it("falls back to a safe 'maybe' analysis when content is non-JSON garbage", async () => {
    // The analysis parser is tolerant: it returns defaults rather than throwing.
    const mock = makeMockFetch(
      200,
      JSON.stringify({ choices: [{ message: { content: "totally not json" } }] }),
    );
    const provider = new OpenAIProvider("test-key", undefined, mock.fetchImpl);

    const result = await provider.analyzeTitle(analyzeInput);

    expect(result.analysis.verdict).toBe("maybe");
    expect(result.analysis.predictedRating).toBe(5);
    expect(result.analysis.reasons).toEqual([]);
    expect(result.analysis.personalizedDescription).toBe("");
  });

  it("propagates a SyntaxError for a malformed (non-JSON) HTTP body", async () => {
    const mock = makeMockFetch(200, "<<not json>>");
    const provider = new OpenAIProvider("test-key", undefined, mock.fetchImpl);

    await expect(provider.analyzeTitle(analyzeInput)).rejects.toThrow(SyntaxError);
  });
});

// MARK: - error type identity

describe("OpenAIProvider error identity", () => {
  it("rejects with an AIAssistantProviderError instance for the API-key guard", async () => {
    const provider = new OpenAIProvider("");
    await expect(provider.recommend("x", [], 1)).rejects.toBeInstanceOf(
      AIAssistantProviderError,
    );
  });
});
