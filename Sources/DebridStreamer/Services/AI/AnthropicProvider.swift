import Foundation

struct AnthropicProvider: AIAssistantProvider {
    let kind: AIProviderKind = .anthropic

    private let apiKey: String
    private let model: String
    private let session: URLSession

    init(apiKey: String, model: String = "claude-3-5-haiku-latest", session: URLSession = .shared) {
        self.apiKey = apiKey
        self.model = model
        self.session = session
    }

    func recommend(prompt: String, candidateTitles: [String], maxResults: Int) async throws -> AIProviderRecommendationResult {
        let trimmedKey = apiKey.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedKey.isEmpty else {
            throw AIAssistantProviderError.missingAPIKey
        }

        guard let url = URL(string: "https://api.anthropic.com/v1/messages") else {
            throw URLError(.badURL)
        }

        let envelope = AIAssistantJSONParser.promptEnvelope(
            userPrompt: prompt,
            candidateTitles: candidateTitles,
            maxResults: maxResults
        )

        let payload = AnthropicRequest(
            model: model,
            maxTokens: 900,
            temperature: 0.4,
            messages: [.init(role: "user", content: envelope)]
        )

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.timeoutInterval = 45
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue(trimmedKey, forHTTPHeaderField: "x-api-key")
        request.setValue("2023-06-01", forHTTPHeaderField: "anthropic-version")
        request.httpBody = try JSONEncoder().encode(payload)

        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else {
            throw AIAssistantProviderError.invalidResponse
        }
        guard (200...299).contains(http.statusCode) else {
            let errorText = String(data: data, encoding: .utf8) ?? "Anthropic error"
            throw AIAssistantProviderError.apiError(errorText)
        }

        let decoded = try JSONDecoder().decode(AnthropicResponse.self, from: data)
        let text = decoded.content
            .first(where: { $0.type == "text" })?
            .text
        guard let text else {
            throw AIAssistantProviderError.invalidResponse
        }
        let recommendations = AIAssistantJSONParser.parseRecommendations(from: text, maxResults: maxResults)
        let usage = AIUsageMetrics(
            inputTokens: decoded.usage?.inputTokens,
            outputTokens: decoded.usage?.outputTokens,
            totalTokens: [decoded.usage?.inputTokens, decoded.usage?.outputTokens].compactMap { $0 }.reduce(0, +),
            estimatedCostUSD: AIUsageCostEstimator.estimateUSD(
                model: decoded.model ?? model,
                inputTokens: decoded.usage?.inputTokens,
                outputTokens: decoded.usage?.outputTokens,
                totalTokens: [decoded.usage?.inputTokens, decoded.usage?.outputTokens].compactMap { $0 }.reduce(0, +)
            )
        )
        return AIProviderRecommendationResult(
            model: decoded.model ?? model,
            recommendations: recommendations,
            rawText: text,
            usage: usage
        )
    }
}

private struct AnthropicRequest: Encodable {
    struct Message: Encodable {
        let role: String
        let content: String
    }

    let model: String
    let maxTokens: Int
    let temperature: Double
    let messages: [Message]

    enum CodingKeys: String, CodingKey {
        case model
        case maxTokens = "max_tokens"
        case temperature
        case messages
    }
}

private struct AnthropicResponse: Decodable {
    struct Usage: Decodable {
        let inputTokens: Int?
        let outputTokens: Int?

        enum CodingKeys: String, CodingKey {
            case inputTokens = "input_tokens"
            case outputTokens = "output_tokens"
        }
    }

    struct ContentPart: Decodable {
        let type: String
        let text: String?
    }

    let model: String?
    let content: [ContentPart]
    let usage: Usage?
}
