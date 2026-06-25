// OpenSubtitles client + AI translator tests. Network is stubbed via an
// injected FetchImpl (same pattern as the AI provider tests), so no request is
// made; the pure query/parse/prompt builders are exercised directly.

import { describe, expect, it } from "vitest";
import type { FetchImpl } from "../../lib/http";
import {
  buildSearchQuery,
  imdbDigits,
  OpenSubtitlesClient,
  parseSearchResponse,
} from "./OpenSubtitlesClient";
import {
  buildChatCall,
  buildTranslationPrompt,
  SubtitleTranslator,
  type TranslatorConfig,
} from "./SubtitleTranslator";
import { batchCuesForTranslation, type SubtitleCue } from "./cues";

interface Captured {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}

/** Build a fetch stub that returns canned responses per URL substring. */
function makeFetch(
  routes: { match: string; status?: number; body: string }[],
): { fetchImpl: FetchImpl; calls: Captured[] } {
  const calls: Captured[] = [];
  const fetchImpl: FetchImpl = async (url, init) => {
    calls.push({ url, method: init?.method, headers: init?.headers, body: init?.body });
    const route = routes.find((r) => url.includes(r.match));
    return {
      status: route?.status ?? 200,
      text: async () => route?.body ?? "",
    };
  };
  return { fetchImpl, calls };
}

describe("imdbDigits", () => {
  it("strips the tt prefix and non-digits", () => {
    expect(imdbDigits("tt0133093")).toBe("0133093");
    expect(imdbDigits("0133093")).toBe("0133093");
    expect(imdbDigits(null)).toBeNull();
    expect(imdbDigits("")).toBeNull();
  });
});

describe("buildSearchQuery", () => {
  it("includes imdb id, languages and season/episode", () => {
    const q = buildSearchQuery({
      imdbId: "tt0944947",
      season: 1,
      episode: 2,
      languages: ["en", "es"],
    });
    expect(q).toContain("imdb_id=0944947");
    expect(q).toContain("season_number=1");
    expect(q).toContain("episode_number=2");
    expect(q).toContain("languages=en%2Ces");
  });

  it("uses the free-text query when no imdb id and defaults to english", () => {
    const q = buildSearchQuery({ query: "The Matrix" });
    expect(q).toContain("query=The+Matrix");
    expect(q).toContain("languages=en");
  });
});

describe("parseSearchResponse", () => {
  const sample = JSON.stringify({
    data: [
      {
        attributes: {
          language: "EN",
          release: "The.Matrix.1999.1080p",
          download_count: 4200,
          hearing_impaired: false,
          machine_translated: false,
          fps: 23.976,
          files: [{ file_id: 99 }],
        },
      },
      // A row without files is dropped.
      { attributes: { language: "es", files: [] } },
    ],
  });

  it("normalizes rows and drops files-less entries", () => {
    const results = parseSearchResponse(JSON.parse(sample));
    expect(results.length).toBe(1);
    expect(results[0]).toMatchObject({
      fileId: "99",
      language: "en",
      downloadCount: 4200,
    });
  });

  it("returns [] for a malformed payload", () => {
    expect(parseSearchResponse({})).toEqual([]);
    expect(parseSearchResponse(null)).toEqual([]);
  });
});

