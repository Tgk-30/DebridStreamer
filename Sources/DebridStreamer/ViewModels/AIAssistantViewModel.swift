import Foundation
import Observation

@MainActor
@Observable
final class AIAssistantViewModel {
    var prompt = ""
    var compareMode = true
    var selectedProviders: Set<AIProviderKind> = []
    var contextFolderId: String?
    var isGenerating = false
    var compareResult: AICompareResult?
    var statusMessage: String?

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
        draftedPrompt: String
    ) async {
        if !draftedPrompt.isEmpty && prompt.isEmpty {
            prompt = draftedPrompt
        }
        if let settings {
            compareMode = (try? await settings.getValue(forKey: SettingsKeys.aiCompareMode)) != "false"
        }
        if selectedProviders.isEmpty {
            let available = await manager?.availableProviders ?? []
            selectedProviders = Set(available)
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

    func generateRecommendations(manager: AIAssistantManager?) async {
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
        statusMessage = result.usedFallback
            ? "AI providers were unavailable, showing local adaptive fallback recommendations."
            : "Personalized recommendations generated."
    }
}

