import Foundation

enum AIProviderKind: String, Codable, CaseIterable, Sendable, Identifiable {
    case openAI = "openai"
    case anthropic = "anthropic"
    case ollama = "ollama"

    var id: String { rawValue }

    var displayName: String {
        switch self {
        case .openAI:
            return "OpenAI"
        case .anthropic:
            return "Anthropic"
        case .ollama:
            return "Ollama"
        }
    }
}

struct AIAssistantRequest: Sendable {
    var prompt: String
    var maxResults: Int
    var compareMode: Bool
    var providers: [AIProviderKind]
    var contextFolderId: String? = nil
}

struct AIMovieRecommendation: Codable, Sendable, Equatable, Identifiable {
    var id: String {
        if let mediaId, !mediaId.isEmpty {
            return mediaId
        }
        return "\(title.lowercased())-\(year ?? 0)"
    }

    var title: String
    var year: Int?
    var reason: String
    var score: Double
    var mediaId: String? = nil
    var mediaType: MediaType? = nil
    var posterPath: String? = nil

    var posterURL: URL? {
        guard let posterPath else { return nil }
        return URL(string: "https://image.tmdb.org/t/p/w342\(posterPath)")
    }
}

struct AIUsageMetrics: Codable, Sendable, Equatable {
    var inputTokens: Int?
    var outputTokens: Int?
    var totalTokens: Int?
    var estimatedCostUSD: Double?

    var safeTotalTokens: Int {
        if let totalTokens {
            return max(0, totalTokens)
        }
        return max(0, (inputTokens ?? 0) + (outputTokens ?? 0))
    }
}

struct AIProviderResponse: Codable, Sendable {
    var provider: AIProviderKind
    var model: String?
    var recommendations: [AIMovieRecommendation]
    var rawText: String?
    var usage: AIUsageMetrics?
    var error: String? = nil
}

struct AIUsageSummary: Sendable, Equatable {
    var sessionEstimatedCostUSD: Double
    var lifetimeEstimatedCostUSD: Double
    var sessionTokens: Int
    var lifetimeTokens: Int
}

struct AICompareResult: Codable, Sendable {
    var providerResponses: [AIProviderResponse]
    var mergedRecommendations: [AIMovieRecommendation]
    var usedFallback: Bool
    var generatedAt: Date
    var usedContext: [String] = []
}
