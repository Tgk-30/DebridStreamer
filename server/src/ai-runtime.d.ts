import type { AppDatabase } from "./db.js";
import type { ServerConfig } from "./types.js";

interface AIRecommendBody {
  prompt: string;
  count: number;
}

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
