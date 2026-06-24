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
  AIUsageMetrics,
} from "./models";
import { makeAIMovieRecommendation } from "./models";
import type { MediaType } from "../../models/media";

// MARK: - Personalized "Would I Like This?" analysis

/** The verdict scale for a personalized title analysis. Mirrors the Swift
 * `AIPersonalizedAnalysis.Verdict` raw values. */
export type AIPersonalizedVerdict =
  | "strong_yes"
  | "yes"
  | "maybe"
  | "no"
  | "strong_no";

/** The allowed verdicts (for clamping a model's free-text guess). */
const PERSONALIZED_VERDICTS: ReadonlySet<string> = new Set<AIPersonalizedVerdict>(
  ["strong_yes", "yes", "maybe", "no", "strong_no"],
);

/** A per-title predicted rating + verdict + personalized blurb + reasons,
 * produced from the user's own taste profile. Mirrors Swift
 * `AIPersonalizedAnalysis`. */
export interface AIPersonalizedAnalysis {
  personalizedDescription: string;
  /** 1-10. */
  predictedRating: number;
  verdict: AIPersonalizedVerdict;
  reasons: string[];
}

/** The compact title context + taste profile passed to `analyzeTitle`. */
export interface AIAnalyzeTitleInput {
  title: string;
  year?: number | null;
  type: MediaType;
  genres: string[];
  overview?: string | null;
  /** A short plain-text taste-profile context (see TasteProfile.buildTasteContext).
   * "" means non-personalized. */
  tasteContext: string;
}

// MARK: - AIAssistantProvider interface

/** Mirrors Swift `AIAssistantProvider`. */
export interface AIAssistantProvider {
  readonly kind: AIProviderKind;
  recommend(
    prompt: string,
    candidateTitles: string[],
    maxResults: number,
  ): Promise<AIProviderRecommendationResult>;
  /** Predict whether the user would like a specific title, personalized from a
   * compact taste-profile context. Optional — callers gate on its presence. */
  analyzeTitle?(input: AIAnalyzeTitleInput): Promise<AIProviderAnalysisResult>;
}

/** The result of a single provider's `analyzeTitle` call — the parsed analysis
 * plus the model id + raw text + usage so the caller can persist a usage record.
 * Mirrors the shape of `AIProviderRecommendationResult`. */
export interface AIProviderAnalysisResult {
  model: string | null;
  analysis: AIPersonalizedAnalysis;
  rawText: string | null;
  usage: AIUsageMetrics | null;
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

/** Hard ceiling on the raw bytes we will read from an AI provider response. The
 * providers (a user-configured Ollama endpoint especially) are untrusted: a
 * malicious/compromised one could stream a multi-MB envelope that would OOM the
 * renderer at `response.text()` / `JSON.parse` before the 200KB content cap ever
 * runs. A legitimate response is a few KB, so this only trips on adversarial
 * input. Defense-in-depth with {@link MAX_AI_RESPONSE_CHARS} at the parser. */
const MAX_AI_RESPONSE_BYTES = 2_000_000;

/** Read a Response body up to `maxBytes`, then stop (cancelling the stream). A
 * Content-Length over the cap is rejected without reading. Falls back to a
 * sliced `.text()` when the body stream isn't exposed. Exported for testing. */
export async function boundedReadText(
  response: Response,
  maxBytes: number,
): Promise<string> {
  const declared = Number(response.headers?.get?.("content-length") ?? "");
  if (Number.isFinite(declared) && declared > maxBytes) {
    try {
      await response.body?.cancel();
    } catch {
      // ignore
    }
    return "";
  }
  const reader = response.body?.getReader?.();
  if (!reader) {
    const text = await response.text();
    return text.length > maxBytes ? text.slice(0, maxBytes) : text;
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      // Only keep up to the remaining budget, so a single oversized chunk can't
      // push `total` past the cap (and the merged buffer is never over-allocated).
      const remaining = maxBytes - total;
      const slice =
        value.byteLength > remaining ? value.subarray(0, remaining) : value;
      chunks.push(slice);
      total += slice.byteLength;
      if (total >= maxBytes) {
        try {
          await reader.cancel();
        } catch {
          // ignore
        }
        break;
      }
    }
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    merged.set(c, offset);
    offset += c.byteLength;
  }
  return new TextDecoder().decode(merged);
}

/** Does this fetch response expose a readable body stream? Real `Response`s
 * (global fetch, the Tauri plugin fetch, appFetch) do; the tiny `{status,text()}`
 * stubs injected by tests do not. */
function hasBodyStream(
  response: unknown,
): response is Response {
  const body = (response as { body?: { getReader?: unknown } } | null)?.body;
  return body != null && typeof body.getReader === "function";
}

