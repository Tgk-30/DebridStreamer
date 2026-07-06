import { describe, expect, it, vi } from "vitest";
import {
  SubtitleTranslator,
  buildChatCall,
  buildTranslationPrompt,
} from "./SubtitleTranslator";
import type { AIProviderKind } from "../ai/models";
import type { FetchImpl } from "../../lib/http";
import type { SubtitleCue } from "./cues";

const sampleCues: SubtitleCue[] = [
  { start: 0, end: 1000, text: "Hello there" },
  { start: 1500, end: 2000, text: "Good day" },
];

function createTranslator(
  provider: AIProviderKind,
  fetch: FetchImpl,
  extra: Partial<Record<string, string>> = {},
) {
  const config = {
    provider,
    apiKey: "  my-key  ",
    model: "gpt-4o-mini",
    ollamaEndpoint: "http://localhost:11434",
    ...extra,
  };
  return new SubtitleTranslator(config, fetch);
}

function mockFetch(responseStatus: number, responseBody: string): {
  calls: Array<{ url: string; body: string | undefined; headers?: Record<string, string> }>;
  fetch: FetchImpl;
} {
  const calls: Array<{ url: string; body: string | undefined; headers?: Record<string, string> }> = [];
  const fetch: FetchImpl = async (url, init) => {
    calls.push({
      url,
      body: init?.body as string | undefined,
      headers: (init?.headers as Record<string, string>) ?? undefined,
    });
    return {
      status: responseStatus,
      text: async () => responseBody,
    };
  };
  return { fetch, calls };
}

describe("buildTranslationPrompt", () => {
  it("includes the target language and numbered cue payload", () => {
    const prompt = buildTranslationPrompt({ indices: [0, 1], payload: "[[0]] Hello\n[[1]] World" }, "Spanish");
    expect(prompt).toContain("Translate the following subtitle lines into Spanish.");
    expect(prompt).toContain("[[0]] Hello");
    expect(prompt).toContain("[[1]] World");
  });
});

describe("buildChatCall", () => {
  it("builds OpenAI calls with auth and model defaults", () => {
    const call = buildChatCall(
      {
        provider: "openai",
        apiKey: "  openai-key ",
        model: "",
        ollamaEndpoint: "",
      },
      "Translate now",
    );
    expect(call).not.toBeNull();
    expect(call!.url).toBe("https://api.openai.com/v1/chat/completions");
    expect(call!.headers.Authorization).toBe("Bearer openai-key");
    expect(JSON.parse(call!.body).model).toBe("gpt-4o-mini");
    expect(call!.extract({ choices: [{ message: { content: "x" } }] })).toBe("x");
  });

  it("builds Anthropic calls with the x-api-key header", () => {
    const call = buildChatCall(
      {
        provider: "anthropic",
        apiKey: " anthro ",
        model: "claude-haiku-4-5",
        ollamaEndpoint: "",
      },
      "Hola",
    );
    expect(call).not.toBeNull();
    expect(call!.url).toBe("https://api.anthropic.com/v1/messages");
    expect(call!.headers["x-api-key"]).toBe("anthro");
    expect(call!.headers["anthropic-version"]).toBe("2023-06-01");
    expect(JSON.parse(call!.body).model).toBe("claude-haiku-4-5");
  });

  it("normalizes Ollama endpoint and builds api/chat body", () => {
    const call = buildChatCall(
      {
        provider: "ollama",
        apiKey: "",
        model: "llama3.1:8b",
        ollamaEndpoint: "http://host:11434//",
      },
      "Hey",
    );
    expect(call).not.toBeNull();
    expect(call!.url).toBe("http://host:11434/api/chat");
    expect(JSON.parse(call!.body).messages[0].role).toBe("user");
    expect(call!.extract({ message: { content: "y" } })).toBe("y");
  });

  it("returns null when provider credentials are missing", () => {
    expect(
      buildChatCall(
        { provider: "openai", apiKey: "   ", model: "", ollamaEndpoint: "" },
        "t",
      ),
    ).toBeNull();
    expect(
      buildChatCall(
        { provider: "ollama", apiKey: "", model: "", ollamaEndpoint: "" },
        "t",
      ),
    ).toBeNull();
  });
});

describe("SubtitleTranslator.translate", () => {
  it("translates cues and reports progress", async () => {
    const { fetch, calls } = mockFetch(
      200,
      JSON.stringify({
        choices: [{ message: { content: "[[0]] Hola\n[[1]] Mundo" } }],
      }),
    );
    const translator = createTranslator("openai", fetch);
    const onProgress = vi.fn<(done: number, total: number) => void>();

    const out = await translator.translate(sampleCues, "Spanish", onProgress);

    expect(calls).toHaveLength(1);
    expect(out).toHaveLength(2);
    expect(out[0].text).toBe("Hola");
    expect(out[1].text).toBe("Mundo");
    expect(onProgress).toHaveBeenCalledWith(1, 1);
  });

  it("marks available when provider configuration is complete", () => {
    const { fetch } = mockFetch(200, "{}");
    expect(createTranslator("openai", fetch).available).toBe(true);
    expect(createTranslator("anthropic", fetch, { apiKey: "  " }).available).toBe(false);
  });

  it("treats non-2xx provider responses as untranslated", async () => {
    const { fetch, calls } = mockFetch(
      500,
      "translator unavailable",
    );
    const translator = createTranslator("openai", fetch);
    const out = await translator.translate(sampleCues, "German");

    expect(calls).toHaveLength(1);
    expect(out).toEqual(sampleCues);
  });

  it("keeps source cues when a provider returns no translated text", async () => {
    const { fetch, calls } = mockFetch(
      200,
      JSON.stringify({ choices: [{}] }),
    );
    const translator = createTranslator("openai", fetch);
    const out = await translator.translate([sampleCues[0]], "Japanese");

    expect(calls).toHaveLength(1);
    expect(out).toEqual([sampleCues[0]]);
  });

  it("skips translation entirely when provider is not buildable", async () => {
    const { fetch, calls } = mockFetch(200, "{}");
    const translator = createTranslator(
      "openai",
      fetch,
      { apiKey: "   " },
    );

    const out = await translator.translate(sampleCues, "French");
    expect(calls).toHaveLength(0);
    expect(out).toEqual(sampleCues);
  });
});
