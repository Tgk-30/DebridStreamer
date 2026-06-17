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

const TMDB_IMAGE_BASE = "https://image.tmdb.org/t/p";

/** The AI provider backends. Mirrors Swift `AIProviderKind` (raw values). */
export type AIProviderKind = "openai" | "anthropic" | "ollama";

export const AIProviderKind = {
  openAI: "openai" as AIProviderKind,
  anthropic: "anthropic" as AIProviderKind,
  ollama: "ollama" as AIProviderKind,

  /** Human-facing label. Mirrors `AIProviderKind.displayName`. */
  displayName(kind: AIProviderKind): string {
    switch (kind) {
      case "openai":
        return "OpenAI";
      case "anthropic":
        return "Anthropic";
      case "ollama":
        return "Ollama";
    }
  },

  allCases(): AIProviderKind[] {
    return ["openai", "anthropic", "ollama"];
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
    return rec.posterPath
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
