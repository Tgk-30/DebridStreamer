import Foundation

struct OpenAIProvider: AIAssistantProvider {
    let kind: AIProviderKind = .openAI

    private let apiKey: String
    private let model: String
    private let session: URLSession

    init(apiKey: String, model: String = "gpt-4o-mini", session: URLSession = .shared) {
        self.apiKey = apiKey
        self.model = model
        self.session = session
    }

    func recommend(prompt: String, candidateTitles: [String], maxResults: Int) async throws -> AIProviderRecommendationResult {
        let trimmedKey = apiKey.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedKey.isEmpty else {
            throw AIAssistantProviderError.missingAPIKey
        }

        guard let url = URL(string: "https://api.openai.com/v1/chat/completions") else {
            throw URLError(.badURL)
        }

        let envelope = AIAssistantJSONParser.promptEnvelope(
            userPrompt: prompt,
            candidateTitles: candidateTitles,
            maxResults: maxResults
        )

        let payload = OpenAIChatRequest(
            model: model,
            messages: [
                .init(role: "system", content: "You produce concise recommendations in JSON."),
                .init(role: "user", content: envelope)
            ],
            temperature: 0.4
        )

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.timeoutInterval = 45
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(trimmedKey)", forHTTPHeaderField: "Authorization")
        request.httpBody = try JSONEncoder().encode(payload)

        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else {
            throw AIAssistantProviderError.invalidResponse
        }
        guard (200...299).contains(http.statusCode) else {
            let errorText = String(data: data, encoding: .utf8) ?? "OpenAI error"
            throw AIAssistantProviderError.apiError(errorText)
        }

        let decoded: OpenAIChatResponse
        do {
            decoded = try JSONDecoder().decode(OpenAIChatResponse.self, from: data)
        } catch {
            throw AIAssistantProviderError.invalidResponse
        }
        guard let content = decoded.choices.first?.message.content else {
            throw AIAssistantProviderError.invalidResponse
        }
        let recommendations = AIAssistantJSONParser.parseRecommendations(from: content, maxResults: maxResults)
        let usage = AIUsageMetrics(
            inputTokens: decoded.usage?.promptTokens,
            outputTokens: decoded.usage?.completionTokens,
            totalTokens: decoded.usage?.totalTokens,
            estimatedCostUSD: AIUsageCostEstimator.estimateUSD(
                model: decoded.model ?? model,
                inputTokens: decoded.usage?.promptTokens,
                outputTokens: decoded.usage?.completionTokens,
                totalTokens: decoded.usage?.totalTokens
            )
        )
        return AIProviderRecommendationResult(
            model: decoded.model ?? model,
            recommendations: recommendations,
            rawText: content,
            usage: usage
        )
    }

    /// Single-shot completion for the NL→filter mood discovery: sends `prompt`
    /// verbatim and returns the raw text (no recommendation envelope).
    func complete(prompt: String) async throws -> String {
        let trimmedKey = apiKey.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedKey.isEmpty else { throw AIAssistantProviderError.missingAPIKey }
        guard let url = URL(string: "https://api.openai.com/v1/chat/completions") else {
            throw URLError(.badURL)
        }

        let payload = OpenAIChatRequest(
            model: model,
            messages: [
                .init(role: "system", content: "You translate requests into JSON. Reply with JSON only."),
                .init(role: "user", content: prompt)
            ],
            temperature: 0.2
        )

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.timeoutInterval = 45
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(trimmedKey)", forHTTPHeaderField: "Authorization")
        request.httpBody = try JSONEncoder().encode(payload)

        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else {
            throw AIAssistantProviderError.invalidResponse
        }
        guard (200...299).contains(http.statusCode) else {
            throw AIAssistantProviderError.apiError(String(data: data, encoding: .utf8) ?? "OpenAI error")
        }
        let decoded: OpenAIChatResponse
        do {
            decoded = try JSONDecoder().decode(OpenAIChatResponse.self, from: data)
        } catch {
            throw AIAssistantProviderError.invalidResponse
        }
        guard let content = decoded.choices.first?.message.content else {
            throw AIAssistantProviderError.invalidResponse
        }
        return content
    }
}

private struct OpenAIChatRequest: Encodable {
    struct Message: Encodable {
        let role: String
        let content: String
    }

    let model: String
    let messages: [Message]
    let temperature: Double
}

private struct OpenAIChatResponse: Decodable {
    struct Usage: Decodable {
        let promptTokens: Int?
        let completionTokens: Int?
        let totalTokens: Int?

        enum CodingKeys: String, CodingKey {
            case promptTokens = "prompt_tokens"
            case completionTokens = "completion_tokens"
            case totalTokens = "total_tokens"
        }
    }

    struct Choice: Decodable {
        struct Message: Decodable {
            let content: String
        }
        let message: Message
    }

    let model: String?
    let choices: [Choice]
    let usage: Usage?
}