/** Resolves a usable fetch and ALWAYS bounds the response body when it's a real
 * streamed `Response` — whether the fetch was injected (production threads in
 * `appFetch`) or the global default. Caps at {@link MAX_AI_RESPONSE_BYTES} so an
 * untrusted/compromised provider can't OOM the renderer before parsing. The
 * small non-streamed test stubs pass through unchanged. */
export function resolveFetch(fetchImpl?: FetchImpl): FetchImpl {
  const base: FetchImpl =
    fetchImpl ?? ((url, init) => fetch(url, init as RequestInit));
  return async (url, init) => {
    const response = await base(url, init);
    if (hasBodyStream(response)) {
      const text = await boundedReadText(response, MAX_AI_RESPONSE_BYTES);
      return { status: response.status, text: async () => text };
    }
    return response;
  };
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

/** Hard cap on the model-response text we will parse. AI providers (notably a
 * user-configured Ollama endpoint) are untrusted: a malicious or compromised one
 * could return a multi-megabyte body, and JSON.parsing / brace-scanning the whole
 * thing would freeze or OOM the renderer. A legitimate recommendation/analysis
 * response is a few KB, so truncating at this cap only affects adversarial input
 * — and the parser already tolerates a truncated tail (salvage). */
const MAX_AI_RESPONSE_CHARS = 200_000;

/** Bound an untrusted model response to {@link MAX_AI_RESPONSE_CHARS} before parsing. */
function capResponse(text: string): string {
  return text.length > MAX_AI_RESPONSE_CHARS
    ? text.slice(0, MAX_AI_RESPONSE_CHARS)
    : text;
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
    rawText: string,
    maxResults: number,
  ): AIMovieRecommendation[] {
    const text = capResponse(rawText);
    const fenceStripped = strippingCodeFences(text);

    // Extract the recommendation objects, tolerating the common shapes a model
    // actually emits: the requested `{recommendations:[...]}`, a bare top-level
    // array `[{...},{...}]`, a single bare object, and output truncated mid-JSON
    // by a max_tokens cutoff (salvage the complete elements, drop the partial
    // tail). Raw text is tried before fence-stripping so JSON whose string
    // values contain literal ``` is not mangled by strippingCodeFences.
    const recs =
      extractRecommendationObjects(text) ??
      extractRecommendationObjects(fenceStripped);
    if (recs != null) {
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
        )
        .filter((r) => r.title.length > 0);
    }

    // If the response was clearly JSON-shaped but unparseable (e.g. truncated
    // with no complete element to salvage), do NOT fall through to the line
    // parser — it would emit the raw JSON blob as a single junk "title". Return
    // nothing instead.
    if (/^\s*[[{]/.test(fenceStripped)) return [];

    // Line fallback for genuine plain-text lists ("1. Inception\n2. ..."): split
    // on newlines, drop blanks + stray code-fence markers, strip list markers.
    const lines = fenceStripped
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !/^```/.test(line));

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

// MARK: - Personalized analysis prompt + parser

/** Builds the shared "Would I Like This?" prompt sent to every provider. Mirrors
 * the Swift `getPersonalizedAnalysis` prompt: a strict-JSON instruction over the
 * title fields, prefixed with the user's taste-profile context when present. */
export function personalizedAnalysisPrompt(input: AIAnalyzeTitleInput): string {
  const kindLabel = input.type === "movie" ? "movie" : "TV show";
  const typeLabel = input.type === "movie" ? "Movie" : "TV Series";
  const yearStr = input.year != null ? ` (${input.year})` : "";
  const genreStr =
    input.genres.length > 0 ? ` Genres: ${input.genres.join(", ")}.` : "";
  const overview = input.overview?.trim();
  const overviewStr =
    overview != null && overview.length > 0 ? ` Synopsis: ${overview}` : "";

  const context = input.tasteContext.trim();
  const contextBlock =
    context.length > 0
      ? `My taste profile:\n${context}\n\n`
      : "I have no recorded taste profile yet; give a balanced, non-personalized take.\n\n";

  return [
    `${contextBlock}Analyze this ${kindLabel} for me personally based on my taste profile:`,
    "",
    `Title: ${input.title}${yearStr}`,
    `Type: ${typeLabel}${genreStr}${overviewStr}`,
    "",
    "Respond with ONLY a JSON object (no markdown, no explanation) with these exact keys:",
    '- "personalizedDescription": A 2-3 sentence description tailored to what I\'d specifically appreciate or dislike about it based on my preferences.',
    '- "predictedRating": A number 1-10 predicting how I\'d rate it.',
    '- "verdict": One of "strong_yes", "yes", "maybe", "no", "strong_no".',
    '- "reasons": An array of 2-4 short bullet points explaining why.',
  ].join("\n");
}

/** The shape a personalized-analysis payload decodes into (all fields tolerant
 * of missing/extra keys — the parser supplies defaults + clamps). */
interface RawAnalysisPayload {
  personalizedDescription?: unknown;
  predictedRating?: unknown;
  verdict?: unknown;
  reasons?: unknown;
}

/**
 * Pure (no-network) parser that turns an AI provider's text response into an
 * `AIPersonalizedAnalysis`. Tolerant of markdown code fences / surrounding prose
 * (reuses `strippingCodeFences` + `firstBalancedJSONObject`), clamps
 * `predictedRating` to 1..10, and normalizes `verdict` to the allowed set
 * (defaulting to "maybe"). Mirrors the Swift `parsePersonalizedAnalysis`.
 */
export function parsePersonalizedAnalysis(rawInput: string): AIPersonalizedAnalysis {
  const raw = capResponse(rawInput);
  const fenceStripped = strippingCodeFences(raw);
  const payload = extractAnalysisPayload(raw, fenceStripped);

  const personalizedDescription =
    typeof payload.personalizedDescription === "string"
      ? payload.personalizedDescription.trim()
      : "";

  const predictedRating = clampRating(payload.predictedRating);
  const verdict = normalizeVerdict(payload.verdict);
  const reasons = normalizeReasons(payload.reasons);

  return { personalizedDescription, predictedRating, verdict, reasons };
}

const ANALYSIS_KEYS = [
  "personalizedDescription",
  "predictedRating",
  "verdict",
  "reasons",
] as const;

/** Pick the analysis payload out of a model response. Scans the RAW text first
 * (so literal ``` inside string values survive — strippingCodeFences would
 * delete them), then the fence-stripped text, and returns the FIRST balanced
 * object that actually decodes to an analysis-shaped payload (has an expected
 * key). Requiring a key prevents a stray example brace in surrounding prose
 * ("e.g. {\"title\":...}") from being mistaken for the analysis object. Falls
 * back to the first parseable object, then the stripped text, then {} → the
 * caller's defaults produce a safe "maybe". */
function extractAnalysisPayload(
  raw: string,
  fenceStripped: string,
): RawAnalysisPayload {
  let firstParseable: RawAnalysisPayload | null = null;
  for (const source of [raw, fenceStripped]) {
    for (const objText of allBalancedJSONObjects(source)) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(objText);
      } catch {
        continue;
      }
      if (parsed == null || typeof parsed !== "object" || Array.isArray(parsed)) {
        continue;
      }
      const obj = parsed as RawAnalysisPayload & Record<string, unknown>;
      if (ANALYSIS_KEYS.some((k) => k in obj)) return obj;
      firstParseable ??= obj;
    }
  }
  if (firstParseable != null) return firstParseable;
  try {
    const parsed = JSON.parse(fenceStripped) as unknown;
    if (parsed != null && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as RawAnalysisPayload;
    }
  } catch {
    // fall through to the empty payload
  }
  return {};
}

