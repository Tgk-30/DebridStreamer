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
            settings: settings,
            metadataProvider: nil
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
            settings: settings,
            metadataProvider: nil
        )
        let store = DiscoverAICurationStore()
        await store.load(service: service, forceRefresh: false)

        #expect(store.recommendations.count == 1)
        #expect(store.recommendations.first?.title == "Cached Film")
    }

    @Test("Cached recommendations are enriched with poster artwork when metadata is available")
    func cachedRecommendationsEnrichArtwork() async throws {
        let db = try makeTestDatabase()
        let settings = SettingsManager(database: db, secretStore: InMemorySecretStore())
        let cached = [
            AIMovieRecommendation(title: "No Poster", year: 2025, reason: "Cached", score: 0.6)
        ]
        let payload = try JSONEncoder().encode(cached)
        try await db.saveDiscoverAICacheEntry(
            AICurationCacheEntry(
                cacheKey: "discover-launch-curated",
                payload: payload,
                model: "cache",
                expiresAt: Date().addingTimeInterval(300)
            )
        )

        let service = DiscoverAICurationService(
            assistantManager: nil,
            database: db,
            settings: settings,
            metadataProvider: DiscoverPosterStub()
        )

        let recommendations = await service.cachedRecommendations()
        let first = try #require(recommendations.first)
        #expect(first.posterPath == "/discover-poster.jpg")
        #expect(first.mediaId == "tmdb-900")
    }
}

private struct DiscoverPosterStub: MetadataProvider {
    func search(query: String, type: MediaType?, page: Int) async throws -> MetadataSearchResult {
        MetadataSearchResult(
            items: [
                MediaPreview(
                    id: "tmdb-900",
                    type: .movie,
                    title: "No Poster",
                    year: 2025,
                    posterPath: "/discover-poster.jpg",
                    imdbRating: 7.1,
                    tmdbId: 900
                )
            ],
            page: 1,
            totalPages: 1,
            totalResults: 1
        )
    }

    func getDetail(id: String, type: MediaType) async throws -> MediaItem {
        MediaItem(id: id, type: type, title: "Detail")
    }

    func getTrending(type: MediaType, timeWindow: TrendingWindow, page: Int) async throws -> MetadataSearchResult {
        MetadataSearchResult(items: [], page: 1, totalPages: 1, totalResults: 0)
    }

    func getCategory(_ category: MediaCategory, type: MediaType, page: Int) async throws -> MetadataSearchResult {
        MetadataSearchResult(items: [], page: 1, totalPages: 1, totalResults: 0)
    }

    func discover(type: MediaType, filters: DiscoverFilters) async throws -> MetadataSearchResult {
        MetadataSearchResult(items: [], page: 1, totalPages: 1, totalResults: 0)
    }

    func getGenres(type: MediaType) async throws -> [Genre] { [] }
    func getSeasons(tmdbId: Int) async throws -> [Season] { [] }
    func getEpisodes(tmdbId: Int, season: Int) async throws -> [Episode] { [] }
    func getExternalIds(tmdbId: Int, type: MediaType) async throws -> ExternalIds {
        ExternalIds(imdbId: nil, tvdbId: nil)
    }
    func getCast(tmdbId: Int, type: MediaType) async throws -> [CastMember] { [] }
    func getRecommendations(tmdbId: Int, type: MediaType) async throws -> [MediaPreview] { [] }
    func getPerson(personId: Int) async throws -> Person { Person(id: personId, name: "Stub") }
    func getPersonCredits(personId: Int) async throws -> [MediaPreview] { [] }
    func searchKeywords(query: String) async throws -> [TMDBKeyword] { [] }
}
