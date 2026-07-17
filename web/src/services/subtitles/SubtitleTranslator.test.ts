import { describe, expect, it, vi } from "vitest";
import { OPENAI_COMPATIBLE, type AIProviderKind } from "../ai/models";
import type { FetchImpl } from "../../lib/http";
import { SubtitleTranslator, buildChatCall } from "./SubtitleTranslator";
import type { SubtitleCue } from "./cues";

describe("buildChatCall", () => {
  it("builds OpenAI-compatible calls from the provider registry", () => {
    for (const [provider, compatible] of Object.entries(OPENAI_COMPATIBLE)) {
      const call = buildChatCall(
        {
          provider: provider as AIProviderKind,
          apiKey: "  provider-key ",
          model: "",
          ollamaEndpoint: "",
        },
        "Translate now",
      );

      expect(call).not.toBeNull();
      expect(call!.url).toBe(`${compatible.baseURL}/chat/completions`);
      expect(call!.headers.Authorization).toBe("Bearer provider-key");
      expect(JSON.parse(call!.body).model).toBe(compatible.defaultModel);
    }
  });

  it("normalizes Ollama endpoints and extracts its response text", () => {
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
    expect(call!.extract({ message: { content: "translated" } })).toBe(
      "translated",
    );
  });
});

describe("SubtitleTranslator.translate", () => {
  it("does not call the provider when its configuration is not buildable", async () => {
    const fetchImpl = vi.fn<FetchImpl>(async () => ({
      status: 200,
      text: async () => "{}",
    }));
    const cues: SubtitleCue[] = [{ start: 0, end: 1000, text: "Hello" }];
    const translator = new SubtitleTranslator(
      {
        provider: "openai",
        apiKey: "   ",
        model: "gpt-4o-mini",
        ollamaEndpoint: "",
      },
      fetchImpl,
    );

    await expect(translator.translate(cues, "French")).resolves.toEqual(cues);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