/** Coerce a model's rating (number or numeric string) to an integer 1..10,
 * defaulting to 5 when unparseable. */
function clampRating(value: unknown): number {
  let n: number;
  if (typeof value === "number") {
    n = value;
  } else if (typeof value === "string") {
    n = Number.parseFloat(value.trim());
  } else {
    n = Number.NaN;
  }
  if (!Number.isFinite(n)) return 5;
  return Math.min(10, Math.max(1, Math.round(n)));
}

/** Normalize a verdict to the allowed set, defaulting to "maybe". */
function normalizeVerdict(value: unknown): AIPersonalizedVerdict {
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase().replace(/[\s-]+/g, "_");
    if (PERSONALIZED_VERDICTS.has(normalized)) {
      return normalized as AIPersonalizedVerdict;
    }
  }
  return "maybe";
}

/** Normalize `reasons` to a string array (accepts an array of strings, a single
 * string, or array entries with a `text`/`reason` field), dropping blanks. */
function normalizeReasons(value: unknown): string[] {
  const out: string[] = [];
  if (Array.isArray(value)) {
    for (const entry of value) {
      if (typeof entry === "string") {
        const s = entry.trim();
        if (s.length > 0) out.push(s);
      } else if (entry != null && typeof entry === "object") {
        const obj = entry as Record<string, unknown>;
        const s = obj.text ?? obj.reason ?? obj.value;
        if (typeof s === "string" && s.trim().length > 0) out.push(s.trim());
      }
    }
  } else if (typeof value === "string") {
    const s = value.trim();
    if (s.length > 0) out.push(s);
  }
  return out;
}

/** Extracts the recommendation objects from a model's response text, tolerating
 * every shape seen in practice; returns null only when nothing JSON-shaped was
 * found (so the caller can decide between an empty result and a plain-text
 * fallback). Handles: the requested `{recommendations:[...]}`, a bare top-level
 * array `[...]`, a single bare `{...}`, and JSON truncated mid-stream (salvages
 * the complete elements and discards the partial trailing one). */
