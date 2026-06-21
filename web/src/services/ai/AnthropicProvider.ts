// Port of Sources/DebridStreamer/Services/AI/AnthropicProvider.swift.
//
// A fetch-based Anthropic Messages provider. Mirrors the Swift struct: the same
// endpoint/headers/request shape (note `temperature` is intentionally omitted —
// it is rejected by current Claude models), the first text content-part as the
// response text, the usage decoding, and the cost estimate. The `fetch`
// implementation is injectable so tests stub the network (Swift injects a
// URLSession instead).

import type {
  AIProviderKind,
  AIProviderRecommendationResult,
  AIUsageMetrics,
} from "./models";
import {
  AIAssistantJSONParser,
  AIAssistantProviderError,
  AIUsageCostEstimator,
  type AIAssistantProvider,
  type FetchImpl,
  resolveFetch,
  sumTokens,
} from "./types";

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";

// MARK: - Request shape (mirrors AnthropicRequest)

interface AnthropicRequestBody {
  model: string;
  max_tokens: number;
  messages: { role: string; content: string }[];
}

// MARK: - Raw response (mirrors AnthropicResponse, snake_case as the API returns)

interface RawAnthropicUsage {
  input_tokens?: number | null;
  output_tokens?: number | null;
}

interface RawAnthropicContentPart {
  type: string;
  text?: string | null;
}

interface RawAnthropicResponse {
  model?: string | null;
  content: RawAnthropicContentPart[];
  usage?: RawAnthropicUsage | null;
}

export class AnthropicProvider implements AIAssistantProvider {
  readonly kind: AIProviderKind = "anthropic";

  private readonly apiKey: string;
  private readonly model: string;
  private readonly fetchImpl: FetchImpl;

  constructor(
    apiKey: string,
    model = "claude-haiku-4-5",
    fetchImpl?: FetchImpl,
  ) {
    this.apiKey = apiKey;
    this.model = model;
    this.fetchImpl = resolveFetch(fetchImpl);
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

    const payload: AnthropicRequestBody = {
      model: this.model,
      max_tokens: 900,
      messages: [{ role: "user", content: envelope }],
    };

    const response = await this.fetchImpl(ANTHROPIC_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": trimmedKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(payload),
    });

    if (!(response.status >= 200 && response.status <= 299)) {
      const errorText = (await response.text().catch(() => "")) || "Anthropic error";
      throw AIAssistantProviderError.apiError(errorText);
    }

    const decoded = JSON.parse(await response.text()) as RawAnthropicResponse;
    const text = decoded.content.find((part) => part.type === "text")?.text;
    if (text == null) {
      throw AIAssistantProviderError.invalidResponse();
    }

    const recommendations = AIAssistantJSONParser.parseRecommendations(
      text,
      maxResults,
    );

    const resolvedModel = decoded.model ?? this.model;
    const inputTokens = decoded.usage?.input_tokens ?? null;
    const outputTokens = decoded.usage?.output_tokens ?? null;
    const totalTokens = sumTokens(inputTokens, outputTokens);
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
      rawText: text,
      usage,
    };
  }
}
