import Foundation

actor DiscoverAICurationService {
    private let assistantManager: AIAssistantManager?
    private let database: DatabaseManager?
    private let settings: SettingsManager?
    private let metadataProvider: (any MetadataProvider)?

    init(
        assistantManager: AIAssistantManager?,
        database: DatabaseManager?,
        settings: SettingsManager?,
        metadataProvider: (any MetadataProvider)?
    ) {
        self.assistantManager = assistantManager
        self.database = database
        self.settings = settings
        self.metadataProvider = metadataProvider
    }

    func shouldGenerateOnLaunch() async -> Bool {
        guard let settings else { return false }
        let personalizationEnabled = (try? await settings.isPersonalizationEnabled()) == true
        let discoverEnabled = (try? await settings.isDiscoverAICurationOnLaunchEnabled()) == true
        return personalizationEnabled && discoverEnabled
    }

    func cachedRecommendations() async -> [AIMovieRecommendation] {
        guard let database else { return [] }
        guard
            let cache = try? await database.fetchDiscoverAICacheEntry(cacheKey: Self.cacheKey),
            let decoded = try? JSONDecoder().decode([AIMovieRecommendation].self, from: cache.payload)
        else {
            return []
        }
        return await enrichMissingArtwork(decoded)
    }

    func generateRecommendations(forceRefresh: Bool = false) async -> [AIMovieRecommendation] {
        guard let assistantManager else { return [] }

        if !forceRefresh {
            let cached = await cachedRecommendations()
            if !cached.isEmpty {
                return cached
            }
        }

        let prompt = "Generate fresh personalized discover recommendations prioritizing recent user taste shifts. Return movies and shows."
        let response = await assistantManager.recommend(
            request: AIAssistantRequest(
                prompt: prompt,
                maxResults: 12,
                compareMode: false,
                providers: []
            )
        )

        let items = await enrichMissingArtwork(Array(response.mergedRecommendations.prefix(12)))
        guard let database, !items.isEmpty else { return items }
        if let payload = try? JSONEncoder().encode(items) {
            let cache = AICurationCacheEntry(
                cacheKey: Self.cacheKey,
                payload: payload,
                model: response.providerResponses.first?.provider.rawValue,
                expiresAt: Date().addingTimeInterval(60 * 20)
            )
            try? await database.saveDiscoverAICacheEntry(cache)
        }
        return items
    }

    private func enrichMissingArtwork(_ items: [AIMovieRecommendation]) async -> [AIMovieRecommendation] {
        guard let metadataProvider else { return items }
        guard !items.isEmpty else { return items }

        var output: [AIMovieRecommendation] = []
        output.reserveCapacity(items.count)

        for recommendation in items {
            if recommendation.posterPath != nil {
                output.append(recommendation)
                continue
            }

            let query = recommendation.title.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !query.isEmpty else {
                output.append(recommendation)
                continue
            }

            let searchResult = try? await metadataProvider.search(query: query, type: nil, page: 1)
            guard let preview = bestPreview(searchResult?.items ?? [], recommendation: recommendation) else {
                output.append(recommendation)
                continue
            }

            var enriched = recommendation
            enriched.posterPath = preview.posterPath
            enriched.mediaId = preview.id
            enriched.mediaType = preview.type
            if enriched.year == nil {
                enriched.year = preview.year
            }
            output.append(enriched)
        }

        return output
    }

    private func bestPreview(
        _ previews: [MediaPreview],
        recommendation: AIMovieRecommendation
    ) -> MediaPreview? {
        guard !previews.isEmpty else { return nil }
        if let year = recommendation.year,
           let exactYear = previews.first(where: { $0.year == year && $0.posterPath != nil }) {
            return exactYear
        }
        let normalizedTitle = recommendation.title
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .lowercased()
        if let exactTitle = previews.first(where: {
            $0.title.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() == normalizedTitle
                && $0.posterPath != nil
        }) {
            return exactTitle
        }
        return previews.first(where: { $0.posterPath != nil }) ?? previews.first
    }

    private static let cacheKey = "discover-launch-curated"
}