function extractRecommendationObjects(text: string): RawRecommendation[] | null {
  // 1) Strict parse of the first complete top-level container ({...} or [...]).
  const container = firstBalancedJSONContainer(text);
  if (container != null) {
    try {
      const parsed: unknown = JSON.parse(container);
      const recs = recommendationsFromValue(parsed);
      if (recs != null) return recs;
    } catch {
      // fall through to salvage
    }
  }

  // 2) Salvage: collect every COMPLETE `{...}` object inside the array body.
  // Covers a truncated array (the unfinished tail object is simply skipped).
  const salvaged = salvageRecommendationObjects(text);
  if (salvaged.length > 0) return salvaged;

  return null;
}

/** Interprets a parsed JSON value as a recommendation list: a bare array, a
 * `{recommendations:[...]}` wrapper, or a single recommendation-shaped object.
 * Returns null when the value is none of these. */
function recommendationsFromValue(value: unknown): RawRecommendation[] | null {
  // `typeof x === "object"` is true for arrays AND null, so each element guard
  // must also exclude arrays — otherwise a nested array element (e.g. the model
  // returned `[[{...}],{...}]`) would slip through as a "recommendation", lose
  // its (absent) title, and be silently dropped instead of skipped here.
  if (Array.isArray(value)) {
    return value.filter(isRecommendationObject);
  }
  if (value != null && typeof value === "object") {
    const obj = value as RawPayload & RawRecommendation;
    if (Array.isArray(obj.recommendations)) {
      return obj.recommendations.filter(isRecommendationObject);
    }
    // A single bare recommendation object (the model returned one item).
    if (typeof obj.title === "string") return [obj];
  }
  return null;
}

/** A non-null, non-array object — the only shape a recommendation can take. */
function isRecommendationObject(v: unknown): v is RawRecommendation {
  return v != null && typeof v === "object" && !Array.isArray(v);
}

/** Pulls every complete balanced `{...}` object out of the `recommendations`
 * array body (or a top-level array), parsing each independently so a truncated
 * final element doesn't discard the valid ones before it. Only runs in a genuine
 * recommendations context — a `"recommendations"` key is present, or the whole
 * payload is a bare array — so a stray `[` in unrelated content can't feed us
 * objects from the wrong array. */
function salvageRecommendationObjects(text: string): RawRecommendation[] {
  const recKey = text.indexOf('"recommendations"');
  if (recKey === -1 && !text.trimStart().startsWith("[")) return [];

  let body = text;
  const bracket = text.indexOf("[", recKey === -1 ? 0 : recKey);
  if (bracket !== -1) body = text.slice(bracket + 1);

  const out: RawRecommendation[] = [];
  for (const objText of allBalancedJSONObjects(body)) {
    try {
      const parsed: unknown = JSON.parse(objText);
      if (isRecommendationObject(parsed)) {
        out.push(parsed);
      }
    } catch {
      // skip an unparseable object
    }
  }
  return out;
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

/** Returns the first complete, balanced top-level JSON container — `{...}` OR
 * `[...]`, whichever opens first — tracking depth while respecting string
 * literals/escapes. Lets the recommendations parser accept both the requested
 * object wrapper and a bare top-level array. Returns null if none closes. */
function firstBalancedJSONContainer(text: string): string | null {
  let startIndex: number | null = null;
  let open: "{" | "[" | null = null;
  let close: "}" | "]" | null = null;
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];

    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }

    if (character === '"') {
      inString = true;
      continue;
    }

    if (startIndex == null) {
      if (character === "{" || character === "[") {
        startIndex = index;
        open = character;
        close = character === "{" ? "}" : "]";
        depth = 1;
      }
      continue;
    }

    if (character === open) {
      depth += 1;
    } else if (character === close) {
      depth -= 1;
      if (depth === 0) return text.slice(startIndex, index + 1);
    }
  }

  return null;
}

/** Returns every complete, balanced top-level `{...}` object in `text`, in
 * order, resetting after each. Array brackets are ignored, so scanning the body
 * of `[{a},{b},{trunc` yields `[{a},{b}]` — the complete objects only — which is
 * how truncated recommendation arrays are salvaged. */
function allBalancedJSONObjects(text: string): string[] {
  const out: string[] = [];
  let startIndex: number | null = null;
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];

    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }

    if (character === '"') {
      inString = true;
    } else if (character === "{") {
      if (depth === 0) startIndex = index;
      depth += 1;
    } else if (character === "}") {
      if (depth > 0) {
        depth -= 1;
        if (depth === 0 && startIndex != null) {
          out.push(text.slice(startIndex, index + 1));
          startIndex = null;
        }
      }
    }
  }

  return out;
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
