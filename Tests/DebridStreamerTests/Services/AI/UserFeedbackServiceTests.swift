import Testing
import Foundation
@testable import DebridStreamer

@Suite("UserFeedbackService Tests")
struct UserFeedbackServiceTests {
    @Test("Manual watched feedback writes taste event and adds watched folder entry")
    func manualWatchedAddsWatchedFolder() async throws {
        let db = try makeTestDatabase()
        try await db.saveMedia(MediaItem(id: "tt-watched-1", type: .movie, title: "Watched Movie", year: 2025))
        let service = UserFeedbackService(database: db, metadataService: nil)
        let recommendation = AIMovieRecommendation(
            title: "Watched Movie",
            year: 2025,
            reason: "test",
            score: 0.9
        )

        let outcome = await service.recordRecommendationFeedback(
            recommendation: recommendation,
            watchedState: .watched,
            feedbackScaleMode: .likeDislike,
            feedbackValue: 1,
            source: .manual
        )
        #expect(outcome.addedToWatchedFolder == true)
        #expect(outcome.addedToReleaseWait == false)

        let latest = try await db.fetchLatestWatchedState(mediaId: "tt-watched-1")
        #expect(latest?.watchedState == .watched)
        #expect(latest?.source == .manual)

        let watchedFolder = try await db.fetchFolderByKind(listType: .favorites, kind: .watched)
        let watchedEntries = try await db.fetchLibrary(folderId: try #require(watchedFolder).id, includeDescendants: true)
        #expect(watchedEntries.contains(where: { $0.mediaId == "tt-watched-1" }))
    }

    @Test("Manual not-watched overrides auto completion classification")
    func manualNotWatchedOverridesAutoCompletion() async throws {
        let db = try makeTestDatabase()
        try await db.saveMedia(MediaItem(id: "tt-override-1", type: .movie, title: "Override Movie", year: 2024))
        let service = UserFeedbackService(database: db, metadataService: nil)
        let recommendation = AIMovieRecommendation(
            title: "Override Movie",
            year: 2024,
            reason: "test",
            score: 0.4
        )

        _ = await service.recordRecommendationFeedback(
            recommendation: recommendation,
            watchedState: .notWatched,
            feedbackScaleMode: .none,
            feedbackValue: nil,
            source: .manual
        )
        await service.recordAutoCompletion(
            mediaId: "tt-override-1",
            episodeId: nil,
            progressSeconds: 9_500,
            durationSeconds: 10_000
        )

        let latest = try await db.fetchLatestWatchedState(mediaId: "tt-override-1")
        #expect(latest?.watchedState == .notWatched)
        #expect(latest?.source == .manual)
    }

    @Test("Scale based feedback stores normalized signal strength")
    func scaleFeedbackStoresNormalizedSignal() async throws {
        let db = try makeTestDatabase()
        try await db.saveMedia(MediaItem(id: "tt-scale-1", type: .movie, title: "Scale Movie", year: 2026))
        let service = UserFeedbackService(database: db, metadataService: nil)
        let recommendation = AIMovieRecommendation(
            title: "Scale Movie",
            year: 2026,
            reason: "test",
            score: 0.6
        )

        _ = await service.recordRecommendationFeedback(
            recommendation: recommendation,
            watchedState: .watched,
            feedbackScaleMode: .scale1to10,
            feedbackValue: 10,
            source: .manual
        )

        let events = try await db.fetchTasteEvents(limit: 10)
        let watchedEvent = events.first(where: { $0.watchedState == .watched && $0.feedbackScale == .scale1to10 })
        #expect((watchedEvent?.signalStrength ?? 0) > 0.9)
    }
}
