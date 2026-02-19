import Foundation

struct OllamaProvider: AIAssistantProvider {
    let kind: AIProviderKind = .ollama

    private let endpoint: URL
    private let model: String
    private let session: URLSession

    init(endpoint: URL, model: String = "llama3.1:8b", session: URLSession = .shared) {
        self.endpoint = endpoint
        self.model = model
        self.session = session
    }

    func recommend(prompt: String, candidateTitles: [String], maxResults: Int) async throws -> [AIMovieRecommendation] {
        let envelope = AIAssistantJSONParser.promptEnvelope(
            userPrompt: prompt,
            candidateTitles: candidateTitles,
            maxResults: maxResults
        )

        let payload = OllamaRequest(
            model: model,
            messages: [.init(role: "user", content: envelope)],
            stream: false
        )

        var request = URLRequest(url: endpoint)
        request.httpMethod = "POST"
        request.timeoutInterval = 60
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(payload)

        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else {
            throw AIAssistantProviderError.invalidResponse
        }
        guard (200...299).contains(http.statusCode) else {
            let errorText = String(data: data, encoding: .utf8) ?? "Ollama error"
            throw AIAssistantProviderError.apiError(errorText)
        }

        let decoded = try JSONDecoder().decode(OllamaResponse.self, from: data)
        guard let content = decoded.message?.content else {
            throw AIAssistantProviderError.invalidResponse
        }
        return AIAssistantJSONParser.parseRecommendations(from: content, maxResults: maxResults)
    }
}

private struct OllamaRequest: Encodable {
    struct Message: Encodable {
        let role: String
        let content: String
    }

    let model: String
    let messages: [Message]
    let stream: Bool
}

private struct OllamaResponse: Decodable {
    struct Message: Decodable {
        let role: String?
        let content: String
    }

    let message: Message?
}
