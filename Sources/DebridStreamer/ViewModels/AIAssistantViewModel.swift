import Foundation
import Observation

@MainActor
@Observable
final class AIAssistantViewModel {
    var prompt = ""
    var compareMode = true
    var selectedProviders: Set<AIProviderKind> = []
    var contextFolderId: String?
    var personalizationEnabled = false
    var isGenerating = false
    var compareResult: AICompareResult?
    var statusMessage: String?
    var usageSummary = AIUsageSummary(
        sessionEstimatedCostUSD: 0,
        lifetimeEstimatedCostUSD: 0,
        sessionTokens: 0,
        lifetimeTokens: 0
    )
    private var usageSessionBaseline: (input: Int, output: Int, cost: Double)?

    let quickPromptChips: [String] = [
        "What should I watch tonight based on my recent history?",
        "Recommend 5 underrated sci-fi thrillers.",
        "Give me a cozy weekend watchlist.",
        "Suggest something like my current folder picks.",
        "What should I avoid based on my recent dislikes?"
    ]

    func initialize(
        manager: AIAssistantManager?,
        settings: SettingsManager?,
        draftedPrompt: String,
        sessionStart: Date
    ) async {
        if !draftedPrompt.isEmpty && prompt.isEmpty {
            prompt = draftedPrompt
        }
        if let settings {
            compareMode = (try? await settings.getValue(forKey: SettingsKeys.aiCompareMode)) != "false"
            personalizationEnabled = (try? await settings.isPersonalizationEnabled()) == true
        }
        if selectedProviders.isEmpty {
            let available = await manager?.availableProviders ?? []
            selectedProviders = Set(available)
        }

        _ = sessionStart
        await refreshUsageSummary(settings: settings)

        if !personalizationEnabled {
            statusMessage = "Personalization is disabled. Recommendations use prompt-only context until enabled in Settings."
        }
    }

    func toggleProvider(_ provider: AIProviderKind) {
        if selectedProviders.contains(provider) {
            selectedProviders.remove(provider)
        } else {
            selectedProviders.insert(provider)
        }
    }

    func applyQuickPrompt(_ value: String) {
        prompt = value
    }

    func clear() {
        compareResult = nil
        statusMessage = nil
        prompt = ""
    }

    func generateRecommendations(
        manager: AIAssistantManager?,
        settings: SettingsManager?
    ) async {
        guard let manager else {
            statusMessage = "AI assistant is not initialized."
            return
        }
        let trimmedPrompt = prompt.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedPrompt.isEmpty else { return }

        isGenerating = true
        defer { isGenerating = false }

        let providers = selectedProviders.isEmpty ? AIProviderKind.allCases : Array(selectedProviders)
        let result = await manager.recommend(
            request: AIAssistantRequest(
                prompt: trimmedPrompt,
                maxResults: 12,
                compareMode: compareMode,
                providers: providers,
                contextFolderId: contextFolderId
            )
        )

        compareResult = result
        if result.usedFallback {
            statusMessage = "AI providers were unavailable, showing local adaptive fallback recommendations."
        } else if personalizationEnabled {
            statusMessage = "Personalized recommendations generated."
        } else {
            statusMessage = "Recommendations generated. Enable personalization for adaptive context."
        }

        await refreshUsageSummary(settings: settings)
    }

    func refreshUsageSummary(settings: SettingsManager?) async {
        guard let settings else {
            usageSummary = AIUsageSummary(
                sessionEstimatedCostUSD: 0,
                lifetimeEstimatedCostUSD: 0,
                sessionTokens: 0,
                lifetimeTokens: 0
            )
            return
        }

        let totalInput = (try? await settings.getAIUsageTotalInputTokens()) ?? 0
        let totalOutput = (try? await settings.getAIUsageTotalOutputTokens()) ?? 0
        let totalCost = (try? await settings.getAIUsageTotalEstimatedCostUSD()) ?? 0
        let totalTokens = max(0, totalInput + totalOutput)

        if usageSessionBaseline == nil {
            usageSessionBaseline = (totalInput, totalOutput, totalCost)
        }
        let baseline = usageSessionBaseline ?? (0, 0, 0)
        let sessionTokens = max(0, (totalInput - baseline.input) + (totalOutput - baseline.output))
        let sessionCost = max(0, totalCost - baseline.cost)

        usageSummary = AIUsageSummary(
            sessionEstimatedCostUSD: sessionCost,
            lifetimeEstimatedCostUSD: max(0, totalCost),
            sessionTokens: sessionTokens,
            lifetimeTokens: totalTokens
        )
    }
}
