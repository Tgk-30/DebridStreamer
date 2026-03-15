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
            settings: nil,
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
        try await db.setSetting(key: SettingsKeys.personalizationEnabled, value: "true")
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
            settings: nil,
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

    @Test("Base local context is available even when personalization is disabled")
    func baseContextAvailableWithoutPersonalization() async throws {
        let db = try makeTestDatabase()
        try await db.setSetting(key: SettingsKeys.personalizationEnabled, value: "false")
        try await db.saveMedia(MediaItem(id: "tt200", type: .movie, title: "Context Film", year: 2024))
        try await db.saveWatchHistory(
            WatchHistory(
                id: "wh-ctx",
                mediaId: "tt200",
                progressSeconds: 300,
                durationSeconds: 7200,
                completed: false,
                lastWatched: Date()
            )
        )

        let captureProvider = CapturingProvider()
        let manager = AIAssistantManager(
            providers: [.openAI: captureProvider],
            database: db,
            settings: nil,
            metadataProvider: nil
        )

        _ = await manager.recommend(
            request: AIAssistantRequest(
                prompt: "Recommend something",
                maxResults: 5,
                compareMode: false,
                providers: [.openAI]
            )
        )
        let disabledCandidates = await captureProvider.snapshotCandidates()
        #expect(disabledCandidates.contains("Context Film"))

        try await db.setSetting(key: SettingsKeys.personalizationEnabled, value: "true")
        _ = await manager.recommend(
            request: AIAssistantRequest(
                prompt: "Recommend something else",
                maxResults: 5,
                compareMode: false,
                providers: [.openAI]
            )
        )
        let enabledCandidates = await captureProvider.snapshotCandidates()
        #expect(enabledCandidates.contains("Context Film"))
    }

    @Test("Context changes invalidate recommendation cache")
    func cacheInvalidatesWhenPersonalizationContextChanges() async throws {
        let db = try makeTestDatabase()
        try await db.setSetting(key: SettingsKeys.personalizationEnabled, value: "false")
        try await db.saveMedia(MediaItem(id: "ttctx", type: .movie, title: "Context Shift", year: 2025))
        try await db.saveWatchHistory(
            WatchHistory(
                id: "wh-shift",
                mediaId: "ttctx",
                progressSeconds: 120,
                durationSeconds: 7200,
                completed: false,
                lastWatched: Date()
            )
        )

        let provider = RecordingProvider()
        let manager = AIAssistantManager(
            providers: [.openAI: provider],
            database: db,
            settings: nil,
            metadataProvider: nil
        )

        _ = await manager.recommend(
            request: AIAssistantRequest(
                prompt: "same prompt",
                maxResults: 5,
                compareMode: false,
                providers: [.openAI]
            )
        )

        try await db.setSetting(key: SettingsKeys.personalizationEnabled, value: "true")
        _ = await manager.recommend(
            request: AIAssistantRequest(
                prompt: "same prompt",
                maxResults: 5,
                compareMode: false,
                providers: [.openAI]
            )
        )

        let calls = await provider.snapshots()
        #expect(calls.count == 2)
        #expect(calls[0].contains("Context Shift"))
        #expect(calls[1].contains("Context Shift"))
    }

    @Test("Assistant memory persistence is gated by personalization opt-in")
    func memoryPersistenceRespectsOptIn() async throws {
        let db = try makeTestDatabase()
        let settings = SettingsManager(database: db, secretStore: InMemorySecretStore())
        try await db.setSetting(key: SettingsKeys.personalizationEnabled, value: "false")

        let provider = MockAIProvider(
            kind: .openAI,
            recommendations: [AIMovieRecommendation(title: "Dune", year: 2021, reason: "Epic", score: 0.9)]
        )
        let manager = AIAssistantManager(
            providers: [.openAI: provider],
            database: db,
            settings: settings,
            metadataProvider: nil
        )

        _ = await manager.recommend(
            request: AIAssistantRequest(
                prompt: "recommend sci-fi",
                maxResults: 3,
                compareMode: false,
                providers: [.openAI]
            )
        )
        let disabledChunks = try await db.fetchAssistantMemoryChunks(scope: "default", limit: 20)
        #expect(disabledChunks.isEmpty)

        try await db.setSetting(key: SettingsKeys.personalizationEnabled, value: "true")
        _ = await manager.recommend(
            request: AIAssistantRequest(
                prompt: "recommend sci-fi now",
                maxResults: 3,
                compareMode: false,
                providers: [.openAI]
            )
        )
        let enabledChunks = try await db.fetchAssistantMemoryChunks(scope: "default", limit: 20)
        #expect(enabledChunks.isEmpty == false)
    }

    @Test("Provider usage is persisted into settings usage totals")
    func providerUsagePersistsToSettingsTotals() async throws {
        let db = try makeTestDatabase()
        let settings = SettingsManager(database: db, secretStore: InMemorySecretStore())
        try await db.setSetting(key: SettingsKeys.personalizationEnabled, value: "false")

        let provider = UsageProvider()
        let manager = AIAssistantManager(
            providers: [.openAI: provider],
            database: db,
            settings: settings,
            metadataProvider: nil
        )

        _ = await manager.recommend(
            request: AIAssistantRequest(
                prompt: "recommend",
                maxResults: 3,
                compareMode: false,
                providers: [.openAI]
            )
        )

        #expect(try await settings.getAIUsageTotalInputTokens() == 100)
        #expect(try await settings.getAIUsageTotalOutputTokens() == 50)
        #expect(abs((try await settings.getAIUsageTotalEstimatedCostUSD()) - 0.003) < 0.000001)
    }
}

