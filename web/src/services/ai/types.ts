// Port of Sources/DebridStreamer/Services/AI/AIAssistantProvider.swift (the
// AIAssistantProvider protocol, AIAssistantProviderError, and the
// AIAssistantJSONParser) plus Sources/.../AIUsageCostEstimator.swift.
//
// The provider implementations (OpenAI/Anthropic/Ollama) live in their own
// files and depend on this module for the shared interface, error type, prompt
// envelope, JSON parsing, and cost estimation. The DB-backed context assembler
// (AssistantContextAssembler) is deferred to a later phase.

import type {
  AIMovieRecommendation,
  AIProviderKind,
  AIProviderRecommendationResult,
} from "./models";
import { makeAIMovieRecommendation } from "./models";

// MARK: - AIAssistantProvider interface

/** Mirrors Swift `AIAssistantProvider`. */
export interface AIAssistantProvider {
  readonly kind: AIProviderKind;
  recommend(
    prompt: string,
    candidateTitles: string[],
    maxResults: number,
  ): Promise<AIProviderRecommendationResult>;
}

// MARK: - AIAssistantProviderError

/**
 * Error kinds thrown by AI providers. Mirrors Swift `AIAssistantProviderError`,
 * carrying the same human-facing descriptions via `message`.
 */
export type AIAssistantProviderErrorKind =
  | "missingAPIKey"
  | "invalidResponse"
  | "apiError";

export class AIAssistantProviderError extends Error {
  readonly kind: AIAssistantProviderErrorKind;

  private constructor(kind: AIAssistantProviderErrorKind, message: string) {
    super(message);
    this.name = "AIAssistantProviderError";
    this.kind = kind;
  }

  static missingAPIKey(): AIAssistantProviderError {
    return new AIAssistantProviderError("missingAPIKey", "Missing API key.");
  }
  static invalidResponse(): AIAssistantProviderError {
    return new AIAssistantProviderError(
      "invalidResponse",
      "AI provider returned an invalid response.",
    );
  }
  static apiError(message: string): AIAssistantProviderError {
    return new AIAssistantProviderError("apiError", message);
  }
}

// MARK: - Injectable fetch

/** Injectable fetch signature (a subset of the DOM `fetch`). The Swift code
 * injects a `URLSession`; here tests inject a stub so no network is hit. */
export type FetchImpl = (
  url: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  },
) => Promise<{
  status: number;
  text(): Promise<string>;
}>;

/** Resolves a usable fetch — the injected stub or the global. */
export function resolveFetch(fetchImpl?: FetchImpl): FetchImpl {
  return fetchImpl ?? ((url, init) => fetch(url, init as RequestInit));
}

// MARK: - AIAssistantJSONParser

/** The shape a recommendations payload decodes into. Mirrors the Swift
 * `Payload`/`Recommendation` decodables (all fields optional except title). */
interface RawPayload {
  recommendations?: RawRecommendation[] | null;
}

interface RawRecommendation {
  title?: unknown;
  year?: unknown;
  reason?: unknown;
  score?: unknown;
}

/**
 * Pure (no-network) parser that turns an AI provider's text response into
 * recommendations. Mirrors Swift `AIAssistantJSONParser`:
 *  1. strip markdown code fences,
 *  2. extract the FIRST balanced `{...}` object (brace-counting, string-aware),
 *  3. decode `{recommendations:[...]}` and map with defaults, OR
 *  4. fall back to line-by-line parsing when no JSON object is present.
 */
