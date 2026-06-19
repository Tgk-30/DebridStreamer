import type { AppDatabase } from "./db.js";
import type { ServerConfig } from "./types.js";

interface AIRecommendBody {
  prompt: string;
  count: number;
}

/** Injectable FetchImpl (per web/src/services/ai/types.ts) backed by global fetch
 *  with a timeout. When `guard` is set, each URL is SSRF-checked first. */
export function makeAIFetch(
  guard: { allowPrivate: boolean } | null,
): (
  url: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string },
) => Promise<{ status: number; text(): Promise<string> }>;

/** The first configured AI credential for this profile (probe order), or null.
 *  `value` is an API key for openai/anthropic, or the endpoint URL for ollama. */
export function selectAICredential(
  db: AppDatabase,
  config: ServerConfig,
  profileId: string,
): { kind: string; value: string } | null;

export function recommendServerAI(
  db: AppDatabase,
  config: ServerConfig,
  profileId: string,
  body: AIRecommendBody,
): Promise<{
  providerKind: string;
  recommendations: unknown[];
  model: string | null;
  usage: unknown;
}>;

export function curateServerAI(
  db: AppDatabase,
  config: ServerConfig,
  profileId: string,
  body: AIRecommendBody,
): Promise<{
  providerKind: string;
  items: unknown[];
  unmatched: number;
}>;
