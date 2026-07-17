import Testing
import Foundation
import GRDB
@testable import DebridStreamer

/// Coverage for the additive bulk `fetchWatchHistory(mediaIds:)` accessor, which
/// resolves media-level (episodeId IS NULL) resume points for many mediaIds in a
/// single query - the no-N+1 backbone of the Continue-Watching rail.
@Suite("WatchHistory bulk fetch Tests")
struct WatchHistoryBulkTests {
    @Test("Bulk fetch returns the correct media-level history per id in one call")
    func bulkFetchReturnsHistoryPerId() async throws {
        let db = try makeTestDatabase()

        try await db.saveMedia(MediaItem(id: "tt-a", type: .movie, title: "A", year: 2026))
        try await db.saveMedia(MediaItem(id: "tt-b", type: .movie, title: "B", year: 2025))
        try await db.saveMedia(MediaItem(id: "tt-c", type: .movie, title: "C", year: 2024))

        try await db.saveWatchHistory(
            WatchHistory(
                id: "wh-a",
                mediaId: "tt-a",
                progressSeconds: 600,
                durationSeconds: 3600,
                completed: false,
                lastWatched: Date()
            )
        )
        try await db.saveWatchHistory(
            WatchHistory(
                id: "wh-b",
                mediaId: "tt-b",
                progressSeconds: 1800,
                durationSeconds: 7200,
                completed: true,
                lastWatched: Date()
            )
        )
        // tt-c intentionally has no watch history.

        let result = try await db.fetchWatchHistory(mediaIds: ["tt-a", "tt-b", "tt-c"])

        #expect(result.count == 2)
        #expect(result["tt-a"]?.id == "wh-a")
        #expect(result["tt-a"]?.progressSeconds == 600)
        #expect(result["tt-b"]?.id == "wh-b")
        #expect(result["tt-b"]?.completed == true)
        // An id with no history is simply absent from the map.
        #expect(result["tt-c"] == nil)
    }

    @Test("Bulk fetch ignores episode-level rows and keeps the most recent media-level row")
    func bulkFetchIgnoresEpisodeRowsAndKeepsMostRecent() async throws {
        let db = try makeTestDatabase()
        try await db.saveMedia(MediaItem(id: "tt-show", type: .series, title: "Show", year: 2026))

        // Episode-level history (episodeId set) must NOT be returned for the media id.
        try await db.saveWatchHistory(
            WatchHistory(
                id: "wh-ep",
                mediaId: "tt-show",
                episodeId: "ep-1",
                progressSeconds: 100,
                durationSeconds: 1500,
                completed: false,
                lastWatched: Date().addingTimeInterval(100)
            )
        )
        // Two media-level rows: the most recently watched should win.
        try await db.saveWatchHistory(
            WatchHistory(
                id: "wh-old",
                mediaId: "tt-show",
                episodeId: nil,
                progressSeconds: 200,
                durationSeconds: 1500,
                completed: false,
                lastWatched: Date().addingTimeInterval(-100)
            )
        )
        try await db.saveWatchHistory(
            WatchHistory(
                id: "wh-new",
                mediaId: "tt-show",
                episodeId: nil,
                progressSeconds: 900,
                durationSeconds: 1500,
                completed: false,
                lastWatched: Date().addingTimeInterval(50)
            )
        )

        let result = try await db.fetchWatchHistory(mediaIds: ["tt-show"])

        #expect(result.count == 1)
        // Most-recent media-level row wins; the episode row is excluded entirely.
        #expect(result["tt-show"]?.id == "wh-new")
        #expect(result["tt-show"]?.episodeId == nil)
        #expect(result["tt-show"]?.progressSeconds == 900)
    }

    @Test("Bulk fetch with no ids returns an empty map")
    func bulkFetchEmptyInput() async throws {
        let db = try makeTestDatabase()
        let result = try await db.fetchWatchHistory(mediaIds: [])
        #expect(result.isEmpty)
    }
}
