// AI subtitle translation.
//
// Takes parsed cues and translates their TEXT to a target language while
// preserving timing exactly. The cues are split into batches (pure, in cues.ts),
// each batch is sent to the configured AI provider with a marker-preserving
// prompt, and the replies are stitched back onto the original cue timing.
//
// We reuse the SAME provider endpoints/request shapes as the recommendation
// providers (OpenAI Chat Completions / Anthropic Messages / Ollama chat) rather
// than the `recommend()` method, because translation is a different task. The
// provider config (kind/key/model/endpoint) is passed in; nothing in
// services/ai is modified. `appFetch` is threaded so it's CORS-free under Tauri.
//
// Gated gracefully by the caller: if no provider is configured this is never
// constructed. The prompt-building + reply-stitching are pure (in cues.ts) and
// unit-tested; this module only adds the (injectable-fetch) network glue +
// concurrency control.

import type { FetchImpl } from "../../lib/http";
import type { AIProviderKind } from "../ai/models";
import {
  applyTranslations,
  batchCuesForTranslation,
  parseTranslationReply,
  type CueBatch,
  type SubtitleCue,
} from "./cues";

/** The provider config a translation needs (a subset of AppSettings). */
export interface TranslatorConfig {
  provider: AIProviderKind;
  apiKey: string;
  model: string;
  /** Ollama base endpoint (only used when provider === "ollama"). */
  ollamaEndpoint: string;
}

/** Build the translation prompt for one batch. Pure + exported for tests.
 *
 * Instructs the model to keep the `[[i]]` markers and translate only the text,
 * one line per marker, into `targetLanguage`. */
export function buildTranslationPrompt(
  batch: CueBatch,
  targetLanguage: string,
): string {
  return [
    `Translate the following subtitle lines into ${targetLanguage}.`,
    "Each line is prefixed with a [[number]] marker.",
    "Keep EVERY marker exactly as-is and on its own line.",
    "Translate only the text after the marker. Do not merge or drop lines.",
    "Preserve the ⏎ symbol where it appears (it marks an in-cue line break).",
    "Return ONLY the translated lines, nothing else.",
    "",
    batch.payload,
  ].join("\n");
}

interface ChatCall {
  url: string;
  headers: Record<string, string>;
  body: string;
  /** Pull the assistant text out of the provider's raw JSON response. */
  extract: (json: unknown) => string | null;
}

/** Build the provider-specific chat request for a single prompt. Pure +
 * exported so the request shape is testable without the network. Returns null
 * when the provider can't be built (missing key/endpoint). */
export function buildChatCall(
  config: TranslatorConfig,
  prompt: string,
): ChatCall | null {
  const key = config.apiKey.trim();
  const model = config.model.trim();
  switch (config.provider) {
    case "openai": {
      if (key.length === 0) return null;
      return {
        url: "https://api.openai.com/v1/chat/completions",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${key}`,
        },
        body: JSON.stringify({
          model: model || "gpt-4o-mini",
          messages: [
            { role: "system", content: "You are a precise subtitle translator." },
            { role: "user", content: prompt },
          ],
          temperature: 0.2,
        }),
        extract: (json) =>
          (json as { choices?: { message?: { content?: string } }[] })
            ?.choices?.[0]?.message?.content ?? null,
      };
    }
    case "anthropic": {
      if (key.length === 0) return null;
      return {
        url: "https://api.anthropic.com/v1/messages",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": key,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: model || "claude-haiku-4-5",
          max_tokens: 2000,
          messages: [{ role: "user", content: prompt }],
        }),
        extract: (json) => {
          const parts = (json as { content?: { type: string; text?: string }[] })
            ?.content;
          return parts?.find((p) => p.type === "text")?.text ?? null;
        },
      };
    }
    case "ollama": {
      const endpoint = config.ollamaEndpoint.trim();
      if (endpoint.length === 0) return null;
      const base = endpoint.replace(/\/+$/, "");
      const url = base.endsWith("/api/chat") ? base : `${base}/api/chat`;
      return {
        url,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: model || "llama3.1:8b",
          stream: false,
          messages: [{ role: "user", content: prompt }],
        }),
        extract: (json) =>
          (json as { message?: { content?: string } })?.message?.content ?? null,
      };
    }
  }
}

/** Progress callback: (completedBatches, totalBatches). */
export type TranslationProgress = (done: number, total: number) => void;

/** The translation surface the player depends on. Implemented by the local
 *  `SubtitleTranslator` and the Server-Mode `ServerSubtitleTranslator`, so the
 *  player (useSubtitleTracks) is agnostic to where the AI key/network live. */
export interface Translator {
  /** Whether translation can run (a provider is configured, here or server-side). */
  readonly available: boolean;
  translate(
    cues: SubtitleCue[],
    targetLanguage: string,
    onProgress?: TranslationProgress,
  ): Promise<SubtitleCue[]>;
}

export class SubtitleTranslator implements Translator {
  private readonly config: TranslatorConfig;
  private readonly fetchImpl: FetchImpl;

  constructor(config: TranslatorConfig, fetchImpl: FetchImpl) {
    this.config = config;
    this.fetchImpl = fetchImpl;
  }

  /** True when the configured provider has the credentials it needs. */
  get available(): boolean {
    return buildChatCall(this.config, "x") != null;
  }

  /** Translate one batch's payload, returning the raw reply text. */
  private async translateBatch(batch: CueBatch, targetLanguage: string): Promise<string> {
    const call = buildChatCall(
      this.config,
      buildTranslationPrompt(batch, targetLanguage),
    );
    if (call == null) throw new Error("AI provider not configured.");
    const res = await this.fetchImpl(call.url, {
      method: "POST",
      headers: call.headers,
      body: call.body,
    });
    if (!(res.status >= 200 && res.status <= 299)) {
      throw new Error(
        (await res.text().catch(() => "")) || "AI translation request failed",
      );
    }
    const text = call.extract(JSON.parse(await res.text()));
    if (text == null) throw new Error("AI provider returned no text.");
    return text;
  }

  /** Translate all cues into `targetLanguage`, preserving timing.
   *
   * Batches are processed with bounded concurrency (default 3) for speed without
   * hammering the provider. A failed batch leaves its cues in the original
   * language (best-effort) rather than aborting the whole translation. */
  async translate(
    cues: SubtitleCue[],
    targetLanguage: string,
    onProgress?: TranslationProgress,
    concurrency = 3,
  ): Promise<SubtitleCue[]> {
    const batches = batchCuesForTranslation(cues);
    const merged = new Map<number, string>();
    let done = 0;

    let cursor = 0;
    const worker = async () => {
      for (;;) {
        const i = cursor++;
        if (i >= batches.length) return;
        const batch = batches[i];
        try {
          const reply = await this.translateBatch(batch, targetLanguage);
          const local = parseTranslationReply(reply);
          // Re-map batch-local indices back onto source-cue indices.
          for (const [localIdx, txt] of local) {
            const sourceIdx = batch.indices[localIdx];
            if (sourceIdx != null) merged.set(sourceIdx, txt);
          }
        } catch {
          // Best-effort: leave this batch untranslated.
        } finally {
          done += 1;
          onProgress?.(done, batches.length);
        }
      }
    };

    const workers = Array.from(
      { length: Math.min(concurrency, Math.max(1, batches.length)) },
      () => worker(),
    );
    await Promise.all(workers);
    return applyTranslations(cues, merged);
  }
}
