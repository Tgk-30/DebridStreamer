import Testing
import Foundation
@testable import DebridStreamer

@Suite("UserFeedbackService Tests")
struct UserFeedbackServiceTests {
    @Test("No database means recording feedback returns a zero outcome")
    func noDatabaseReturnsZeroOutcome() async {
        let service = UserFeedbackService(database: nil, metadataService: nil)
        let recommendation = AIMovieRecommendation(
            title: "Detached",
            year: 2026,
            reason: "missing db",
            score: 0.2
        )

        let outcome = await service.recordRecommendationFeedback(
            recommendation: recommendation,
            watchedState: .watched,
            feedbackScaleMode: .none,
            feedbackValue: nil
        )
        #expect(outcome == .init())
    }

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

    @Test("scale1to100 feedback stores liked and disliked preference events")
    func scale1To100FeedbackMapsToPreferenceEvents() async throws {
        let db = try makeTestDatabase()
        try await db.saveMedia(MediaItem(id: "tt-scale100-1", type: .movie, title: "Scale100 Like", year: 2026))
        let service = UserFeedbackService(database: db, metadataService: nil)

        let recommendation = AIMovieRecommendation(
            title: "Scale100 Like",
            year: 2026,
            reason: "test",
            score: 0.9
        )

        _ = await service.recordRecommendationFeedback(
            recommendation: recommendation,
            watchedState: .watched,
            feedbackScaleMode: .scale1to100,
            feedbackValue: 80,
            source: .manual
        )
        _ = await service.recordRecommendationFeedback(
            recommendation: recommendation,
            watchedState: .watched,
            feedbackScaleMode: .scale1to100,
            feedbackValue: 40,
            source: .manual
        )

        let events = try await db.fetchTasteEvents(limit: 20)
        #expect(events.contains(where: { $0.feedbackScale == .scale1to100 && $0.eventType == .liked }))
        #expect(events.contains(where: { $0.feedbackScale == .scale1to100 && $0.eventType == .disliked }))
    }

    @Test("scale1to100 without value stores only the watched event")
    func scale1To100WithoutValueSkipsPreferenceEvent() async throws {
        let db = try makeTestDatabase()
        try await db.saveMedia(MediaItem(id: "tt-scale100-2", type: .movie, title: "Scale100 Unknown", year: 2026))
        let service = UserFeedbackService(database: db, metadataService: nil)

        let recommendation = AIMovieRecommendation(
            title: "Scale100 Unknown",
            year: 2026,
            reason: "test",
            score: 0.4
        )

        _ = await service.recordRecommendationFeedback(
            recommendation: recommendation,
            watchedState: .watched,
            feedbackScaleMode: .scale1to100,
            feedbackValue: nil,
            source: .manual
        )

        let events = try await db.fetchTasteEvents(limit: 20)
        #expect(events.contains(where: { $0.feedbackScale == .scale1to100 && $0.eventType == .watched }))
        #expect(events.contains(where: { $0.eventType == .liked || $0.eventType == .disliked }) == false)
    }

    @Test("Resolves media by mediaId before attempting cache or network lookup")
    func recordsForKnownMediaId() async throws {
        let db = try makeTestDatabase()
        try await db.saveMedia(MediaItem(id: "tmdb-100", type: .movie, title: "Known Movie", year: 2024))
        let service = UserFeedbackService(database: db, metadataService: nil)

        let recommendation = AIMovieRecommendation(
            title: "Ignored Title",
            year: 2020,
            reason: "test",
            score: 0.8,
            mediaId: "tmdb-100",
            mediaType: .movie
        )

        _ = await service.recordRecommendationFeedback(
            recommendation: recommendation,
            watchedState: .watched,
            feedbackScaleMode: .none,
            feedbackValue: nil
        )

        let events = try await db.fetchTasteEvents(limit: 10)
        let hasWatchedEvent = events.contains {
            $0.mediaId == "tmdb-100" && $0.watchedState == .watched
        }
        #expect(hasWatchedEvent)
    }

    @Test("Resolves cached media by title when year does not exactly match")
    func resolvesCachedMediaByTitleFallback() async throws {
        let db = try makeTestDatabase()
        try await db.saveMedia(MediaItem(id: "cached-1", type: .movie, title: "Fallback Match", year: 2019))
        let service = UserFeedbackService(database: db, metadataService: nil)

        let recommendation = AIMovieRecommendation(
            title: "fallback match",
            year: 2026,
            reason: "cached resolution test",
            score: 0.7
        )

        _ = await service.recordRecommendationFeedback(
            recommendation: recommendation,
            watchedState: .watched,
            feedbackScaleMode: .none,
            feedbackValue: nil
        )

        let events = try await db.fetchTasteEvents(limit: 10)
        #expect(events.contains(where: { $0.mediaId == "cached-1" }))
    }

