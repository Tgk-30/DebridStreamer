import Testing
import Foundation
@testable import DebridStreamer

@Suite("DiscoverAICurationStore Tests")
@MainActor
struct DiscoverAICurationStoreTests {
    @Test("Preload marks loaded without generation when feature is disabled")
    func disabledFeatureDoesNotGenerate() async throws {
        let db = try makeTestDatabase()
        let settings = SettingsManager(database: db, secretStore: InMemorySecretStore())
        try await settings.setPersonalizationEnabled(false)
        try await settings.setDiscoverAICurationOnLaunchEnabled(false)

        let service = DiscoverAICurationService(
            assistantManager: nil,
            database: db,
            settings: settings
        )
        let store = DiscoverAICurationStore()
        await store.preloadIfNeeded(service: service)

        #expect(store.hasLoaded == true)
        #expect(store.recommendations.isEmpty)
    }

    @Test("Cache is surfaced immediately when available")
    func cachedRecommendationsLoad() async throws {
        let db = try makeTestDatabase()
        let settings = SettingsManager(database: db, secretStore: InMemorySecretStore())
        try await settings.setPersonalizationEnabled(true)
        try await settings.setDiscoverAICurationOnLaunchEnabled(true)

        let cached = [
            AIMovieRecommendation(title: "Cached Film", year: 2026, reason: "Cached", score: 0.8)
        ]
        let payload = try JSONEncoder().encode(cached)
        try await db.saveDiscoverAICacheEntry(
            AICurationCacheEntry(
                cacheKey: "discover-launch-curated",
                payload: payload,
                model: "cache",
                expiresAt: Date().addingTimeInterval(60)
            )
        )

        let service = DiscoverAICurationService(
            assistantManager: nil,
            database: db,
            settings: settings
        )
        let store = DiscoverAICurationStore()
        await store.load(service: service, forceRefresh: false)

        #expect(store.recommendations.count == 1)
        #expect(store.recommendations.first?.title == "Cached Film")
    }
}