describe("OpenSubtitlesClient", () => {
  it("sends Api-Key + User-Agent headers on search", async () => {
    const { fetchImpl, calls } = makeFetch([
      { match: "/subtitles", body: JSON.stringify({ data: [] }) },
    ]);
    const client = new OpenSubtitlesClient("my-key", fetchImpl);
    expect(client.hasKey).toBe(true);
    await client.search({ imdbId: "tt1" });
    expect(calls[0].headers?.["Api-Key"]).toBe("my-key");
    expect(calls[0].headers?.["User-Agent"]).toContain("DebridStreamer");
  });

  it("throws when no key is configured", async () => {
    const { fetchImpl } = makeFetch([]);
    const client = new OpenSubtitlesClient("   ", fetchImpl);
    expect(client.hasKey).toBe(false);
    await expect(client.search({ imdbId: "tt1" })).rejects.toThrow();
  });

  it("download resolves the link then fetches the file text", async () => {
    const { fetchImpl, calls } = makeFetch([
      { match: "/download", body: JSON.stringify({ link: "https://dl.example/sub.srt" }) },
      { match: "dl.example", body: "1\n00:00:01,000 --> 00:00:02,000\nHi\n" },
    ]);
    const client = new OpenSubtitlesClient("k", fetchImpl);
    const text = await client.download("99");
    expect(text).toContain("Hi");
    // Two requests: POST /download then GET the link.
    expect(calls[0].method).toBe("POST");
    expect(calls[1].url).toBe("https://dl.example/sub.srt");
  });

  it("search throws OpenSubtitlesError with the status + body on a non-2xx response", async () => {
    const { fetchImpl } = makeFetch([
      { match: "/subtitles", status: 429, body: "rate limited" },
    ]);
    const client = new OpenSubtitlesClient("k", fetchImpl);
    await expect(client.search({ imdbId: "tt1" })).rejects.toMatchObject({
      name: "OpenSubtitlesError",
      status: 429,
      message: "rate limited",
    });
  });

  it("search falls back to a default message when the error body is empty", async () => {
    const { fetchImpl } = makeFetch([
      { match: "/subtitles", status: 500, body: "" },
    ]);
    const client = new OpenSubtitlesClient("k", fetchImpl);
    await expect(client.search({ imdbId: "tt1" })).rejects.toMatchObject({
      status: 500,
      message: "OpenSubtitles search failed",
    });
  });

  it("download throws when no key is configured", async () => {
    const { fetchImpl } = makeFetch([]);
    const client = new OpenSubtitlesClient("", fetchImpl);
    await expect(client.download("99")).rejects.toMatchObject({
      name: "OpenSubtitlesError",
      status: 0,
    });
  });

  it("download throws on a non-2xx POST /download response", async () => {
    const { fetchImpl } = makeFetch([
      { match: "/download", status: 406, body: "no quota" },
    ]);
    const client = new OpenSubtitlesClient("k", fetchImpl);
    await expect(client.download("99")).rejects.toMatchObject({
      status: 406,
      message: "no quota",
    });
  });

  it("download falls back to a default message when the download error body is empty", async () => {
    const { fetchImpl } = makeFetch([
      { match: "/download", status: 403, body: "" },
    ]);
    const client = new OpenSubtitlesClient("k", fetchImpl);
    await expect(client.download("99")).rejects.toMatchObject({
      status: 403,
      message: "OpenSubtitles download failed",
    });
  });

  it("download throws 502 when the API returns no download link", async () => {
    const { fetchImpl } = makeFetch([
      { match: "/download", body: JSON.stringify({ link: "" }) },
    ]);
    const client = new OpenSubtitlesClient("k", fetchImpl);
    await expect(client.download("99")).rejects.toMatchObject({
      status: 502,
      message: "OpenSubtitles returned no download link.",
    });
  });

  it("download throws 502 when the link field is absent entirely", async () => {
    const { fetchImpl } = makeFetch([
      { match: "/download", body: JSON.stringify({}) },
    ]);
    const client = new OpenSubtitlesClient("k", fetchImpl);
    await expect(client.download("99")).rejects.toMatchObject({ status: 502 });
  });

  it("download throws when the resolved file link fetch is non-2xx", async () => {
    const { fetchImpl } = makeFetch([
      { match: "/download", body: JSON.stringify({ link: "https://dl.example/sub.srt" }) },
      { match: "dl.example", status: 404, body: "" },
    ]);
    const client = new OpenSubtitlesClient("k", fetchImpl);
    await expect(client.download("99")).rejects.toMatchObject({
      status: 404,
      message: "Failed to fetch the subtitle file.",
    });
  });

  it("search uses the default message when reading the error body itself rejects", async () => {
    // The `.catch(() => "")` guard around res.text() on the error path.
    const fetchImpl: FetchImpl = async () => ({
      status: 500,
      text: async () => {
        throw new Error("body stream errored");
      },
    });
    const client = new OpenSubtitlesClient("k", fetchImpl);
    await expect(client.search({ imdbId: "tt1" })).rejects.toMatchObject({
      status: 500,
      message: "OpenSubtitles search failed",
    });
  });

  it("download uses the default message when reading the error body itself rejects", async () => {
    const fetchImpl: FetchImpl = async () => ({
      status: 502,
      text: async () => {
        throw new Error("body stream errored");
      },
    });
    const client = new OpenSubtitlesClient("k", fetchImpl);
    await expect(client.download("99")).rejects.toMatchObject({
      status: 502,
      message: "OpenSubtitles download failed",
    });
  });
});

