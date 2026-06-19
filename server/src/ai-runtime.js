// Server-side AI recommendations so the Assistant + Discover mood-curate work in
// Server Mode (the AI provider key is stored server-side and the browser can't
// read it back). Reuses the browser AI providers verbatim — esbuild bundles the
// .ts at build time, tsx transpiles them in dev — so the prompt envelope, JSON
// parsing, and provider request shapes match the local app exactly.
//
// Provider/key selection mirrors every other server credential: profile-scoped
// credentials beat server-scoped ones (effectiveCredentialValue). With no
// explicit server-side provider selector, we probe providers in a fixed order
// and use the first that has a configured, non-empty credential.

import { OpenAIProvider } from "../../web/src/services/ai/OpenAIProvider.ts";
import { AnthropicProvider } from "../../web/src/services/ai/AnthropicProvider.ts";
import { OllamaProvider } from "../../web/src/services/ai/OllamaProvider.ts";
import {
  effectiveCredentialValue,
  searchServerMedia,
} from "./metadata-runtime.js";
import { assertSafeUpstream } from "./ssrf.js";

const AI_TIMEOUT_MS = 30_000;

// Probe order when no provider is explicitly selected: cloud providers first (a
// configured API key is a strong signal of intent), then a local Ollama endpoint.
const PROVIDER_ORDER = ["anthropic", "openai", "ollama"];

function missingKeyError() {
  return Object.assign(
    new Error("Configure an AI provider key in Settings to use the assistant."),
    { statusCode: 400 },
  );
}

/**
 * A FetchImpl (per web/src/services/ai/types.ts) backed by global fetch with a
 * hard timeout so a hung provider can't pin a Fastify worker. The body is
 * buffered here so the timeout covers the full read; the providers call text()
 * exactly once (success XOR error path). When `guard` is set — the user-supplied
 * Ollama endpoint — each URL is SSRF-checked first.
 */
export function makeAIFetch(guard) {
  return async (url, init) => {
    if (guard != null) await assertSafeUpstream(url, guard.allowPrivate);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), AI_TIMEOUT_MS);
    try {
      const response = await fetch(url, { ...init, signal: controller.signal });
      const bodyText = await response.text();
      return { status: response.status, text: async () => bodyText };
    } finally {
      clearTimeout(timer);
    }
  };
}

/**
 * Resolves the AI provider for this profile: the first provider (in
 * PROVIDER_ORDER) with a configured, non-empty credential. OpenAI/Anthropic call
 * fixed public hostnames (no SSRF guard, consistent with TMDB/debrid); the
 * Ollama endpoint is user-supplied, so it's guarded — allowing private/loopback
 * addresses only when the operator has opted into raw URLs (the same switch the
 * stream proxy uses), so a localhost Ollama works in that mode but a locked-down
 * deployment can't be used to probe the internal network. Returns null when no
 * provider is configured.
 */
/** The first configured AI credential for this profile, in PROVIDER_ORDER, or
 *  null. For openai/anthropic the value is an API key; for ollama it's the
 *  endpoint URL. Shared with the subtitle translator (subtitles-runtime.js). */
export function selectAICredential(db, config, profileId) {
  for (const kind of PROVIDER_ORDER) {
    const value = effectiveCredentialValue(db, config, profileId, kind);
    if (value != null && value.trim().length > 0) return { kind, value: value.trim() };
  }
  return null;
}

function selectProvider(db, config, profileId) {
  const sel = selectAICredential(db, config, profileId);
  if (sel == null) return null;
  if (sel.kind === "openai") {
    return { kind: sel.kind, provider: new OpenAIProvider(sel.value, undefined, makeAIFetch(null)) };
  }
  if (sel.kind === "anthropic") {
    return { kind: sel.kind, provider: new AnthropicProvider(sel.value, undefined, makeAIFetch(null)) };
  }
  // ollama: the credential value is the endpoint URL, not an API key — SSRF-guarded.
  return {
    kind: sel.kind,
    provider: new OllamaProvider(
      sel.value,
      undefined,
      makeAIFetch({ allowPrivate: config.allowRawStreamUrls }),
    ),
  };
}

async function runRecommend(db, config, profileId, body) {
  const selected = selectProvider(db, config, profileId);
  if (selected == null) throw missingKeyError();
  let result;
  try {
    result = await selected.provider.recommend(body.prompt, [], body.count);
  } catch {
    // Map any provider/network failure to a 502. The global error handler hides
    // >=500 detail, so the upstream's raw message never leaks to the client.
    throw Object.assign(new Error("The AI provider request failed."), {
      statusCode: 502,
    });
  }
  return { providerKind: selected.kind, result };
}

export async function recommendServerAI(db, config, profileId, body) {
  const { providerKind, result } = await runRecommend(db, config, profileId, body);
  return {
    providerKind,
    recommendations: result.recommendations,
    model: result.model,
    usage: result.usage,
  };
}

/** Best catalog match for an AI title — mirrors Discover.resolveRecommendation
 *  (exact-title + matching-year boost), but resolved server-side since the
 *  client has no TMDB key in Server Mode. Returns null when nothing matches. */
async function resolveTitle(db, config, profileId, rec) {
  const search = await searchServerMedia(db, config, profileId, {
    query: rec.title,
    type: rec.mediaType ?? null,
    page: 1,
  });
  const items = search.items ?? [];
  if (items.length === 0) return null;
  const normalized = rec.title.trim().toLowerCase();
  const sorted = [...items].sort((a, b) => {
    const aExact = a.title.trim().toLowerCase() === normalized ? 1 : 0;
    const bExact = b.title.trim().toLowerCase() === normalized ? 1 : 0;
    const aYear = rec.year != null && a.year === rec.year ? 1 : 0;
    const bYear = rec.year != null && b.year === rec.year ? 1 : 0;
    return bExact + bYear - (aExact + aYear);
  });
  return sorted[0] ?? null;
}

export async function curateServerAI(db, config, profileId, body) {
  const { providerKind, result } = await runRecommend(db, config, profileId, body);
  const resolved = await Promise.all(
    result.recommendations.map((rec) =>
      resolveTitle(db, config, profileId, rec).catch(() => null),
    ),
  );
  const seen = new Set();
  const items = [];
  for (const item of resolved) {
    if (item == null) continue;
    const key = `${item.type}:${item.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    items.push(item);
  }
  return {
    providerKind,
    items,
    // Recommendations not represented in the rail (no catalog match, or a
    // duplicate of one already shown).
    unmatched: result.recommendations.length - items.length,
  };
}
