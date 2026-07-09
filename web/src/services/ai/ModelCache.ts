// Per-provider cache of the live model list, so the Settings model picker shows
// the provider's real catalog instantly (and offline) instead of only after a
// manual Refresh. Mirrors the TasteProfile KV-cache pattern (a JSON envelope in
// the Store's settings table). 24h TTL - a warm cache paints immediately while a
// background revalidation runs; a cache PAST its TTL is still returned (marked
// stale) so a failed live refresh falls back to "last known" rather than nothing.

import type { Store } from "../../storage/types";
import type { AIProviderKind } from "./models";

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

function keyFor(kind: AIProviderKind): string {
  return `ai.modelCache.${kind}`;
}

interface CachedModelsEnvelope {
  models: string[];
  fetchedAt: string; // ISO 8601
}

export interface ModelCacheEntry {
  models: string[];
  /** Epoch ms of the cached fetch. */
  fetchedAt: number;
  /** True once past the TTL - still usable as a last-known fallback. */
  stale: boolean;
}

/** Read the cached model list for a provider. Returns null on miss/parse error. */
export async function readModelCache(
  store: Store,
  kind: AIProviderKind,
  now = Date.now(),
): Promise<ModelCacheEntry | null> {
  const raw = await store.getSetting(keyFor(kind)).catch(() => null);
  if (raw == null) return null;
  try {
    const parsed = JSON.parse(raw) as CachedModelsEnvelope;
    if (!Array.isArray(parsed.models) || typeof parsed.fetchedAt !== "string") {
      return null;
    }
    const models = parsed.models.filter((m): m is string => typeof m === "string");
    const fetchedAt = new Date(parsed.fetchedAt).getTime();
    if (!Number.isFinite(fetchedAt)) return null;
    return { models, fetchedAt, stale: now - fetchedAt > CACHE_TTL_MS };
  } catch {
    return null;
  }
}

/** Persist a freshly-fetched model list for a provider (best-effort). */
export async function writeModelCache(
  store: Store,
  kind: AIProviderKind,
  models: string[],
  now = Date.now(),
): Promise<void> {
  const envelope: CachedModelsEnvelope = {
    models,
    fetchedAt: new Date(now).toISOString(),
  };
  await store.setSetting(keyFor(kind), JSON.stringify(envelope)).catch(() => {});
}
