import Testing
import Foundation
@testable import DebridStreamer

/// V2 coverage for the redesigned Continue-Watching rail (progress-carrying
/// `ContinueWatchingItem`s filtered to genuinely in-progress entries) and the
/// `catalogRevision` change token that drives view re-sync after a load.
@Suite("DiscoverCatalogStore V2 Tests")
@MainActor
struct DiscoverCatalogStoreV2Tests {
    @Test("Continue watching carries resume progress and is filtered to in-progress items")
    func continueWatchingCarriesProgressAndFiltersInProgress() async throws {
        let db = try makeTestDatabase()

        // In-progress movie: 1200 / 5400 ≈ 0.222 → has a resume point.
        try await db.saveMedia(MediaItem(id: "tt-inprogress", type: .movie, title: "In Progress Movie", year: 2026))
        try await db.saveWatchHistory(
            WatchHistory(
                id: "wh-inprogress",
                mediaId: "tt-inprogress",
                progressSeconds: 1200,
                durationSeconds: 5400,
                completed: false,
                lastWatched: Date()
            )
        )

        // Barely-started movie: 30 / 5400 ≈ 0.0056 (< 2%) → NOT a resume point.
        try await db.saveMedia(MediaItem(id: "tt-barely", type: .movie, title: "Barely Started", year: 2025))
        try await db.saveWatchHistory(
            WatchHistory(
                id: "wh-barely",
                mediaId: "tt-barely",
                progressSeconds: 30,
                durationSeconds: 5400,
                completed: false,
                lastWatched: Date().addingTimeInterval(-10)
            )
        )

        // Near-finished movie: 5300 / 5400 ≈ 0.981 (> 95%) → NOT a resume point.
        try await db.saveMedia(MediaItem(id: "tt-almostdone", type: .movie, title: "Almost Done", year: 2024))
        try await db.saveWatchHistory(
            WatchHistory(
                id: "wh-almostdone",
                mediaId: "tt-almostdone",
                progressSeconds: 5300,
                durationSeconds: 5400,
                completed: false,
                lastWatched: Date().addingTimeInterval(-20)
            )
        )

        let store = DiscoverCatalogStore()
        await store.preloadIfNeeded(provider: nil, database: db) { _ in
            Issue.record("Error callback should not be called")
        }

        // Only the genuinely in-progress entry survives the resume-point filter.
        #expect(store.continueWatching.count == 1)
        let item = try #require(store.continueWatching.first)
        #expect(item.id == "tt-inprogress")
        #expect(item.preview.title == "In Progress Movie")
        #expect(item.isInProgress == true)

        // Progress fraction + formatted string mirror the WatchHistory source.
        let expected = WatchHistory(
            id: "wh-inprogress",
            mediaId: "tt-inprogress",
            progressSeconds: 1200,
            durationSeconds: 5400,
            completed: false,
            lastWatched: Date()
        )
        #expect(abs(item.progress - expected.progressPercent) < 0.0001)
        #expect(item.progressString == expected.progressString)
        // Sanity: the formatted string is the "elapsed / total" form.
        #expect(item.progressString == "20:00 / 1:30:00")
    }

    @Test("catalogRevision bumps after a provider-backed load")
    func catalogRevisionBumpsAfterLoad() async throws {
        let movie = MediaPreview(
            id: "tmdb-100",
            type: .movie,
            title: "Movie 100",
            year: 2026,
            posterPath: nil,
            imdbRating: nil,
            tmdbId: 100
        )
        let provider = StubMetadataProvider(
            trendingMovieResponse: MetadataSearchResult(items: [movie], page: 1, totalPages: 1, totalResults: 1),
            categoryResponses: [
                .popular: MetadataSearchResult(items: [movie], page: 1, totalPages: 1, totalResults: 1),
                .topRated: MetadataSearchResult(items: [movie], page: 1, totalPages: 1, totalResults: 1),
            ]
        )

        let store = DiscoverCatalogStore()
        #expect(store.catalogRevision == 0)

        await store.load(provider: provider, database: nil, forceRefresh: false) { _ in
            Issue.record("Error callback should not be called")
        }
        #expect(store.isLoaded == true)
        #expect(store.catalogRevision == 1)

        // A forced refresh re-runs the load and bumps the revision again.
        await store.load(provider: provider, database: nil, forceRefresh: true) { _ in
            Issue.record("Error callback should not be called")
        }
        #expect(store.catalogRevision == 2)
    }

    @Test("Completed watch history never appears in continue watching")
    func completedHistoryIsExcluded() async throws {
        let db = try makeTestDatabase()

        try await db.saveMedia(MediaItem(id: "tt-done", type: .movie, title: "Finished Movie", year: 2026))
        try await db.saveWatchHistory(
            WatchHistory(
                id: "wh-done",
                mediaId: "tt-done",
                progressSeconds: 2700,
                durationSeconds: 5400,
                completed: true,
                lastWatched: Date()
            )
        )

        let store = DiscoverCatalogStore()
        await store.preloadIfNeeded(provider: nil, database: db) { _ in
            Issue.record("Error callback should not be called")
        }

        #expect(store.continueWatching.isEmpty)
    }
}
