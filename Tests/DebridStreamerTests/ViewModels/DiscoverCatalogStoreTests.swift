import Testing
import Foundation
@testable import DebridStreamer

@Suite("DiscoverCatalogStore Tests")
@MainActor
struct DiscoverCatalogStoreTests {
    @Test("Preload populates discover sections")
    func preloadPopulatesSections() async throws {
        let movie = MediaPreview(
            id: "tmdb-1",
            type: .movie,
            title: "Movie 1",
            year: 2026,
            posterPath: nil,
            imdbRating: nil,
            tmdbId: 1
        )
        let show = MediaPreview(
            id: "tmdb-2",
            type: .series,
            title: "Show 1",
            year: 2025,
            posterPath: nil,
            imdbRating: nil,
            tmdbId: 2
        )
        let provider = StubMetadataProvider(
            trendingMovieResponse: MetadataSearchResult(items: [movie], page: 1, totalPages: 1, totalResults: 1),
            trendingSeriesResponse: MetadataSearchResult(items: [show], page: 1, totalPages: 1, totalResults: 1),
            categoryResponses: [
                .popular: MetadataSearchResult(items: [movie], page: 1, totalPages: 1, totalResults: 1),
                .topRated: MetadataSearchResult(items: [movie], page: 1, totalPages: 1, totalResults: 1),
            ]
        )

        let store = DiscoverCatalogStore()
        await store.preloadIfNeeded(provider: provider, database: nil) { _ in
            Issue.record("Error callback should not be called")
        }

        #expect(store.trendingMovies == [movie])
        #expect(store.trendingShows == [show])
        #expect(store.popularMovies == [movie])
        #expect(store.topRatedMovies == [movie])
        #expect(store.isLoaded == true)
        #expect(store.lastErrorMessage == nil)
    }

    @Test("Continue watching is hydrated from watch history")
    func continueWatchingHydratesFromDatabase() async throws {
        let db = try makeTestDatabase()
        try await db.saveMedia(MediaItem(id: "tt001", type: .movie, title: "Watched Movie", year: 2026))
        try await db.saveWatchHistory(
            WatchHistory(
                id: "wh-001",
                mediaId: "tt001",
                progressSeconds: 1200,
                durationSeconds: 5400,
                completed: false,
                lastWatched: Date()
            )
        )

        let store = DiscoverCatalogStore()
        await store.preloadIfNeeded(provider: nil, database: db) { _ in
            Issue.record("Error callback should not be called")
        }

        #expect(store.continueWatching.count == 1)
        #expect(store.continueWatching.first?.id == "tt001")
        #expect(store.continueWatching.first?.preview.title == "Watched Movie")
    }

    @Test("Late metadata availability still loads when forced refresh is used")
    func lateMetadataAvailabilityLoadsWithForceRefresh() async throws {
        let movie = MediaPreview(
            id: "tmdb-10",
            type: .movie,
            title: "Movie 10",
            year: 2026,
            posterPath: nil,
            imdbRating: nil,
            tmdbId: 10
        )
        let provider = StubMetadataProvider(
            trendingMovieResponse: MetadataSearchResult(items: [movie], page: 1, totalPages: 1, totalResults: 1),
            categoryResponses: [
                .popular: MetadataSearchResult(items: [movie], page: 1, totalPages: 1, totalResults: 1),
                .topRated: MetadataSearchResult(items: [movie], page: 1, totalPages: 1, totalResults: 1),
            ]
        )

        let store = DiscoverCatalogStore()
        await store.preloadIfNeeded(provider: nil, database: nil) { _ in }
        #expect(store.trendingMovies.isEmpty)
        #expect(store.isLoaded == false)

        await store.load(provider: provider, database: nil, forceRefresh: true) { _ in
            Issue.record("Error callback should not be called")
        }

        #expect(store.trendingMovies == [movie])
        #expect(store.isLoaded == true)
    }
}
