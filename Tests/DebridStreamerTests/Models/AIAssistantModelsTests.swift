import Testing
import Foundation
@testable import DebridStreamer

@Suite("AIAssistantModels Tests")
struct AIAssistantModelsTests {
    @Test("AI provider kind cases expose IDs and display names consistently")
    func providerKindIdentifiersAndNames() {
        let mappedDisplayNames = Dictionary(
            uniqueKeysWithValues: AIProviderKind.allCases.map { ($0.id, $0.displayName) }
        )

        #expect(mappedDisplayNames["openai"] == "OpenAI")
        #expect(mappedDisplayNames["anthropic"] == "Anthropic")
        #expect(mappedDisplayNames["ollama"] == "Ollama")
        #expect(AIProviderKind.allCases.count == 3)
    }

    @Test("AI provider kind display names map to expected labels")
    func aiProviderKindDisplayNames() {
        let values = [
            AIProviderKind.openAI.displayName,
            AIProviderKind.anthropic.displayName,
            AIProviderKind.ollama.displayName,
        ]

        #expect(values.contains("OpenAI"))
        #expect(values.contains("Anthropic"))
        #expect(values.contains("Ollama"))
    }

    @Test("AIMovieRecommendation derives id from mediaId when present")
    func recommendationIdUsesMediaIdWhenAvailable() {
        let withMediaId = AIMovieRecommendation(
            title: "Arrival",
            year: 2016,
            reason: "Strong score",
            score: 0.93,
            mediaId: "tt123456",
            mediaType: .movie,
            posterPath: "/poster.jpg"
        )

        let withoutMediaId = AIMovieRecommendation(
            title: "Arrival",
            year: 2016,
            reason: "Fallback id",
            score: 0.82,
            mediaId: nil,
            mediaType: .movie,
            posterPath: nil
        )

        #expect(withMediaId.id == "tt123456")
        #expect(withoutMediaId.id == "arrival-2016")
    }

    @Test("AIMovieRecommendation uses fallback id when year is missing")
    func recommendationIdFallsBackToZeroYear() {
        let recommendation = AIMovieRecommendation(
            title: "Unknown",
            year: nil,
            reason: "missing year",
            score: 0.0
        )
        #expect(recommendation.id == "unknown-0")
    }

    @Test("AIMovieRecommendation poster URL includes expected tmdb path")
    func recommendationPosterURL() {
        let noPoster = AIMovieRecommendation(title: "No Poster", reason: "none", score: 1.0)
        #expect(noPoster.posterURL == nil)

        let hasPoster = AIMovieRecommendation(
            title: "Arrival",
            year: 2016,
            reason: "has poster",
            score: 0.5,
            mediaId: nil,
            mediaType: nil,
            posterPath: "/a1b2.jpg"
        )

        #expect(hasPoster.posterURL?.absoluteString == "https://image.tmdb.org/t/p/w342/a1b2.jpg")
    }

    @Test("AI usage metrics safe total tokens clamps negatives to zero and falls back to in/out totals")
    func usageMetricsSafeTotal() {
        let withTotal = AIUsageMetrics(inputTokens: 7, outputTokens: 11, totalTokens: -4)
        #expect(withTotal.safeTotalTokens == 0)

        let withoutTotal = AIUsageMetrics(inputTokens: 7, outputTokens: 11, totalTokens: nil)
        #expect(withoutTotal.safeTotalTokens == 18)

        let withoutInputs = AIUsageMetrics(inputTokens: nil, outputTokens: nil, totalTokens: nil)
        #expect(withoutInputs.safeTotalTokens == 0)
    }

    @Test("AI provider response records rawText and optional error")
    func responseCarriesRawTextAndError() {
        let response = AIProviderResponse(
            provider: .openAI,
            model: "gpt-4.1-mini",
            recommendations: [],
            rawText: "fallback body",
            usage: AIUsageMetrics(inputTokens: 1, outputTokens: 2, totalTokens: 3),
            error: "Rate limit"
        )

        #expect(response.provider == .openAI)
        #expect(response.rawText == "fallback body")
        #expect(response.error == "Rate limit")
        #expect(response.usage?.safeTotalTokens == 3)
    }

    @Test("AI compare result stores usedContext and recommendations")
    func compareResultHoldsMetadata() {
        let recommendation = AIMovieRecommendation(
            title: "Arrival",
            year: 2016,
            reason: "Curated",
            score: 1.0
        )
        let response = AIProviderResponse(provider: .openAI, model: nil, recommendations: [recommendation], rawText: nil, usage: nil)
        let compare = AICompareResult(
            providerResponses: [response],
            mergedRecommendations: [recommendation],
            usedFallback: true,
            generatedAt: Date(timeIntervalSince1970: 1_700_000_000),
            usedContext: ["assistant", "library"]
        )

        #expect(compare.providerResponses.count == 1)
        #expect(compare.mergedRecommendations.count == 1)
        #expect(compare.usedFallback == true)
        #expect(compare.usedContext == ["assistant", "library"])
    }
}
