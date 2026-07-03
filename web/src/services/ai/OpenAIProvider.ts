// Port of Sources/DebridStreamer/Services/AI/OpenAIProvider.swift.
//
// A fetch-based OpenAI Chat Completions provider. Mirrors the Swift struct: the
// same endpoint, Bearer auth, the system+user message pair, `temperature: 0.4`,
// the first choice's message content as the response text, the prompt/completion
// token usage decoding, and the cost estimate. The `fetch` implementation is
// injectable so tests stub the network.

import type {
  AIProviderKind,
  AIProviderRecommendationResult,
  AIUsageMetrics,
} from "./models";
import {
  type AIAnalyzeTitleInput,
  AIAssistantJSONParser,
  AIAssistantProviderError,
  type AIProviderAnalysisResult,
  AIUsageCostEstimator,
  type AIAssistantProvider,
  type FetchImpl,
  parsePersonalizedAnalysis,
  personalizedAnalysisPrompt,
  resolveFetch,
} from "./types";

const DEFAULT_BASE_URL = "https://api.openai.com/v1";

/** Config for pointing this provider at an OpenAI-compatible host (Gemini,
 * Groq, OpenRouter, Mistral, DeepSeek, xAI). Omit for stock OpenAI. */
export interface OpenAICompatConfig {
  /** Base URL WITHOUT a trailing `/chat/completions` (e.g. https://api.groq.com/openai/v1). */
  baseURL?: string;
  /** The kind this instance reports (drives usage records + display). */
  kind?: AIProviderKind;
  /** Human-facing name used in error messages ("Groq error"). */
  label?: string;
  /** Default model when the user hasn't chosen one. */
  defaultModel?: string;
}

// MARK: - Request shape (mirrors OpenAIChatRequest)

interface OpenAIChatRequestBody {
  model: string;
  messages: { role: string; content: string }[];
  temperature: number;
}

// MARK: - Raw response (mirrors OpenAIChatResponse, snake_case usage fields)

interface RawOpenAIUsage {
  prompt_tokens?: number | null;
  completion_tokens?: number | null;
  total_tokens?: number | null;
}

interface RawOpenAIChoice {
  message: { content: string };
}

interface RawOpenAIChatResponse {
  model?: string | null;
  choices: RawOpenAIChoice[];
  usage?: RawOpenAIUsage | null;
}

export class OpenAIProvider implements AIAssistantProvider {
  readonly kind: AIProviderKind;

  private readonly apiKey: string;
  private readonly model: string;
  private readonly fetchImpl: FetchImpl;
  private readonly chatURL: string;
  private readonly label: string;

  constructor(
    apiKey: string,
    model?: string,
    fetchImpl?: FetchImpl,
    config?: OpenAICompatConfig,
  ) {
    this.apiKey = apiKey;
    const chosen = model?.trim();
    this.model =
      chosen != null && chosen.length > 0
        ? chosen
        : config?.defaultModel ?? "gpt-4o-mini";
    this.fetchImpl = resolveFetch(fetchImpl);
    this.chatURL = `${config?.baseURL ?? DEFAULT_BASE_URL}/chat/completions`;
    this.kind = config?.kind ?? "openai";
    this.label = config?.label ?? "OpenAI";
  }

  async recommend(
    prompt: string,
    candidateTitles: string[],
    maxResults: number,
  ): Promise<AIProviderRecommendationResult> {
    const trimmedKey = this.apiKey.trim();
    if (trimmedKey.length === 0) {
      throw AIAssistantProviderError.missingAPIKey();
    }

    const envelope = AIAssistantJSONParser.promptEnvelope(
      prompt,
      candidateTitles,
      maxResults,
    );

    const payload: OpenAIChatRequestBody = {
      model: this.model,
      messages: [
        {
          role: "system",
          content: "You produce concise recommendations in JSON.",
        },
        { role: "user", content: envelope },
      ],
      temperature: 0.4,
    };

    const response = await this.fetchImpl(this.chatURL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${trimmedKey}`,
      },
      body: JSON.stringify(payload),
    });

    if (!(response.status >= 200 && response.status <= 299)) {
      const errorText = (await response.text().catch(() => "")) || `${this.label} error`;
      throw AIAssistantProviderError.apiError(errorText);
    }

    const decoded = JSON.parse(await response.text()) as RawOpenAIChatResponse;
    const content = decoded.choices?.[0]?.message?.content;
    if (content == null) {
      throw AIAssistantProviderError.invalidResponse();
    }

    const recommendations = AIAssistantJSONParser.parseRecommendations(
      content,
      maxResults,
    );

    const resolvedModel = decoded.model ?? this.model;
    const inputTokens = decoded.usage?.prompt_tokens ?? null;
    const outputTokens = decoded.usage?.completion_tokens ?? null;
    const totalTokens = decoded.usage?.total_tokens ?? null;
    const usage: AIUsageMetrics = {
      inputTokens,
      outputTokens,
      totalTokens,
      estimatedCostUSD: AIUsageCostEstimator.estimateUSD(
        resolvedModel,
        inputTokens,
        outputTokens,
        totalTokens,
      ),
    };

    return {
      model: resolvedModel,
      recommendations,
      rawText: content,
      usage,
    };
  }

  async analyzeTitle(
    input: AIAnalyzeTitleInput,
  ): Promise<AIProviderAnalysisResult> {
    const trimmedKey = this.apiKey.trim();
    if (trimmedKey.length === 0) {
      throw AIAssistantProviderError.missingAPIKey();
    }

    const prompt = personalizedAnalysisPrompt(input);

    const payload: OpenAIChatRequestBody = {
      model: this.model,
      messages: [
        {
          role: "system",
          content:
            "You produce a single, strict JSON object analyzing a title for the user.",
        },
        { role: "user", content: prompt },
      ],
      temperature: 0.4,
    };

    const response = await this.fetchImpl(this.chatURL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${trimmedKey}`,
      },
      body: JSON.stringify(payload),
    });

    if (!(response.status >= 200 && response.status <= 299)) {
      const errorText = (await response.text().catch(() => "")) || `${this.label} error`;
      throw AIAssistantProviderError.apiError(errorText);
    }

    const decoded = JSON.parse(await response.text()) as RawOpenAIChatResponse;
    const content = decoded.choices?.[0]?.message?.content;
    if (content == null) {
      throw AIAssistantProviderError.invalidResponse();
    }

    const analysis = parsePersonalizedAnalysis(content);

    const resolvedModel = decoded.model ?? this.model;
    const inputTokens = decoded.usage?.prompt_tokens ?? null;
    const outputTokens = decoded.usage?.completion_tokens ?? null;
    const totalTokens = decoded.usage?.total_tokens ?? null;

    return {
      model: resolvedModel,
      analysis,
      rawText: content,
      usage: {
        inputTokens,
        outputTokens,
        totalTokens,
        estimatedCostUSD: AIUsageCostEstimator.estimateUSD(
          resolvedModel,
          inputTokens,
          outputTokens,
          totalTokens,
        ),
      },
    };
  }
}
