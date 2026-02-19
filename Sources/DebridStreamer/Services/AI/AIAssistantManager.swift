import Foundation

actor AIAssistantManager {
    private let providers: [AIProviderKind: any AIAssistantProvider]
    private let database: DatabaseManager?
    private let metadataProvider: (any MetadataProvider)?
    private let contextAssembler: AssistantContextAssembler

    private var cache: [String: (expiresAt: Date, result: AICompareResult)] = [:]
    private let cacheTTL: TimeInterval = 60 * 30

    init(
        providers: [AIProviderKind: any AIAssistantProvider],
        database: DatabaseManager?,
        metadataProvider: (any MetadataProvider)?
    ) {
        self.providers = providers
        self.database = database
        self.metadataProvider = metadataProvider
        self.contextAssembler = AssistantContextAssembler(
            database: database,
            metadataProvider: metadataProvider
        )
    }

    var availableProviders: [AIProviderKind] {
        AIProviderKind.allCases.filter { providers[$0] != nil }
    }

    func recommend(request: AIAssistantRequest) async -> AICompareResult {
        let prompt = request.prompt.trimmingCharacters(in: .whitespacesAndNewlines)
        let cacheKey = buildCacheKey(prompt: prompt, request: request)
        if let cached = cache[cacheKey], cached.expiresAt > Date() {
            return cached.result
        }

        let context = await contextAssembler.buildContext(
            prompt: prompt,
            folderId: request.contextFolderId
        )
        let candidates = context.candidateTitles
        let contextualPrompt = combinedPrompt(prompt: prompt, contextNotes: context.contextNotes)
        let providerKinds = request.providers.filter { providers[$0] != nil }
        let effectiveKinds = providerKinds.isEmpty ? availableProviders : providerKinds
        let selectedKinds = request.compareMode ? effectiveKinds : Array(effectiveKinds.prefix(1))

        var providerResponses: [AIProviderResponse] = []

        await withTaskGroup(of: AIProviderResponse?.self) { group in
            for kind in selectedKinds {
                guard let provider = providers[kind] else { continue }
                group.addTask {
                    do {
                        let recommendations = try await provider.recommend(
                            prompt: contextualPrompt,
                            candidateTitles: candidates,
                            maxResults: request.maxResults
                        )
                        return AIProviderResponse(
                            provider: kind,
                            recommendations: recommendations,
                            rawText: nil
                        )
                    } catch {
                        return nil
                    }
                }
            }

            for await response in group {
                if let response {
                    providerResponses.append(response)
                }
            }
        }

        let merged: [AIMovieRecommendation]
        let usedFallback: Bool
        if providerResponses.isEmpty {
            merged = fallbackRecommendations(from: candidates, maxResults: request.maxResults)
            usedFallback = true
        } else if request.compareMode {
            merged = mergeWithRRF(providerResponses: providerResponses, maxResults: request.maxResults)
            usedFallback = false
        } else {
            merged = Array((providerResponses.first?.recommendations ?? []).prefix(request.maxResults))
            usedFallback = false
        }

        let result = AICompareResult(
            providerResponses: providerResponses,
            mergedRecommendations: merged,
            usedFallback: usedFallback,
            generatedAt: Date(),
            usedContext: Array(context.contextNotes.prefix(12))
        )

        cache[cacheKey] = (expiresAt: Date().addingTimeInterval(cacheTTL), result: result)
        await persistAssistantMemory(from: prompt, result: result)
        return result
    }

    private func buildCacheKey(prompt: String, request: AIAssistantRequest) -> String {
        let providersKey = request.providers.map(\.rawValue).sorted().joined(separator: ",")
        return "\(prompt.lowercased())|\(request.maxResults)|\(request.compareMode)|\(providersKey)"
    }

    private func fallbackRecommendations(from candidates: [String], maxResults: Int) -> [AIMovieRecommendation] {
        if candidates.isEmpty {
            return [
                AIMovieRecommendation(
                    title: "Try refreshing Discover",
                    year: nil,
                    reason: "No local context found. Add watch history or library entries to personalize results.",
                    score: 0.4
                )
            ]
        }

        return candidates.prefix(maxResults).enumerated().map { index, title in
            AIMovieRecommendation(
                title: title,
                year: nil,
                reason: "Fallback recommendation based on your watch history, watchlist, and trending titles.",
                score: max(0.1, 1.0 - (Double(index) * 0.08))
            )
        }
    }

    private func mergeWithRRF(providerResponses: [AIProviderResponse], maxResults: Int) -> [AIMovieRecommendation] {
        var scores: [String: Double] = [:]
        var itemByID: [String: AIMovieRecommendation] = [:]
        let k = 60.0

        for response in providerResponses {
            for (index, rec) in response.recommendations.enumerated() {
                let key = rec.id
                scores[key, default: 0] += 1.0 / (k + Double(index + 1))
                if itemByID[key] == nil {
                    itemByID[key] = rec
                }
            }
        }

        let ordered = scores
            .sorted { $0.value > $1.value }
            .prefix(maxResults)
            .compactMap { itemByID[$0.key] }

        return ordered.enumerated().map { index, rec in
            AIMovieRecommendation(
                title: rec.title,
                year: rec.year,
                reason: rec.reason,
                score: max(0.1, 1.0 - (Double(index) * 0.05))
            )
        }
    }

    private func deduplicated(_ values: [String]) -> [String] {
        var seen = Set<String>()
        var output: [String] = []
        for value in values {
            let normalized = value.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !normalized.isEmpty else { continue }
            if seen.insert(normalized.lowercased()).inserted {
                output.append(normalized)
            }
        }
        return output
    }

    private func combinedPrompt(prompt: String, contextNotes: [String]) -> String {
        guard !contextNotes.isEmpty else { return prompt }
        let contextBlock = contextNotes.prefix(20).joined(separator: "\n- ")
        return """
        \(prompt)

        Personalization context:
        - \(contextBlock)
        """
    }

    private func persistAssistantMemory(from prompt: String, result: AICompareResult) async {
        guard let database else { return }
        guard !result.mergedRecommendations.isEmpty else { return }

        let top = result.mergedRecommendations.prefix(3)
        let summary = top.map { $0.title }.joined(separator: ", ")
        let chunk = AssistantMemoryChunk(
            id: "mem-\(UUID().uuidString)",
            scope: "default",
            content: "Prompt: \(prompt)\nRecommendations: \(summary)",
            summary: "For '\(prompt)', suggested: \(summary)",
            tags: top.map { $0.title.lowercased() },
            importance: result.usedFallback ? 0.3 : 0.7,
            createdAt: Date(),
            lastAccessedAt: Date()
        )
        try? await database.saveAssistantMemoryChunk(chunk)
    }
}
