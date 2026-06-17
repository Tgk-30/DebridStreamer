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

    /// Generic single-shot completion: send `prompt` verbatim, return the model's
    /// raw text. Used by the NL→TMDB-filter mood discovery (which needs a custom
    /// instruction + JSON schema, not the movie-recommendation envelope). A default
    /// implementation routes through `recommend(...).rawText` so any provider that
    /// doesn't override still works.
    func complete(prompt: String) async throws -> String
}

extension AIAssistantProvider {
    func complete(prompt: String) async throws -> String {
        let result = try await recommend(prompt: prompt, candidateTitles: [], maxResults: 1)
        return result.rawText ?? ""
    }
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
        // Strip markdown code fences (```json ... ```) then extract the first
        // BALANCED {...} object via brace counting. This avoids the previous
        // greedy first-`{`-to-last-`}` regex, which mis-parsed responses that
        // contained multiple or nested JSON objects (or trailing prose).
        let fenceStripped = strippingCodeFences(from: text)
        if let json = firstBalancedJSONObject(in: fenceStripped),
           let data = json.data(using: .utf8),
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

    /// Removes surrounding markdown code fences (``` or ```json) so the JSON
    /// inside a fenced block can be extracted. Leaves non-fenced text untouched.
    private static func strippingCodeFences(from text: String) -> String {
        guard text.contains("```") else { return text }
        var result = text
        // Drop the opening fence and an optional language tag on its line.
        if let openRange = result.range(of: #"```[a-zA-Z0-9]*\n?"#, options: .regularExpression) {
            result.removeSubrange(openRange)
        }
        // Drop the closing fence.
        if let closeRange = result.range(of: "```", options: .backwards) {
            result.removeSubrange(closeRange)
        }
        return result
    }

    /// Returns the first complete, balanced `{...}` JSON object found in `text`,
    /// tracking brace depth while respecting string literals and escapes so that
    /// braces inside string values do not throw off the count.
    private static func firstBalancedJSONObject(in text: String) -> String? {
        var startIndex: String.Index?
        var depth = 0
        var inString = false
        var escaped = false

        var index = text.startIndex
        while index < text.endIndex {
            let character = text[index]

            if inString {
                if escaped {
                    escaped = false
                } else if character == "\\" {
                    escaped = true
                } else if character == "\"" {
                    inString = false
                }
            } else {
                switch character {
                case "\"":
                    inString = true
                case "{":
                    if depth == 0 {
                        startIndex = index
                    }
                    depth += 1
                case "}":
                    if depth > 0 {
                        depth -= 1
                        if depth == 0, let start = startIndex {
                            let end = text.index(after: index)
                            return String(text[start..<end])
                        }
                    }
                default:
                    break
                }
            }

            index = text.index(after: index)
        }

        return nil
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
