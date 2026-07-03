// Live model discovery for the Settings "Model" picker. Given a provider kind
// and its credential, this queries the provider's own model-list endpoint so the
// dropdown reflects what the account can actually use today — no hardcoded list
// to go stale. OpenAI-compatible hosts share `GET {baseURL}/models`; Anthropic
// and Ollama have their own shapes. Errors surface to the caller to display.

import { AIProviderKind, OPENAI_COMPATIBLE, type AIProviderKind as Kind } from "./models";
import { type FetchImpl, resolveFetch } from "./types";

/** Options for a live model lookup. `endpoint` is only used for Ollama. */
export interface FetchModelsOptions {
  kind: Kind;
  apiKey: string;
  /** Ollama base endpoint (e.g. http://localhost:11434). */
  endpoint?: string;
  fetchImpl?: FetchImpl;
}

interface OpenAIModelsResponse {
  data?: Array<{ id?: string | null }> | null;
}
interface OllamaTagsResponse {
  models?: Array<{ name?: string | null }> | null;
}

// A model-list endpoint (Groq, xAI, OpenAI) returns more than chat models —
// speech-to-text, TTS, embeddings, moderation, image generation. These would
// fail a /chat/completions call, so drop the obvious non-chat ids. Conservative
// by design: only clear-cut modalities are removed; anything ambiguous stays.
const NON_CHAT_ID = /whisper|tts|text-to-speech|speech|embed|moderation|rerank|dall-?e|stable-?diffusion|image-?gen|guard|\baudio\b/i;

/** Sort + de-dupe a raw id list, dropping blanks and non-chat models. */
function tidy(ids: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of ids) {
    const id = typeof raw === "string" ? raw.trim() : "";
    if (id.length === 0 || seen.has(id) || NON_CHAT_ID.test(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out.sort((a, b) => a.localeCompare(b));
}

async function readError(response: { text(): Promise<string> }, label: string): Promise<never> {
  const body = (await response.text().catch(() => "")) || `${label} error`;
  throw new Error(body.slice(0, 300));
}

/** Fetch the models the given credential can use. Throws on network/HTTP error
 * or a missing credential; returns a sorted, de-duped list of model ids. */
export async function fetchAvailableModels(
  options: FetchModelsOptions,
): Promise<string[]> {
  const fetchImpl = resolveFetch(options.fetchImpl);
  const label = AIProviderKind.displayName(options.kind);

  // ── Ollama: local daemon, no key, `GET {endpoint}/api/tags` ──────────────
  if (options.kind === "ollama") {
    const endpoint = (options.endpoint ?? "").trim().replace(/\/+$/, "");
    if (endpoint.length === 0) throw new Error("Set the Ollama endpoint first.");
    const response = await fetchImpl(`${endpoint}/api/tags`, { method: "GET" });
    if (!(response.status >= 200 && response.status <= 299)) {
      return readError(response, label);
    }
    const decoded = JSON.parse(await response.text()) as OllamaTagsResponse;
    return tidy((decoded.models ?? []).map((m) => m?.name));
  }

  const key = options.apiKey.trim();
  if (key.length === 0) throw new Error(`Add your ${label} API key first.`);

  // ── Anthropic: `GET /v1/models` with x-api-key + version header ───────────
  if (options.kind === "anthropic") {
    const response = await fetchImpl("https://api.anthropic.com/v1/models?limit=1000", {
      method: "GET",
      headers: {
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
      },
    });
    if (!(response.status >= 200 && response.status <= 299)) {
      return readError(response, label);
    }
    const decoded = JSON.parse(await response.text()) as OpenAIModelsResponse;
    return tidy((decoded.data ?? []).map((m) => m?.id));
  }

  // ── OpenAI-compatible: `GET {baseURL}/models` with Bearer auth ────────────
  const compat = OPENAI_COMPATIBLE[options.kind];
  if (compat == null) throw new Error(`${label} has no model list.`);
  const response = await fetchImpl(`${compat.baseURL}/models`, {
    method: "GET",
    headers: { Authorization: `Bearer ${key}` },
  });
  if (!(response.status >= 200 && response.status <= 299)) {
    return readError(response, label);
  }
  const decoded = JSON.parse(await response.text()) as OpenAIModelsResponse;
  return tidy((decoded.data ?? []).map((m) => m?.id));
}
