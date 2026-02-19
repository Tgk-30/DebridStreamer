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

    func recommend(prompt: String, candidateTitles: [String], maxResults: Int) async throws -> [AIMovieRecommendation] {
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

        let decoded = try JSONDecoder().decode(OpenAIChatResponse.self, from: data)
        guard let content = decoded.choices.first?.message.content else {
            throw AIAssistantProviderError.invalidResponse
        }
        return AIAssistantJSONParser.parseRecommendations(from: content, maxResults: maxResults)
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
    struct Choice: Decodable {
        struct Message: Decodable {
            let content: String
        }
        let message: Message
    }

    let choices: [Choice]
}