private struct MockAIProvider: AIAssistantProvider {
    let kind: AIProviderKind
    let recommendations: [AIMovieRecommendation]
    var shouldThrow = false

    func recommend(prompt: String, candidateTitles: [String], maxResults: Int) async throws -> AIProviderRecommendationResult {
        if shouldThrow {
            throw AIAssistantProviderError.apiError("failed")
        }
        return AIProviderRecommendationResult(
            model: "mock-model",
            recommendations: Array(recommendations.prefix(maxResults)),
            rawText: nil,
            usage: nil
        )
    }
}

private actor CapturingProvider: AIAssistantProvider {
    nonisolated let kind: AIProviderKind = .openAI
    private var candidates: [String] = []

    func recommend(prompt: String, candidateTitles: [String], maxResults: Int) async throws -> AIProviderRecommendationResult {
        candidates = candidateTitles
        return AIProviderRecommendationResult(
            model: "capturing-model",
            recommendations: [
                AIMovieRecommendation(
                    title: "Captured",
                    year: 2024,
                    reason: "capture",
                    score: 0.9
                )
            ],
            rawText: nil,
            usage: nil
        )
    }

    func snapshotCandidates() -> [String] {
        candidates
    }
}

private actor RecordingProvider: AIAssistantProvider {
    nonisolated let kind: AIProviderKind = .openAI
    private var calls: [[String]] = []

    func recommend(prompt: String, candidateTitles: [String], maxResults: Int) async throws -> AIProviderRecommendationResult {
        calls.append(candidateTitles)
        return AIProviderRecommendationResult(
            model: "recording-model",
            recommendations: [
                AIMovieRecommendation(
                    title: "Recorded",
                    year: 2025,
                    reason: "Recorded call",
                    score: 0.8
                )
            ],
            rawText: nil,
            usage: nil
        )
    }

    func snapshots() -> [[String]] {
        calls
    }
}

private struct UsageProvider: AIAssistantProvider {
    let kind: AIProviderKind = .openAI

    func recommend(prompt: String, candidateTitles: [String], maxResults: Int) async throws -> AIProviderRecommendationResult {
        AIProviderRecommendationResult(
            model: "gpt-4.1-mini",
            recommendations: [
                AIMovieRecommendation(title: "Usage", year: 2026, reason: "Usage", score: 0.9)
            ],
            rawText: nil,
            usage: AIUsageMetrics(
                inputTokens: 100,
                outputTokens: 50,
                totalTokens: 150,
                estimatedCostUSD: 0.003
            )
        )
    }
}
