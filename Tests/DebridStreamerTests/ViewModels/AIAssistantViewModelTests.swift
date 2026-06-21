import Testing
import Foundation
@testable import DebridStreamer

@Suite("AIAssistantViewModel Tests")
@MainActor
struct AIAssistantViewModelTests {
    @Test("Usage summary tracks baseline and post-initialize increments")
    func usageSummaryRespectsSessionBaseline() async throws {
        let db = try makeTestDatabase()
        let settings = SettingsManager(database: db, secretStore: InMemorySecretStore())
        let manager = AIAssistantManager(
            providers: [:],
            database: db,
            settings: settings,
            metadataProvider: nil
        )

        let viewModel = AIAssistantViewModel()
        await viewModel.initialize(
            manager: manager,
            settings: settings,
            draftedPrompt: "",
            sessionStart: Date()
        )
        #expect(viewModel.usageSummary.sessionTokens == 0)
        #expect(viewModel.usageSummary.lifetimeTokens == 0)

        try await settings.addAIUsage(inputTokens: 80, outputTokens: 20, estimatedCostUSD: 0.004)
        await viewModel.refreshUsageSummary(settings: settings)

        #expect(viewModel.usageSummary.sessionTokens == 100)
        #expect(viewModel.usageSummary.lifetimeTokens == 100)
        #expect(abs(viewModel.usageSummary.sessionEstimatedCostUSD - 0.004) < 0.000001)
    }

    @Test("Generate recommendations refreshes usage totals and compare result")
    func generateRefreshesUsage() async throws {
        let db = try makeTestDatabase()
        let settings = SettingsManager(database: db, secretStore: InMemorySecretStore())
        let manager = AIAssistantManager(
            providers: [.openAI: UsageProvider()],
            database: db,
            settings: settings,
            metadataProvider: nil
        )

        let viewModel = AIAssistantViewModel()
        await viewModel.initialize(
            manager: manager,
            settings: settings,
            draftedPrompt: "test prompt",
            sessionStart: Date()
        )

        viewModel.compareMode = false
        viewModel.selectedProviders = [.openAI]
        await viewModel.generateRecommendations(manager: manager, settings: settings)

        #expect(viewModel.compareResult != nil)
        #expect(viewModel.usageSummary.lifetimeTokens == 200)
        #expect(viewModel.usageSummary.sessionTokens == 200)
        #expect(abs(viewModel.usageSummary.lifetimeEstimatedCostUSD - 0.005) < 0.000001)
    }
}

private struct UsageProvider: AIAssistantProvider {
    let kind: AIProviderKind = .openAI

    func recommend(prompt: String, candidateTitles: [String], maxResults: Int) async throws -> AIProviderRecommendationResult {
        AIProviderRecommendationResult(
            model: "gpt-4.1-mini",
            recommendations: [
                AIMovieRecommendation(
                    title: "The Matrix",
                    year: 1999,
                    reason: "Classic sci-fi pick",
                    score: 0.95
                )
            ],
            rawText: nil,
            usage: AIUsageMetrics(
                inputTokens: 120,
                outputTokens: 80,
                totalTokens: 200,
                estimatedCostUSD: 0.005
            )
        )
    }
}