    @Test("Auto completion only writes feedback when threshold is reached")
    func autoCompletionSkipsWhenProgressUnderThreshold() async throws {
        let db = try makeTestDatabase()
        try await db.saveMedia(MediaItem(id: "tt-auto-1", type: .movie, title: "Auto Movie", year: 2022))
        let service = UserFeedbackService(database: db, metadataService: nil)

        await service.recordAutoCompletion(mediaId: "tt-auto-1", episodeId: nil, progressSeconds: 9_999, durationSeconds: 20_000)

        let latest = try await db.fetchLatestWatchedState(mediaId: "tt-auto-1")
        #expect(latest == nil)
    }

    @Test("Auto completion writes watched feedback at threshold")
    func autoCompletionWritesWhenThresholdMet() async throws {
        let db = try makeTestDatabase()
        try await db.saveMedia(MediaItem(id: "tt-auto-2", type: .movie, title: "Auto Movie", year: 2022))
        let service = UserFeedbackService(database: db, metadataService: nil)

        await service.recordAutoCompletion(mediaId: "tt-auto-2", episodeId: nil, progressSeconds: 10_000, durationSeconds: 10_000)

        let latest = try await db.fetchLatestWatchedState(mediaId: "tt-auto-2")
        #expect(latest?.watchedState == .watched)
        #expect(latest?.source == .auto)
    }

    @Test("Auto completion skips when duration is unavailable")
    func autoCompletionSkipsWithoutDuration() async throws {
        let db = try makeTestDatabase()
        try await db.saveMedia(MediaItem(id: "tt-auto-3", type: .movie, title: "Auto Movie", year: 2023))
        let service = UserFeedbackService(database: db, metadataService: nil)

        await service.recordAutoCompletion(mediaId: "tt-auto-3", episodeId: nil, progressSeconds: 12_000, durationSeconds: nil)

        let latest = try await db.fetchLatestWatchedState(mediaId: "tt-auto-3")
        #expect(latest == nil)
    }

    @Test("Series recommendations are added to release wait when liked and renewal metadata matches")
    func seriesFeedbackAddsReleaseWaitWhenApplicable() async throws {
        let db = try makeTestDatabase()
        let sessionID = UUID().uuidString
        let tmdbSession = makeMockSession(sessionID: sessionID)
        MockURLProtocol.setHandler({ request in
            let body = """
            {
              "status": "Returning Series",
              "in_production": true
            }
            """
            return try makeResponse(for: request, statusCode: 200, body: body)
        }, for: sessionID)
        defer { MockURLProtocol.removeHandler(for: sessionID) }

        let metadataService = TMDBService(apiKey: "tmdb-key", session: tmdbSession)
        let service = UserFeedbackService(database: db, metadataService: metadataService)
        try await db.saveMedia(MediaItem(id: "tmdb-7001", type: .series, title: "Series One", year: 2024))

        let recommendation = AIMovieRecommendation(
            title: "Series One",
            year: 2024,
            reason: "test",
            score: 0.9,
            mediaId: "tmdb-7001",
            mediaType: .series
        )

        let outcome = await service.recordRecommendationFeedback(
            recommendation: recommendation,
            watchedState: .watched,
            feedbackScaleMode: .likeDislike,
            feedbackValue: 1,
            source: .manual
        )

        #expect(outcome.addedToWatchedFolder == true)
        #expect(outcome.addedToReleaseWait == true)

        let releaseWaitFolder = try await db.fetchFolderByKind(listType: .favorites, kind: .releaseWait)
        let entries = try await db.fetchLibrary(folderId: #require(releaseWaitFolder).id, includeDescendants: true)
        #expect(entries.contains(where: { $0.mediaId == "tmdb-7001" }))
    }
}

private func makeResponse(for request: URLRequest, statusCode: Int, body: String) throws -> (HTTPURLResponse, Data) {
    guard let url = request.url else {
        throw NSError(domain: "UserFeedbackServiceTests", code: 1)
    }
    guard let response = HTTPURLResponse(url: url, statusCode: statusCode, httpVersion: nil, headerFields: nil) else {
        throw NSError(domain: "UserFeedbackServiceTests", code: 2)
    }
    return (response, Data(body.utf8))
}
