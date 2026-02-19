import Testing
import Foundation
@testable import DebridStreamer

@Suite("AIAssistantManager Tests")
struct AIAssistantManagerTests {
    @Test("Compare mode returns per-provider and merged recommendations")
    func compareModeMerge() async throws {
        let openAIRec = [
            AIMovieRecommendation(title: "Dune", year: 2021, reason: "Epic", score: 0.9),
            AIMovieRecommendation(title: "Arrival", year: 2016, reason: "Smart", score: 0.8),
        ]
        let anthropicRec = [
            AIMovieRecommendation(title: "Arrival", year: 2016, reason: "Smart", score: 0.9),
            AIMovieRecommendation(title: "Interstellar", year: 2014, reason: "Scale", score: 0.85),
        ]

        let manager = AIAssistantManager(
            providers: [
                .openAI: MockAIProvider(kind: .openAI, recommendations: openAIRec),
                .anthropic: MockAIProvider(kind: .anthropic, recommendations: anthropicRec),
            ],
            database: nil,
            metadataProvider: nil
        )

        let result = await manager.recommend(
            request: AIAssistantRequest(
                prompt: "Recommend sci-fi",
                maxResults: 5,
                compareMode: true,
                providers: [.openAI, .anthropic]
            )
        )

        #expect(result.usedFallback == false)
        #expect(result.providerResponses.count == 2)
        let mergedTitles = Set(result.mergedRecommendations.map(\.title))
        #expect(mergedTitles.contains("Dune"))
        #expect(mergedTitles.contains("Arrival"))
        #expect(mergedTitles.contains("Interstellar"))
    }

    @Test("Fallback recommendations are used when providers fail")
    func fallbackWhenProvidersFail() async throws {
        let db = try makeTestDatabase()
        try await db.saveMedia(MediaItem(id: "tt100", type: .movie, title: "Fallback Title", year: 2025))
        try await db.saveWatchHistory(
            WatchHistory(
                id: "wh-fallback",
                mediaId: "tt100",
                progressSeconds: 300,
                durationSeconds: 5400,
                completed: false,
                lastWatched: Date()
            )
        )

        let manager = AIAssistantManager(
            providers: [.openAI: MockAIProvider(kind: .openAI, recommendations: [], shouldThrow: true)],
            database: db,
            metadataProvider: nil
        )

        let result = await manager.recommend(
            request: AIAssistantRequest(
                prompt: "Anything",
                maxResults: 5,
                compareMode: true,
                providers: [.openAI]
            )
        )

        #expect(result.usedFallback == true)
        #expect(result.mergedRecommendations.isEmpty == false)
        #expect(result.mergedRecommendations.map(\.title).contains("Fallback Title"))
    }
}

private struct MockAIProvider: AIAssistantProvider {
    let kind: AIProviderKind
    let recommendations: [AIMovieRecommendation]
    var shouldThrow = false

    func recommend(prompt: String, candidateTitles: [String], maxResults: Int) async throws -> [AIMovieRecommendation] {
        if shouldThrow {
            throw AIAssistantProviderError.apiError("failed")
        }
        return Array(recommendations.prefix(maxResults))
    }
}
