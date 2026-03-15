import Foundation

struct AIProviderRecommendationResult: Sendable {
    var model: String?
    var recommendations: [AIMovieRecommendation]
    var rawText: String?
    var usage: AIUsageMetrics?
}

protocol AIAssistantProvider: Sendable {
    var kind: AIProviderKind { get }
    func recommend(prompt: String, candidateTitles: [String], maxResults: Int) async throws -> AIProviderRecommendationResult
}

enum AIAssistantProviderError: LocalizedError, Equatable {
    case missingAPIKey
    case invalidResponse
    case apiError(String)

    var errorDescription: String? {
        switch self {
        case .missingAPIKey:
            return "Missing API key."
        case .invalidResponse:
            return "AI provider returned an invalid response."
        case .apiError(let message):
            return message
        }
    }
}

enum AIAssistantJSONParser {
    private struct Payload: Decodable {
        struct Recommendation: Decodable {
            let title: String
            let year: Int?
            let reason: String?
            let score: Double?
        }
        let recommendations: [Recommendation]
    }

    static func parseRecommendations(from text: String, maxResults: Int) -> [AIMovieRecommendation] {
        if let jsonRange = text.range(of: "\\{[\\s\\S]*\\}", options: .regularExpression),
           let data = String(text[jsonRange]).data(using: .utf8),
           let payload = try? JSONDecoder().decode(Payload.self, from: data) {
            return payload.recommendations.prefix(maxResults).map { item in
                AIMovieRecommendation(
                    title: item.title,
                    year: item.year,
                    reason: item.reason ?? "Recommended by AI assistant.",
                    score: item.score ?? 0.5
                )
            }
        }

        let lines = text
            .split(whereSeparator: \.isNewline)
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }

        return lines.prefix(maxResults).enumerated().map { index, line in
            let title = line
                .replacingOccurrences(of: #"^\d+[\).\s-]*"#, with: "", options: .regularExpression)
                .replacingOccurrences(of: #"^[-•\*]\s*"#, with: "", options: .regularExpression)
            return AIMovieRecommendation(
                title: title.isEmpty ? "Recommendation \(index + 1)" : title,
                year: nil,
                reason: "Suggested by AI assistant.",
                score: max(0.0, 1.0 - (Double(index) * 0.1))
            )
        }
    }

    static func estimatedTokenCount(for text: String) -> Int {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return 0 }
        // Rough heuristic for budgeting/usage display when provider does not return official usage.
        return max(1, trimmed.count / 4)
    }

    static func promptEnvelope(userPrompt: String, candidateTitles: [String], maxResults: Int) -> String {
        let candidates = candidateTitles.prefix(30).joined(separator: ", ")
        return """
        You are a movie recommendation assistant.
        Recommend up to \(maxResults) items.
        Use this user intent: \(userPrompt)
        Preferred candidate context (optional): \(candidates)
        Return ONLY JSON in this schema:
        {"recommendations":[{"title":"...","year":2024,"reason":"...","score":0.0}]}
        """
    }
}
