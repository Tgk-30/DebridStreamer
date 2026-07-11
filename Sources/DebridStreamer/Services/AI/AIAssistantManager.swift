import Foundation

actor AIAssistantManager {
    private let providers: [AIProviderKind: any AIAssistantProvider]
    private let database: DatabaseManager?
    private let settings: SettingsManager?
    private let metadataProvider: (any MetadataProvider)?
    private let contextAssembler: AssistantContextAssembler

    private var cache: [String: (expiresAt: Date, result: AICompareResult)] = [:]
    private let cacheTTL: TimeInterval = 60 * 30
    private let cacheCapacity = 200

    /// Small in-memory cache for "Would I like this?" verdicts, keyed by media id
    /// + personalization flag. Shares the recommendation cache's 30-minute TTL and
    /// capacity so a repeat tap within the window returns instantly.
    private var affinityCache: [String: (expiresAt: Date, result: AIAffinityVerdict)] = [:]

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

    /// Whether any AI provider is configured. Used by the UI to gate the mood
    /// discovery entry (it requires both an AI provider AND a TMDB key).
    var hasAnyProvider: Bool {
        !availableProviders.isEmpty
    }

    // MARK: - NL → TMDB discover filters (mood/keyword discovery)

    enum DiscoverPlanError: LocalizedError {
        case noProvider
        case noMetadataProvider
        case modelUnparseable

        var errorDescription: String? {
            switch self {
            case .noProvider: return "No AI provider is configured. Add one in Settings."
            case .noMetadataProvider: return "TMDB is not configured. Add your API key in Settings."
            case .modelUnparseable: return "The assistant couldn't turn that into a search. Try rephrasing."
            }
        }
    }

    /// Translate a free-text "vibe" into a concrete TMDB `/discover` plan.
    ///
    /// Flow: pick the first available provider → ask it (via `complete`) for a
    /// small filter JSON keyed off the real TMDB genre vocabulary → parse with the
    /// balanced-JSON parser → resolve genre *names* to ids and keyword *names* to
    /// TMDB keyword ids (`searchKeywords`). Fully fault-tolerant: an unparseable
    /// model reply throws `.modelUnparseable`, and keyword resolution failures are
    /// simply dropped (the plan still works with whatever resolved).
    func discoverFilters(from vibe: String) async throws -> AIDiscoverPlan {
        let trimmed = vibe.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let kind = availableProviders.first, let provider = providers[kind] else {
            throw DiscoverPlanError.noProvider
        }
        guard let metadataProvider else {
            throw DiscoverPlanError.noMetadataProvider
        }

        // Default to movie genres for the prompt vocabulary; if the model picks TV
        // we re-resolve against TV genres below.
        let movieGenres = (try? await metadataProvider.getGenres(type: .movie)) ?? []
        let prompt = AIDiscoverPlanParser.prompt(for: trimmed, genreNames: movieGenres.map(\.name))

        let raw = try await provider.complete(prompt: prompt)
        await recordUsage(AIUsageMetrics(
            inputTokens: AIAssistantJSONParser.estimatedTokenCount(for: prompt),
            outputTokens: AIAssistantJSONParser.estimatedTokenCount(for: raw),
            totalTokens: nil,
            estimatedCostUSD: nil
        ))

        guard let plan = AIDiscoverPlanParser.parse(raw) else {
            throw DiscoverPlanError.modelUnparseable
        }

        let mediaType: MediaType = (plan.mediaType?.lowercased() == "tv") ? .series : .movie
        let genreCatalog: [Genre]
        if mediaType == .series {
            genreCatalog = (try? await metadataProvider.getGenres(type: .series)) ?? movieGenres
        } else {
            genreCatalog = movieGenres
        }

        // Resolve genre names → ids (case/diacritic-insensitive match).
        let genreIds: [Int] = (plan.genres ?? []).compactMap { name in
            let normalized = normalizeTitle(name)
            return genreCatalog.first(where: { normalizeTitle($0.name) == normalized })?.id
        }

        // Resolve keyword names → ids concurrently, fault-tolerant.
        let keywordNames = (plan.keywords ?? []).filter { !$0.trimmingCharacters(in: .whitespaces).isEmpty }
        let resolvedKeywords = await withTaskGroup(of: TMDBKeyword?.self) { group in
            for name in keywordNames.prefix(4) {
                group.addTask {
                    let matches = (try? await metadataProvider.searchKeywords(query: name)) ?? []
                    // Prefer an exact name match, else the first (most relevant) hit.
                    return matches.first(where: { $0.name.compare(name, options: .caseInsensitive) == .orderedSame })
                        ?? matches.first
                }
            }
            var collected: [TMDBKeyword] = []
            for await keyword in group {
                if let keyword { collected.append(keyword) }
            }
            return collected
        }

        let sort = DiscoverFilters.SortOption(rawValue: plan.sortBy ?? "") ?? .popularityDesc
        // Sanity-clamp the year range so an inverted yearFrom/yearTo can't blank results.
        var yearGTE = plan.yearFrom
        var yearLTE = plan.yearTo
        if let lo = yearGTE, let hi = yearLTE, lo > hi { swap(&yearGTE, &yearLTE) }

        let summary = (plan.summary?.trimmingCharacters(in: .whitespacesAndNewlines)).flatMap { $0.isEmpty ? nil : $0 }
            ?? "Picks for \"\(trimmed)\""

        return AIDiscoverPlan(
            mediaType: mediaType,
            genreIds: genreIds,
            keywordIds: resolvedKeywords.map(\.id),
            keywordNames: resolvedKeywords.map(\.name),
            yearGTE: yearGTE,
            yearLTE: yearLTE,
            minRating: plan.minRating,
            sortBy: sort,
            summary: summary
        )
    }

    // MARK: - "Would I like this?" affinity verdict

    enum AffinityError: LocalizedError {
        case noProvider

        var errorDescription: String? {
            switch self {
            case .noProvider: return "No AI provider is configured. Add one in Settings."
            }
        }
    }

    /// Produce a yes / maybe / no verdict (with confidence + reasoning) for a
    /// single title. Mirrors `discoverFilters`: honest `.noProvider` error when
    /// unconfigured, taste context from the shared assembler, per-item watched /
    /// rating extras, a single-shot `complete` call, usage recording, then a
    /// tolerant parse. Verdicts are cached in-memory per media id + personalization
    /// flag for the shared TTL so a repeat tap returns instantly.
    func predictAffinity(for item: MediaItem) async throws -> AIAffinityVerdict {
        guard let kind = availableProviders.first, let provider = providers[kind] else {
            throw AffinityError.noProvider
        }

        // Cheap key/value read first so a cache hit avoids full context assembly.
        var personalizationEnabled = false
        if let database {
            personalizationEnabled = ((try? await database.getSetting(key: SettingsKeys.personalizationEnabled)) ?? nil) == "true"
        }

        let cacheKey = "\(item.id)|\(personalizationEnabled)"
        if let cached = affinityCache[cacheKey], cached.expiresAt > Date() {
            return cached.result
        }

        // Taste summary via the shared assembler (it re-checks personalization and
        // gates the taste-derived notes accordingly). Only surface those notes when
        // personalization is on, so the honesty path fires whenever it is off.
        let context = await contextAssembler.buildContext(prompt: "Would I like \(item.title)?", folderId: nil)
        let contextNotes = personalizationEnabled ? context.contextNotes : []
        let alreadyWatchedNote = await affinityAlreadyWatchedNote(for: item)

        let prompt = AIAffinityParser.prompt(
            title: item.title,
            year: item.year,
            genres: item.genres,
            overview: item.overview,
            contextNotes: contextNotes,
            alreadyWatchedNote: alreadyWatchedNote
        )

        let raw = try await provider.complete(prompt: prompt)
        await recordUsage(AIUsageMetrics(
            inputTokens: AIAssistantJSONParser.estimatedTokenCount(for: prompt),
            outputTokens: AIAssistantJSONParser.estimatedTokenCount(for: raw),
            totalTokens: nil,
            estimatedCostUSD: nil
        ))

        let verdict = try AIAffinityParser.parse(raw)
        storeInAffinityCache(cacheKey, (expiresAt: Date().addingTimeInterval(cacheTTL), result: verdict))
        return verdict
    }

    /// A short factual note describing whether the user has already watched or
    /// rated this exact title, for the prompt to factor in. Independent of the
    /// personalization opt-in (it is per-item, not aggregate profiling). Returns
    /// nil when there is nothing to report or no database.
    private func affinityAlreadyWatchedNote(for item: MediaItem) async -> String? {
        guard let database else { return nil }
        var parts: [String] = []

        let watchedEvent = (try? await database.fetchLatestWatchedState(mediaId: item.id)) ?? nil
        if let watchedEvent, let state = watchedEvent.watchedState {
            switch state {
            case .watched: parts.append("they marked it watched")
            case .notWatched: parts.append("they marked it as not watched")
            }
            if let value = watchedEvent.feedbackValue, let scale = watchedEvent.feedbackScale {
                parts.append("their recorded rating was \(affinityRatingPhrase(value, scale: scale))")
            }
        }

        let history = (try? await database.fetchWatchHistory(mediaId: item.id)) ?? nil
        if let history {
            let percent = Int((history.progressPercent * 100).rounded())
            if history.completed || percent >= 95 {
                parts.append("they have finished watching it")
            } else if percent >= 2 {
                parts.append("they are about \(percent)% through it")
            }
        }

        guard !parts.isEmpty else { return nil }
        return parts.joined(separator: ", ") + "."
    }

    /// Human-readable phrase for a recorded rating, per feedback scale.
    private func affinityRatingPhrase(_ value: Double, scale: FeedbackScaleMode) -> String {
        switch scale {
        case .likeDislike: return value >= 0.5 ? "a thumbs up" : "a thumbs down"
        case .scale1to10: return "\(Int(value.rounded())) out of 10"
        case .scale1to100: return "\(Int(value.rounded())) out of 100"
        case .none: return "recorded"
        }
    }

    /// Bounded insert for the affinity cache, mirroring `storeInCache`: sweep
    /// expired entries, then evict the soonest-to-expire if at capacity.
    private func storeInAffinityCache(_ key: String, _ entry: (expiresAt: Date, result: AIAffinityVerdict)) {
        let now = Date()
        affinityCache = affinityCache.filter { $0.value.expiresAt > now }
        if affinityCache.count >= cacheCapacity {
            let overflow = affinityCache.count - (cacheCapacity - 1)
            let victims = affinityCache
                .sorted { $0.value.expiresAt < $1.value.expiresAt }
                .prefix(overflow)
                .map(\.key)
            for victim in victims {
                affinityCache.removeValue(forKey: victim)
            }
        }
        affinityCache[key] = entry
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
                        // Surface the failure instead of swallowing it to nil, so the
                        // UI can distinguish "provider X failed" from "no results".
                        let message = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
                        return AIProviderResponse(
                            provider: kind,
                            model: nil,
                            recommendations: [],
                            rawText: nil,
                            usage: nil,
                            error: message
                        )
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
        // Error-bearing responses (empty recommendations + error) are kept in
        // providerResponses so the UI can surface them, but they must not stop
        // fallback from triggering. Treat the result set as empty when no
        // provider produced any recommendations.
        let hasAnyRecommendations = providerResponses.contains { !$0.recommendations.isEmpty }
        if !hasAnyRecommendations {
            merged = fallbackRecommendations(from: candidates, maxResults: request.maxResults)
            usedFallback = true
        } else if request.compareMode {
            merged = mergeWithRRF(providerResponses: providerResponses, maxResults: request.maxResults)
            usedFallback = false
        } else {
            let firstWithResults = providerResponses.first { !$0.recommendations.isEmpty }
            merged = Array((firstWithResults?.recommendations ?? []).prefix(request.maxResults))
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

        storeInCache(cacheKey, (expiresAt: Date().addingTimeInterval(cacheTTL), result: result))
        await persistAssistantMemory(from: prompt, result: result, personalizationEnabled: context.personalizationEnabled)
        return result
    }

    /// Inserts into the in-memory cache while keeping it bounded: expired entries
    /// are swept first, then the soonest-to-expire entries are evicted if the cap
    /// is reached. Evicting expired/soonest-to-expire entries can only cause a
    /// cache miss (extra provider call), never an incorrect result.
    private func storeInCache(_ key: String, _ entry: (expiresAt: Date, result: AICompareResult)) {
        let now = Date()
        cache = cache.filter { $0.value.expiresAt > now }
        if cache.count >= cacheCapacity {
            let overflow = cache.count - (cacheCapacity - 1)
            let victims = cache
                .sorted { $0.value.expiresAt < $1.value.expiresAt }
                .prefix(overflow)
                .map(\.key)
            for victim in victims {
                cache.removeValue(forKey: victim)
            }
        }
        cache[key] = entry
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
