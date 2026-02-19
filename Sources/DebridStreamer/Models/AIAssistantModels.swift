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
        "\(title.lowercased())-\(year ?? 0)"
    }

    var title: String
    var year: Int?
    var reason: String
    var score: Double
}

struct AIProviderResponse: Codable, Sendable {
    var provider: AIProviderKind
    var recommendations: [AIMovieRecommendation]
    var rawText: String?
}

struct AICompareResult: Codable, Sendable {
    var providerResponses: [AIProviderResponse]
    var mergedRecommendations: [AIMovieRecommendation]
    var usedFallback: Bool
    var generatedAt: Date
    var usedContext: [String] = []
}