export const AIAssistantJSONParser = {
  parseRecommendations(
    text: string,
    maxResults: number,
  ): AIMovieRecommendation[] {
    const fenceStripped = strippingCodeFences(text);
    const json = firstBalancedJSONObject(fenceStripped);
    if (json != null) {
      const payload = tryDecodePayload(json);
      if (payload != null) {
        const recs = payload.recommendations ?? [];
        return recs
          .slice(0, maxResults)
          .map((item) =>
            makeAIMovieRecommendation({
              title: typeof item.title === "string" ? item.title : "",
              year: typeof item.year === "number" ? item.year : null,
              reason:
                typeof item.reason === "string"
                  ? item.reason
                  : "Recommended by AI assistant.",
              score: typeof item.score === "number" ? item.score : 0.5,
            }),
          );
      }
    }

    // Line fallback: split on newlines, drop blanks, strip list markers.
    const lines = text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    return lines.slice(0, maxResults).map((line, index) => {
      const title = line
        .replace(/^\d+[).\s-]*/, "")
        .replace(/^[-•*]\s*/, "");
      return makeAIMovieRecommendation({
        title: title.length === 0 ? `Recommendation ${index + 1}` : title,
        year: null,
        reason: "Suggested by AI assistant.",
        score: Math.max(0.0, 1.0 - index * 0.1),
      });
    });
  },

  /** Rough heuristic for budgeting when a provider omits official usage.
   * Mirrors Swift `estimatedTokenCount`. */
  estimatedTokenCount(text: string): number {
    const trimmed = text.trim();
    if (trimmed.length === 0) return 0;
    return Math.max(1, Math.floor(trimmed.length / 4));
  },

  /** Builds the shared prompt sent to every provider. Mirrors Swift
   * `promptEnvelope`. Caps candidate titles at 30, joined with ", ". */
  promptEnvelope(
    userPrompt: string,
    candidateTitles: string[],
    maxResults: number,
  ): string {
    const candidates = candidateTitles.slice(0, 30).join(", ");
    return [
      "You are a movie recommendation assistant.",
      `Recommend up to ${maxResults} items.`,
      `Use this user intent: ${userPrompt}`,
      `Preferred candidate context (optional): ${candidates}`,
      "Return ONLY JSON in this schema:",
      '{"recommendations":[{"title":"...","year":2024,"reason":"...","score":0.0}]}',
    ].join("\n");
  },
} as const;

/** Decodes a `{recommendations:[...]}` payload, returning null on any failure.
 * Mirrors Swift `try? JSONDecoder().decode(Payload.self, ...)`. A payload is
 * only valid when it has a `recommendations` array. */
function tryDecodePayload(json: string): RawPayload | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }
  if (
    parsed == null ||
    typeof parsed !== "object" ||
    !Array.isArray((parsed as RawPayload).recommendations)
  ) {
    return null;
  }
  return parsed as RawPayload;
}

/** Removes surrounding markdown code fences (``` or ```json) so the JSON inside
 * a fenced block can be extracted. Leaves non-fenced text untouched. Mirrors
 * Swift `strippingCodeFences`. */
function strippingCodeFences(text: string): string {
  if (!text.includes("```")) return text;
  let result = text;
  // Drop the opening fence and an optional language tag on its line.
  result = result.replace(/```[a-zA-Z0-9]*\n?/, "");
  // Drop the last closing fence.
  const closeIndex = result.lastIndexOf("```");
  if (closeIndex !== -1) {
    result = result.slice(0, closeIndex) + result.slice(closeIndex + 3);
  }
  return result;
}

/** Returns the first complete, balanced `{...}` JSON object found in `text`,
 * tracking brace depth while respecting string literals and escapes so braces
 * inside string values do not throw off the count. Mirrors Swift
 * `firstBalancedJSONObject`. */
function firstBalancedJSONObject(text: string): string | null {
  let startIndex: number | null = null;
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === '"') {
        inString = false;
      }
    } else {
      switch (character) {
        case '"':
          inString = true;
          break;
        case "{":
          if (depth === 0) {
            startIndex = index;
          }
          depth += 1;
          break;
        case "}":
          if (depth > 0) {
            depth -= 1;
            if (depth === 0 && startIndex != null) {
              return text.slice(startIndex, index + 1);
            }
          }
          break;
        default:
          break;
      }
    }
  }

  return null;
}

// MARK: - AIUsageCostEstimator

interface Rate {
  inputPerMillionUSD: number;
  outputPerMillionUSD: number;
}

