// Port of the AI-recommendation value types from
// Sources/DebridStreamer/Models/AIAssistantModels.swift (the subset the AI
// providers + JSON parser produce/consume). The DB-backed request/response
// orchestration types (AIAssistantRequest, AICompareResult, AIProviderResponse)
// belong to the storage/manager layer and are deferred to a later phase; only
// the provider-facing types are ported here.
//
// Field names are kept aligned with the Swift models so cached/serialized JSON
// lines up across the two implementations.

import type { MediaType } from "../../models/media";
import { isNetworkAllowed } from "../../lib/networkPolicy";

const TMDB_IMAGE_BASE = "https://image.tmdb.org/t/p";

/** The AI provider backends. The original three (Swift `AIProviderKind` raw
 * values) plus OpenAI-compatible hosts that share the Chat Completions API. */
export type AIProviderKind =
  | "openai"
  | "anthropic"
  | "ollama"
  | "gemini"
  | "openrouter"
  | "groq"
  | "mistral"
  | "deepseek"
  | "xai";

/** OpenAI-compatible hosts: they all speak `POST {baseURL}/chat/completions`
 * with Bearer auth and expose `GET {baseURL}/models`, so one provider class +
 * one model-list path serves them all. Anthropic and Ollama are handled apart. */
export const OPENAI_COMPATIBLE: Record<
  string,
  { baseURL: string; defaultModel: string }
> = {
  openai: { baseURL: "https://api.openai.com/v1", defaultModel: "gpt-4o-mini" },
  gemini: {
    baseURL: "https://generativelanguage.googleapis.com/v1beta/openai",
    defaultModel: "gemini-2.5-flash",
  },
  openrouter: {
    baseURL: "https://openrouter.ai/api/v1",
    defaultModel: "openai/gpt-4o-mini",
  },
  groq: {
    baseURL: "https://api.groq.com/openai/v1",
    defaultModel: "llama-3.3-70b-versatile",
  },
  mistral: {
    baseURL: "https://api.mistral.ai/v1",
    defaultModel: "mistral-small-latest",
  },
  deepseek: {
    baseURL: "https://api.deepseek.com/v1",
    defaultModel: "deepseek-chat",
  },
  xai: { baseURL: "https://api.x.ai/v1", defaultModel: "grok-2-latest" },
};

const PROVIDER_LABELS: Record<AIProviderKind, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  ollama: "Ollama",
  gemini: "Google Gemini",
  openrouter: "OpenRouter",
  groq: "Groq",
  mistral: "Mistral",
  deepseek: "DeepSeek",
  xai: "xAI (Grok)",
};

export const AIProviderKind = {
  openAI: "openai" as AIProviderKind,
  anthropic: "anthropic" as AIProviderKind,
  ollama: "ollama" as AIProviderKind,
  gemini: "gemini" as AIProviderKind,
  openrouter: "openrouter" as AIProviderKind,
  groq: "groq" as AIProviderKind,
  mistral: "mistral" as AIProviderKind,
  deepseek: "deepseek" as AIProviderKind,
  xai: "xai" as AIProviderKind,

  /** Human-facing label. */
  displayName(kind: AIProviderKind): string {
    return PROVIDER_LABELS[kind] ?? kind;
  },

  allCases(): AIProviderKind[] {
    return [
      "anthropic",
      "openai",
      "gemini",
      "openrouter",
      "groq",
      "mistral",
      "deepseek",
      "xai",
      "ollama",
    ];
  },

  /** True when the kind speaks the OpenAI Chat Completions API. */
  isOpenAICompatible(kind: AIProviderKind): boolean {
    return kind in OPENAI_COMPATIBLE;
  },
} as const;

/**
 * A single AI movie/TV recommendation. Mirrors Swift `AIMovieRecommendation`.
 * `reason`/`score` are required (the Swift struct stores non-optionals; the
 * parser supplies defaults when the model omits them).
 */
export interface AIMovieRecommendation {
  title: string;
  year?: number | null;
  reason: string;
  score: number;
  mediaId?: string | null;
  mediaType?: MediaType | null;
  posterPath?: string | null;
}

/** Mirrors the Swift memberwise init of `AIMovieRecommendation`. */
export function makeAIMovieRecommendation(
  partial: Partial<AIMovieRecommendation> &
    Pick<AIMovieRecommendation, "title" | "reason" | "score">,
): AIMovieRecommendation {
  return {
    title: partial.title,
    year: partial.year ?? null,
    reason: partial.reason,
    score: partial.score,
    mediaId: partial.mediaId ?? null,
    mediaType: partial.mediaType ?? null,
    posterPath: partial.posterPath ?? null,
  };
}

export const AIMovieRecommendation = {
  /** Stable id. Mirrors Swift `AIMovieRecommendation.id`. */
  id(rec: AIMovieRecommendation): string {
    if (rec.mediaId != null && rec.mediaId.length > 0) {
      return rec.mediaId;
    }
    return `${rec.title.toLowerCase()}-${rec.year ?? 0}`;
  },

  /** w342 poster URL or null. Mirrors `AIMovieRecommendation.posterURL`. */
  posterURL(rec: AIMovieRecommendation): string | null {
    return rec.posterPath && isNetworkAllowed("images")
      ? `${TMDB_IMAGE_BASE}/w342${rec.posterPath}`
      : null;
  },
} as const;

/** Token + cost usage for a single AI call. Mirrors Swift `AIUsageMetrics`. */
export interface AIUsageMetrics {
  inputTokens?: number | null;
  outputTokens?: number | null;
  totalTokens?: number | null;
  estimatedCostUSD?: number | null;
}

export const AIUsageMetrics = {
  /** Mirrors Swift `AIUsageMetrics.safeTotalTokens`. */
  safeTotalTokens(usage: AIUsageMetrics): number {
    if (usage.totalTokens != null) {
      return Math.max(0, usage.totalTokens);
    }
    return Math.max(0, (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0));
  },
} as const;

/**
 * The result of a single provider's `recommend` call. Mirrors Swift
 * `AIProviderRecommendationResult`.
 */
export interface AIProviderRecommendationResult {
  model: string | null;
  recommendations: AIMovieRecommendation[];
  rawText: string | null;
  usage: AIUsageMetrics | null;
}