describe("buildTranslationPrompt", () => {
  it("names the target language and includes the payload + markers", () => {
    const batch = batchCuesForTranslation([
      { start: 0, end: 1000, text: "Hello" },
    ])[0];
    const prompt = buildTranslationPrompt(batch, "Spanish");
    expect(prompt).toContain("Spanish");
    expect(prompt).toContain("[[0]] Hello");
  });
});

describe("buildChatCall", () => {
  const base: TranslatorConfig = {
    provider: "openai",
    apiKey: "k",
    model: "",
    ollamaEndpoint: "http://localhost:11434",
  };

  it("builds an OpenAI chat call with bearer auth", () => {
    const call = buildChatCall(base, "hi")!;
    expect(call.url).toContain("openai.com");
    expect(call.headers.Authorization).toBe("Bearer k");
  });

  it("builds an Anthropic call with x-api-key", () => {
    const call = buildChatCall({ ...base, provider: "anthropic" }, "hi")!;
    expect(call.url).toContain("anthropic.com");
    expect(call.headers["x-api-key"]).toBe("k");
  });

  it("builds an Ollama call from the endpoint without a key", () => {
    const call = buildChatCall(
      { ...base, provider: "ollama", apiKey: "" },
      "hi",
    )!;
    expect(call.url).toBe("http://localhost:11434/api/chat");
  });

  it("returns null when a hosted provider has no key", () => {
    expect(buildChatCall({ ...base, apiKey: "" }, "hi")).toBeNull();
    expect(
      buildChatCall({ ...base, provider: "anthropic", apiKey: "  " }, "hi"),
    ).toBeNull();
  });

  it("extracts assistant text from each provider's response shape", () => {
    const openai = buildChatCall(base, "x")!;
    expect(
      openai.extract({ choices: [{ message: { content: "out" } }] }),
    ).toBe("out");
    const anthropic = buildChatCall({ ...base, provider: "anthropic" }, "x")!;
    expect(
      anthropic.extract({ content: [{ type: "text", text: "out" }] }),
    ).toBe("out");
  });
});

describe("SubtitleTranslator", () => {
  const cfg: TranslatorConfig = {
    provider: "openai",
    apiKey: "k",
    model: "",
    ollamaEndpoint: "",
  };

  it("translates cues while preserving timing", async () => {
    const cues: SubtitleCue[] = [
      { start: 0, end: 1000, text: "Hello" },
      { start: 1000, end: 2000, text: "World" },
    ];
    // Echo a translated marker payload for whatever the batch sends.
    const fetchImpl: FetchImpl = async () => ({
      status: 200,
      text: async () =>
        JSON.stringify({
          choices: [
            { message: { content: "[[0]] Hola\n[[1]] Mundo" } },
          ],
        }),
    });
    const translator = new SubtitleTranslator(cfg, fetchImpl);
    expect(translator.available).toBe(true);
    const out = await translator.translate(cues, "Spanish");
    expect(out[0]).toMatchObject({ start: 0, end: 1000, text: "Hola" });
    expect(out[1].text).toBe("Mundo");
  });

  it("leaves cues untranslated when a batch request fails", async () => {
    const cues: SubtitleCue[] = [{ start: 0, end: 1000, text: "Hello" }];
    const fetchImpl: FetchImpl = async () => ({
      status: 500,
      text: async () => "boom",
    });
    const translator = new SubtitleTranslator(cfg, fetchImpl);
    const out = await translator.translate(cues, "Spanish");
    expect(out[0].text).toBe("Hello"); // best-effort fallback
  });

  it("reports unavailable when no key/endpoint is configured", () => {
    const t = new SubtitleTranslator(
      { provider: "openai", apiKey: "", model: "", ollamaEndpoint: "" },
      async () => ({ status: 200, text: async () => "" }),
    );
    expect(t.available).toBe(false);
  });
});
