import Foundation

actor AIAssistantManager {
    private let providers: [AIProviderKind: any AIAssistantProvider]
    private let database: DatabaseManager?
    private let settings: SettingsManager?
    private let metadataProvider: (any MetadataProvider)?
    private let contextAssembler: AssistantContextAssembler

    private var cache: [String: (expiresAt: Date, result: AICompareResult)] = [:]
    private let cacheTTL: TimeInterval = 60 * 30

    init(
        providers: [AIProviderKind: any AIAssistantProvider],
        database: DatabaseManager?,
        settings: SettingsManager?,
        metadataProvider: (any MetadataProvider)?
    ) {
        self.providers = providers
        self.database = database
        self.settings = settings
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
        let context = await contextAssembler.buildContext(
            prompt: prompt,
            folderId: request.contextFolderId
        )
        let cacheKey = buildCacheKey(prompt: prompt, request: request, context: context)
        if let cached = cache[cacheKey], cached.expiresAt > Date() {
            return cached.result
        }

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
                        let providerResult = try await provider.recommend(
                            prompt: contextualPrompt,
                            candidateTitles: candidates,
                            maxResults: request.maxResults
                        )
                        await self.recordUsage(providerResult.usage)
                        return AIProviderResponse(
                            provider: kind,
                            model: providerResult.model,
                            recommendations: providerResult.recommendations,
                            rawText: providerResult.rawText,
                            usage: providerResult.usage
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

        let enrichedMerged = await enrichRecommendations(merged)

        let result = AICompareResult(
            providerResponses: providerResponses,
            mergedRecommendations: enrichedMerged,
            usedFallback: usedFallback,
            generatedAt: Date(),
            usedContext: Array(context.contextNotes.prefix(12))
        )

        cache[cacheKey] = (expiresAt: Date().addingTimeInterval(cacheTTL), result: result)
        await persistAssistantMemory(from: prompt, result: result, personalizationEnabled: context.personalizationEnabled)
        return result
    }

    private func buildCacheKey(
        prompt: String,
        request: AIAssistantRequest,
        context: AssistantContext
    ) -> String {
        let providersKey = request.providers.map(\.rawValue).sorted().joined(separator: ",")
        let folderKey = request.contextFolderId ?? "-"
        let contextKey = contextSignature(context)
        return "\(prompt.lowercased())|\(request.maxResults)|\(request.compareMode)|\(providersKey)|\(folderKey)|\(context.personalizationEnabled)|\(contextKey)"
    }

    private func fallbackRecommendations(from candidates: [String], maxResults: Int) -> [AIMovieRecommendation] {
        if candidates.isEmpty {
            return [
                AIMovieRecommendation(
                    title: "Try refreshing Discover",
                    year: nil,
                    reason: "No local context found. Add watch history or library entries to personalize results.",
                    score: 0.4,
                    mediaId: nil,
                    mediaType: nil,
                    posterPath: nil
                )
            ]
        }

        return candidates.prefix(maxResults).enumerated().map { index, title in
            AIMovieRecommendation(
                title: title,
                year: nil,
                reason: "Fallback recommendation based on your watch history, watchlist, and trending titles.",
                score: max(0.1, 1.0 - (Double(index) * 0.08)),
                mediaId: nil,
                mediaType: nil,
                posterPath: nil
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
                score: max(0.1, 1.0 - (Double(index) * 0.05)),
                mediaId: rec.mediaId,
                mediaType: rec.mediaType,
                posterPath: rec.posterPath
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

    private func contextSignature(_ context: AssistantContext) -> String {
        let titles = context.candidateTitles
            .prefix(20)
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() }
        let notes = context.contextNotes
            .prefix(20)
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() }
        return deduplicated(titles + notes).joined(separator: "|")
    }

    private func persistAssistantMemory(
        from prompt: String,
        result: AICompareResult,
        personalizationEnabled: Bool
    ) async {
        guard let database else { return }
        guard personalizationEnabled else { return }
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

    private func recordUsage(_ usage: AIUsageMetrics?) async {
        guard let usage else { return }
        guard let settings else { return }
        try? await settings.addAIUsage(
            inputTokens: usage.inputTokens,
            outputTokens: usage.outputTokens,
            estimatedCostUSD: usage.estimatedCostUSD
        )
    }

    private func enrichRecommendations(_ recommendations: [AIMovieRecommendation]) async -> [AIMovieRecommendation] {
        guard !recommendations.isEmpty else { return recommendations }
        guard metadataProvider != nil || database != nil else { return recommendations }

        var output: [AIMovieRecommendation] = []
        output.reserveCapacity(recommendations.count)

        for recommendation in recommendations {
            if recommendation.posterPath != nil, recommendation.mediaId != nil {
                output.append(recommendation)
                continue
            }

            if let cached = await resolveCachedMedia(for: recommendation) {
                var enriched = recommendation
                enriched.mediaId = cached.id
                enriched.mediaType = cached.type
                enriched.posterPath = cached.posterPath
                if enriched.year == nil {
                    enriched.year = cached.year
                }
                output.append(enriched)
                continue
            }

            guard let metadataProvider else {
                output.append(recommendation)
                continue
            }

            let search = try? await metadataProvider.search(
                query: recommendation.title,
                type: nil,
                page: 1
            )
            guard let preview = chooseBestPreview(search?.items ?? [], recommendation: recommendation) else {
                output.append(recommendation)
                continue
            }

            var enriched = recommendation
            enriched.mediaId = preview.id
            enriched.mediaType = preview.type
            enriched.posterPath = preview.posterPath
            if enriched.year == nil {
                enriched.year = preview.year
            }
            output.append(enriched)
            await savePreviewIfNeeded(preview)
        }

        return output
    }

    private func resolveCachedMedia(for recommendation: AIMovieRecommendation) async -> MediaItem? {
        guard let database else { return nil }
        if let mediaId = recommendation.mediaId,
           let byID = try? await database.fetchMedia(id: mediaId) {
            return byID
        }

        let query = recommendation.title.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !query.isEmpty else { return nil }
        let candidates = (try? await database.searchMedia(query: query, limit: 20)) ?? []
        guard !candidates.isEmpty else { return nil }

        if let withYear = candidates.first(where: {
            normalizeTitle($0.title) == normalizeTitle(recommendation.title)
                && (recommendation.year == nil || $0.year == recommendation.year)
        }) {
            return withYear
        }

        return candidates.first(where: { normalizeTitle($0.title) == normalizeTitle(recommendation.title) }) ?? candidates.first
    }

    private func chooseBestPreview(
        _ items: [MediaPreview],
        recommendation: AIMovieRecommendation
    ) -> MediaPreview? {
        guard !items.isEmpty else { return nil }
        if let year = recommendation.year,
           let exact = items.first(where: { $0.year == year }) {
            return exact
        }
        let normalized = normalizeTitle(recommendation.title)
        if let exactTitle = items.first(where: { normalizeTitle($0.title) == normalized }) {
            return exactTitle
        }
        return items.first
    }

    private func savePreviewIfNeeded(_ preview: MediaPreview) async {
        guard let database else { return }
        guard (try? await database.fetchMedia(id: preview.id)) == nil else { return }

        let media = MediaItem(
            id: preview.id,
            type: preview.type,
            title: preview.title,
            year: preview.year,
            posterPath: preview.posterPath,
            imdbRating: preview.imdbRating,
            tmdbId: preview.tmdbId,
            lastFetched: Date()
        )
        try? await database.saveMedia(media)
    }

    private func normalizeTitle(_ value: String) -> String {
        value
            .folding(options: [.diacriticInsensitive, .caseInsensitive], locale: .current)
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .lowercased()
    }
}
