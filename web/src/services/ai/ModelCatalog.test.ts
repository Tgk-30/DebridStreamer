// Coverage for fetchAvailableModels: the three endpoint shapes (OpenAI-compatible
// /models, Anthropic /v1/models, Ollama /api/tags), request construction (URL +
// auth headers per provider), the tidy() sort/de-dupe/blank-drop, the
// missing-credential guards, and non-2xx -> Error mapping.

import { describe, expect, it } from "vitest";
import type { FetchImpl } from "./types";
import { fetchAvailableModels } from "./ModelCatalog";

interface MockRequest {
  url: string;
  method?: string;
  headers?: Record<string, string>;
}

function makeMockFetch(status: number, body: string) {
  let captured: MockRequest | null = null;
  const fetchImpl: FetchImpl = async (url, init) => {
    captured = { url, method: init?.method, headers: init?.headers as Record<string, string> };
    return { status, text: async () => body };
  };
  return { fetchImpl, lastRequest: () => captured };
}

const OPENAI_MODELS = JSON.stringify({
  data: [{ id: "gpt-4o" }, { id: "gpt-4o-mini" }, { id: "gpt-4o" }, { id: "" }, { id: "o1" }],
});

describe("fetchAvailableModels - OpenAI-compatible", () => {
  it("GETs {baseURL}/models with Bearer auth and tidies the ids", async () => {
    const mock = makeMockFetch(200, OPENAI_MODELS);
    const models = await fetchAvailableModels({
      kind: "groq",
      apiKey: "  gsk_123  ",
      fetchImpl: mock.fetchImpl,
    });
    const req = mock.lastRequest()!;
    expect(req.url).toBe("https://api.groq.com/openai/v1/models");
    expect(req.method).toBe("GET");
    expect(req.headers?.Authorization).toBe("Bearer gsk_123");
    // sorted, de-duped, blanks dropped
    expect(models).toEqual(["gpt-4o", "gpt-4o-mini", "o1"]);
  });

  it("targets the right base URL for each compatible host", async () => {
    const cases: Array<[Parameters<typeof fetchAvailableModels>[0]["kind"], string]> = [
      ["openai", "https://api.openai.com/v1/models"],
      ["gemini", "https://generativelanguage.googleapis.com/v1beta/openai/models"],
      ["openrouter", "https://openrouter.ai/api/v1/models"],
      ["mistral", "https://api.mistral.ai/v1/models"],
      ["deepseek", "https://api.deepseek.com/v1/models"],
      ["xai", "https://api.x.ai/v1/models"],
    ];
    for (const [kind, url] of cases) {
      const mock = makeMockFetch(200, '{"data":[]}');
      await fetchAvailableModels({ kind, apiKey: "k", fetchImpl: mock.fetchImpl });
      expect(mock.lastRequest()!.url).toBe(url);
    }
  });

  it("rejects when the API key is blank", async () => {
    const mock = makeMockFetch(200, OPENAI_MODELS);
    await expect(
      fetchAvailableModels({ kind: "openai", apiKey: "   ", fetchImpl: mock.fetchImpl }),
    ).rejects.toThrow(/API key/i);
  });

  it("maps a non-2xx response to an Error with the body", async () => {
    const mock = makeMockFetch(401, "invalid api key");
    await expect(
      fetchAvailableModels({ kind: "openai", apiKey: "bad", fetchImpl: mock.fetchImpl }),
    ).rejects.toThrow(/invalid api key/);
  });

  it("drops non-chat models (whisper / tts / embeddings / image)", async () => {
    const mock = makeMockFetch(
      200,
      JSON.stringify({
        data: [
          { id: "llama-3.3-70b-versatile" },
          { id: "whisper-large-v3" },
          { id: "playai-tts" },
          { id: "text-embedding-3-small" },
          { id: "dall-e-3" },
          { id: "llama-guard-3-8b" },
        ],
      }),
    );
    const models = await fetchAvailableModels({
      kind: "groq",
      apiKey: "k",
      fetchImpl: mock.fetchImpl,
    });
    expect(models).toEqual(["llama-3.3-70b-versatile"]);
  });
});

describe("fetchAvailableModels - Anthropic", () => {
  it("GETs /v1/models with x-api-key + version header", async () => {
    const mock = makeMockFetch(
      200,
      JSON.stringify({ data: [{ id: "claude-sonnet-4-5" }, { id: "claude-haiku-4-5" }] }),
    );
    const models = await fetchAvailableModels({
      kind: "anthropic",
      apiKey: "sk-ant",
      fetchImpl: mock.fetchImpl,
    });
    const req = mock.lastRequest()!;
    expect(req.url).toContain("https://api.anthropic.com/v1/models");
    expect(req.headers?.["x-api-key"]).toBe("sk-ant");
    expect(req.headers?.["anthropic-version"]).toBe("2023-06-01");
    expect(models).toEqual(["claude-haiku-4-5", "claude-sonnet-4-5"]);
  });
});

describe("fetchAvailableModels - Ollama", () => {
  it("GETs {endpoint}/api/tags and reads model names", async () => {
    const mock = makeMockFetch(
      200,
      JSON.stringify({ models: [{ name: "llama3.2" }, { name: "qwen2.5" }] }),
    );
    const models = await fetchAvailableModels({
      kind: "ollama",
      apiKey: "",
      endpoint: "http://localhost:11434/",
      fetchImpl: mock.fetchImpl,
    });
    expect(mock.lastRequest()!.url).toBe("http://localhost:11434/api/tags");
    expect(models).toEqual(["llama3.2", "qwen2.5"]);
  });

  it("rejects when no endpoint is set", async () => {
    const mock = makeMockFetch(200, "{}");
    await expect(
      fetchAvailableModels({ kind: "ollama", apiKey: "", endpoint: "  ", fetchImpl: mock.fetchImpl }),
    ).rejects.toThrow(/endpoint/i);
  });
});
