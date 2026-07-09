// Port of Sources/DebridStreamer/Services/AI/OllamaProvider.swift.
//
// A fetch-based Ollama chat provider. Mirrors the Swift struct: POSTs to the
// caller-supplied endpoint with a non-streaming chat request, reads
// `message.content` as the response text, and - because Ollama returns no token
// usage - fills usage from the local heuristic token counter (estimatedCostUSD
// is always 0 for a local model). No API key. The `fetch` implementation is
// injectable so tests stub the network.

import type {
  AIProviderKind,
  AIProviderRecommendationResult,
} from "./models";
import {
  type AIAnalyzeTitleInput,
  AIAssistantJSONParser,
  AIAssistantProviderError,
  type AIProviderAnalysisResult,
  type AIAssistantProvider,
  type FetchImpl,
  parsePersonalizedAnalysis,
  personalizedAnalysisPrompt,
  resolveFetch,
} from "./types";

// MARK: - Request shape (mirrors OllamaRequest)

interface OllamaRequestBody {
  model: string;
  messages: { role: string; content: string }[];
  stream: boolean;
}

// MARK: - Raw response (mirrors OllamaResponse)

interface RawOllamaResponse {
  message?: { role?: string | null; content: string } | null;
}

export class OllamaProvider implements AIAssistantProvider {
  readonly kind: AIProviderKind = "ollama";

  private readonly endpoint: string;
  private readonly model: string;
  private readonly fetchImpl: FetchImpl;

  constructor(endpoint: string, model = "llama3.1:8b", fetchImpl?: FetchImpl) {
    this.endpoint = endpoint;
    this.model = model;
    this.fetchImpl = resolveFetch(fetchImpl);
  }

  async recommend(
    prompt: string,
    candidateTitles: string[],
    maxResults: number,
  ): Promise<AIProviderRecommendationResult> {
    const envelope = AIAssistantJSONParser.promptEnvelope(
      prompt,
      candidateTitles,
      maxResults,
    );

    const payload: OllamaRequestBody = {
      model: this.model,
      messages: [{ role: "user", content: envelope }],
      stream: false,
    };

    const response = await this.fetchImpl(this.endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!(response.status >= 200 && response.status <= 299)) {
      const errorText = (await response.text().catch(() => "")) || "Ollama error";
      throw AIAssistantProviderError.apiError(errorText);
    }

    const decoded = JSON.parse(await response.text()) as RawOllamaResponse;
    const content = decoded.message?.content;
    if (content == null) {
      throw AIAssistantProviderError.invalidResponse();
    }

    const recommendations = AIAssistantJSONParser.parseRecommendations(
      content,
      maxResults,
    );
    const inputTokens = AIAssistantJSONParser.estimatedTokenCount(envelope);
    const outputTokens = AIAssistantJSONParser.estimatedTokenCount(content);

    return {
      model: this.model,
      recommendations,
      rawText: content,
      usage: {
        inputTokens,
        outputTokens,
        totalTokens: inputTokens + outputTokens,
        estimatedCostUSD: 0,
      },
    };
  }

  async analyzeTitle(
    input: AIAnalyzeTitleInput,
  ): Promise<AIProviderAnalysisResult> {
    const prompt = personalizedAnalysisPrompt(input);

    const payload: OllamaRequestBody = {
      model: this.model,
      messages: [{ role: "user", content: prompt }],
      stream: false,
    };

    const response = await this.fetchImpl(this.endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!(response.status >= 200 && response.status <= 299)) {
      const errorText = (await response.text().catch(() => "")) || "Ollama error";
      throw AIAssistantProviderError.apiError(errorText);
    }

    const decoded = JSON.parse(await response.text()) as RawOllamaResponse;
    const content = decoded.message?.content;
    if (content == null) {
      throw AIAssistantProviderError.invalidResponse();
    }

    const analysis = parsePersonalizedAnalysis(content);
    // Ollama returns no token usage - fill from the local heuristic counter
    // (estimatedCostUSD is always 0 for a local model). Mirrors recommend().
    const inputTokens = AIAssistantJSONParser.estimatedTokenCount(prompt);
    const outputTokens = AIAssistantJSONParser.estimatedTokenCount(content);

    return {
      model: this.model,
      analysis,
      rawText: content,
      usage: {
        inputTokens,
        outputTokens,
        totalTokens: inputTokens + outputTokens,
        estimatedCostUSD: 0,
      },
    };
  }
}
