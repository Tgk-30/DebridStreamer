import Testing
import Foundation
@testable import DebridStreamer

@Suite("AIAssistantViewModel Tests")
@MainActor
struct AIAssistantViewModelTests {
    @Test("Initialize applies drafted prompt and sets compare mode from settings")
    func initializeSetsDraftedPromptAndSettings() async throws {
        let db = try makeTestDatabase()
        let settings = SettingsManager(database: db, secretStore: InMemorySecretStore())
        try await settings.setValue("false", forKey: SettingsKeys.aiCompareMode)
        try await settings.setPersonalizationEnabled(false)
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
            draftedPrompt: "draft for test",
            sessionStart: Date()
        )

        #expect(viewModel.prompt == "draft for test")
        #expect(viewModel.compareMode == false)
        #expect(viewModel.selectedProviders == Set([.openAI]))
        #expect(viewModel.personalizationEnabled == false)
        #expect(
            viewModel.statusMessage ==
            "Personalization is disabled. Recommendations use prompt-only context until enabled in Settings."
        )
    }

    @Test("clear resets prompt and state")
    func clearResetsWorkingState() async throws {
        let viewModel = AIAssistantViewModel()
        viewModel.prompt = "before clear"
        viewModel.compareResult = AICompareResult(
            providerResponses: [],
            mergedRecommendations: [AIMovieRecommendation(title: "Test", year: 2024, reason: "x", score: 0.9)],
            usedFallback: false,
            generatedAt: Date()
        )
        viewModel.statusMessage = "something"

        viewModel.clear()

        #expect(viewModel.prompt == "")
        #expect(viewModel.compareResult == nil)
        #expect(viewModel.statusMessage == nil)
    }

    @Test("toggleProvider adds and removes provider")
    func toggleProviderAddsAndRemovesProvider() async throws {
        let viewModel = AIAssistantViewModel()
        #expect(viewModel.selectedProviders.isEmpty)

        viewModel.toggleProvider(.openAI)
        #expect(viewModel.selectedProviders == Set([.openAI]))

        viewModel.toggleProvider(.openAI)
        #expect(viewModel.selectedProviders.isEmpty)
    }

    @Test("applyQuickPrompt sets current prompt")
    func applyQuickPromptUpdatesPrompt() async throws {
        let viewModel = AIAssistantViewModel()
        viewModel.applyQuickPrompt("quick pick")
        #expect(viewModel.prompt == "quick pick")
    }

    @Test("refreshing usage summary with nil settings resets values")
    func refreshUsageSummaryResetsWhenSettingsMissing() async {
        let viewModel = AIAssistantViewModel()
        viewModel.usageSummary = AIUsageSummary(
            sessionEstimatedCostUSD: 1.0,
            lifetimeEstimatedCostUSD: 1.0,
            sessionTokens: 50,
            lifetimeTokens: 200
        )

        await viewModel.refreshUsageSummary(settings: nil)

        #expect(viewModel.usageSummary.sessionEstimatedCostUSD == 0)
        #expect(viewModel.usageSummary.lifetimeEstimatedCostUSD == 0)
        #expect(viewModel.usageSummary.sessionTokens == 0)
        #expect(viewModel.usageSummary.lifetimeTokens == 0)
    }

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

    @Test("Generate recommendations requires an initialized manager")
    func generateRecommendationsRequiresManager() async throws {
        let viewModel = AIAssistantViewModel()
        viewModel.prompt = "anything"

        await viewModel.generateRecommendations(manager: nil, settings: nil)
        #expect(viewModel.statusMessage == "AI assistant is not initialized.")
        #expect(viewModel.compareResult == nil)
    }

    @Test("Generate recommendations no-op when prompt is blank")
    func generateRecommendationsRequiresPromptContent() async throws {
        let db = try makeTestDatabase()
        let settings = SettingsManager(database: db, secretStore: InMemorySecretStore())
        try await settings.setPersonalizationEnabled(true)
        let manager = AIAssistantManager(
            providers: [.openAI: UsageProvider()],
            database: db,
            settings: settings,
            metadataProvider: nil
        )

        let seeded = AICompareResult(
            providerResponses: [],
            mergedRecommendations: [AIMovieRecommendation(title: "Seed", year: 2020, reason: "Seed result", score: 0.4)],
            usedFallback: false,
            generatedAt: Date(),
            usedContext: ["seeded"]
        )
        let viewModel = AIAssistantViewModel()
        await viewModel.initialize(
            manager: manager,
            settings: settings,
            draftedPrompt: "",
            sessionStart: Date()
        )
        viewModel.compareResult = seeded

        viewModel.prompt = "   "
        await viewModel.generateRecommendations(manager: manager, settings: settings)

        #expect(viewModel.compareResult != nil)
        #expect(viewModel.compareResult?.mergedRecommendations == seeded.mergedRecommendations)
        #expect(viewModel.compareResult?.usedFallback == seeded.usedFallback)
        #expect(viewModel.compareResult?.usedContext == seeded.usedContext)
        #expect(viewModel.statusMessage == nil)
    }

    @Test("Generate recommendations falls back to local context when manager has no active providers")
    func generateRecommendationsFallsBackToLocalContext() async throws {
        let db = try makeTestDatabase()
        try await db.saveMedia(
            MediaItem(id: "tt-fallback", type: .movie, title: "Fallback Library Item", year: 2024)
        )
        try await db.setSetting(key: SettingsKeys.personalizationEnabled, value: "true")
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
        viewModel.prompt = "recommend"
        viewModel.selectedProviders = [.openAI]

        await viewModel.generateRecommendations(manager: manager, settings: settings)

        #expect(viewModel.compareResult?.usedFallback == true)
        #expect(viewModel.statusMessage == "AI providers were unavailable, showing local adaptive fallback recommendations.")
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