const KNOWN_RATES: Record<string, Rate> = {
  // OpenAI
  "gpt-4.1": { inputPerMillionUSD: 2.0, outputPerMillionUSD: 8.0 },
  "gpt-4.1-mini": { inputPerMillionUSD: 0.4, outputPerMillionUSD: 1.6 },
  "gpt-4.1-nano": { inputPerMillionUSD: 0.1, outputPerMillionUSD: 0.4 },
  "gpt-4o": { inputPerMillionUSD: 2.5, outputPerMillionUSD: 10.0 },
  "gpt-4o-mini": { inputPerMillionUSD: 0.15, outputPerMillionUSD: 0.6 },
  o3: { inputPerMillionUSD: 10.0, outputPerMillionUSD: 40.0 },
  "o4-mini": { inputPerMillionUSD: 1.1, outputPerMillionUSD: 4.4 },

  // Anthropic (current generation, $/1M tokens)
  "claude-fable-5": { inputPerMillionUSD: 10.0, outputPerMillionUSD: 50.0 },
  "claude-opus-4-8": { inputPerMillionUSD: 5.0, outputPerMillionUSD: 25.0 },
  "claude-opus-4-7": { inputPerMillionUSD: 5.0, outputPerMillionUSD: 25.0 },
  "claude-opus-4-6": { inputPerMillionUSD: 5.0, outputPerMillionUSD: 25.0 },
  "claude-sonnet-4-6": { inputPerMillionUSD: 3.0, outputPerMillionUSD: 15.0 },
  "claude-haiku-4-5": { inputPerMillionUSD: 1.0, outputPerMillionUSD: 5.0 },
};

/** Estimates the USD cost of an AI call from model + token usage. Mirrors
 * Swift `AIUsageCostEstimator`. Returns null when no usage can be priced. */
export const AIUsageCostEstimator = {
  estimateUSD(
    model: string | null | undefined,
    inputTokens: number | null | undefined,
    outputTokens: number | null | undefined,
    totalTokens: number | null | undefined,
  ): number | null {
    const normalizedModel = (model ?? "").trim().toLowerCase();
    if (normalizedModel.length === 0) {
      return estimateFromUnknownModel(totalTokens);
    }

    const known = KNOWN_RATES[normalizedModel];
    if (known != null) {
      return estimate(known, inputTokens, outputTokens, totalTokens);
    }

    if (normalizedModel.includes("mini")) {
      return estimate(
        { inputPerMillionUSD: 0.5, outputPerMillionUSD: 2.0 },
        inputTokens,
        outputTokens,
        totalTokens,
      );
    }
    if (normalizedModel.includes("haiku")) {
      return estimate(
        { inputPerMillionUSD: 1.0, outputPerMillionUSD: 5.0 },
        inputTokens,
        outputTokens,
        totalTokens,
      );
    }
    if (normalizedModel.includes("sonnet")) {
      return estimate(
        { inputPerMillionUSD: 3.0, outputPerMillionUSD: 15.0 },
        inputTokens,
        outputTokens,
        totalTokens,
      );
    }
    if (normalizedModel.includes("opus")) {
      return estimate(
        { inputPerMillionUSD: 5.0, outputPerMillionUSD: 25.0 },
        inputTokens,
        outputTokens,
        totalTokens,
      );
    }

    return estimateFromUnknownModel(totalTokens);
  },
} as const;

function estimate(
  rate: Rate,
  inputTokens: number | null | undefined,
  outputTokens: number | null | undefined,
  totalTokens: number | null | undefined,
): number | null {
  const input = Math.max(0, inputTokens ?? totalTokens ?? 0);
  const output = Math.max(
    0,
    outputTokens ?? Math.max(0, (totalTokens ?? 0) - input),
  );
  if (input === 0 && output === 0) {
    return null;
  }
  const inputCost = (input / 1_000_000) * rate.inputPerMillionUSD;
  const outputCost = (output / 1_000_000) * rate.outputPerMillionUSD;
  return inputCost + outputCost;
}

function estimateFromUnknownModel(
  totalTokens: number | null | undefined,
): number | null {
  if (totalTokens == null || totalTokens <= 0) return null;
  // Conservative fallback to avoid zeroing unknown providers.
  return (totalTokens / 1_000_000) * 2.0;
}

/** Sum of two optional token counts, dropping nulls. Mirrors the Swift
 * `[a, b].compactMap { $0 }.reduce(0, +)` pattern used by the providers. */
export function sumTokens(
  a: number | null | undefined,
  b: number | null | undefined,
): number {
  return (a ?? 0) + (b ?? 0);
}
