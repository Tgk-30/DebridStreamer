import Foundation

actor DiscoverAICurationService {
    private let assistantManager: AIAssistantManager?
    private let database: DatabaseManager?
    private let settings: SettingsManager?

    init(
        assistantManager: AIAssistantManager?,
        database: DatabaseManager?,
        settings: SettingsManager?
    ) {
        self.assistantManager = assistantManager
        self.database = database
        self.settings = settings
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
        return decoded
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

        let items = Array(response.mergedRecommendations.prefix(12))
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

    private static let cacheKey = "discover-launch-curated"
}

