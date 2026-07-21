import Testing
import Foundation
@testable import DebridStreamer

@Suite("DiscoverFeedbackViewModel Tests")
@MainActor
struct DiscoverFeedbackViewModelTests {
    @Test("Watched flow opens sheet for configured scale mode")
    func watchedFlowUsesScaleMode() async throws {
        let db = try makeTestDatabase()
        let settings = SettingsManager(database: db, secretStore: InMemorySecretStore())
        try await settings.setFeedbackScaleMode(.scale1to10)

        let model = DiscoverFeedbackViewModel()
        let recommendation = AIMovieRecommendation(
            title: "Test Film",
            year: 2026,
            reason: "Because",
            score: 0.8
        )

        let mode = await model.beginWatchedFlow(recommendation: recommendation, settings: settings)
        #expect(mode == .scale1to10)
        #expect(model.pendingFeedback != nil)
        #expect(model.pendingFeedback?.value == 8)
    }

    @Test("Watched flow with none mode skips prompt")
    func watchedFlowNoneSkipsPrompt() async throws {
        let db = try makeTestDatabase()
        let settings = SettingsManager(database: db, secretStore: InMemorySecretStore())
        try await settings.setFeedbackScaleMode(.none)

        let model = DiscoverFeedbackViewModel()
        let recommendation = AIMovieRecommendation(
            title: "No Prompt",
            year: 2025,
            reason: "Reason",
            score: 0.7
        )

        let mode = await model.beginWatchedFlow(recommendation: recommendation, settings: settings)
        #expect(mode == .none)
        #expect(model.pendingFeedback == nil)
    }

    @Test("Submit watched updates card state")
    func submitWatchedUpdatesState() async throws {
        let db = try makeTestDatabase()
        let service = UserFeedbackService(database: db, metadataService: nil)
        let model = DiscoverFeedbackViewModel()
        let recommendation = AIMovieRecommendation(
            title: "Watched State",
            year: 2024,
            reason: "Reason",
            score: 0.9
        )

        await model.submitWatched(
            recommendation: recommendation,
            mode: .likeDislike,
            value: 1,
            service: service
        )
        #expect(model.cardState(for: recommendation) == .watched)
        #expect(model.visibleRecommendations(from: [recommendation]).isEmpty)
        #expect(model.statusMessage != nil)
    }

    @Test("Submit watched without service records failure state")
    func submitWatchedWithoutServiceFails() async throws {
        let model = DiscoverFeedbackViewModel()
        let recommendation = AIMovieRecommendation(
            title: "No Service",
            year: 2025,
            reason: "Reason",
            score: 0.9
        )

        await model.submitWatched(
            recommendation: recommendation,
            mode: .likeDislike,
            value: 1,
            service: nil
        )
        #expect(model.cardState(for: recommendation) == .failed("Feedback service unavailable."))
    }

    @Test("Mark not watched updates card state")
    func markNotWatchedUpdatesState() async throws {
        let db = try makeTestDatabase()
        let service = UserFeedbackService(database: db, metadataService: nil)
        let model = DiscoverFeedbackViewModel()
        let recommendation = AIMovieRecommendation(
            title: "Not Watched State",
            year: 2023,
            reason: "Reason",
            score: 0.55
        )

        await model.markNotWatched(recommendation: recommendation, service: service)
        #expect(model.cardState(for: recommendation) == .notWatched)
        #expect(model.visibleRecommendations(from: [recommendation]).isEmpty)
        #expect(model.statusMessage == "Marked as not watched.")
    }

    @Test("Mark not watched without service records failure state")
    func markNotWatchedWithoutServiceFails() async throws {
        let model = DiscoverFeedbackViewModel()
        let recommendation = AIMovieRecommendation(
            title: "No Service",
            year: 2025,
            reason: "Reason",
            score: 0.5
        )

        await model.markNotWatched(recommendation: recommendation, service: nil)
        #expect(model.cardState(for: recommendation) == .failed("Feedback service unavailable."))
    }

    @Test("cardMessage returns last status for recommendation")
    func cardMessageReturnsStatus() async throws {
        let db = try makeTestDatabase()
        let service = UserFeedbackService(database: db, metadataService: nil)
        let model = DiscoverFeedbackViewModel()
        let notWatched = AIMovieRecommendation(
            title: "Hidden Message",
            year: 2024,
            reason: "Reason",
            score: 0.5
        )
        let watched = AIMovieRecommendation(
            title: "Watched Message",
            year: 2024,
            reason: "Reason",
            score: 0.6
        )

        await model.markNotWatched(recommendation: notWatched, service: service)
        #expect(model.cardMessage(for: notWatched) == "Marked as not watched.")

        await model.submitWatched(
            recommendation: watched,
            mode: .likeDislike,
            value: 1,
            service: service
        )
        #expect(model.cardMessage(for: watched) == "Marked watched.")
    }

    @Test("Reset hidden state keeps only currently visible recommendation IDs")
    func resetHiddenStateDropsOldIDs() async throws {
        let db = try makeTestDatabase()
        let service = UserFeedbackService(database: db, metadataService: nil)
        let model = DiscoverFeedbackViewModel()
        let old = AIMovieRecommendation(title: "Old", year: 2020, reason: "Old", score: 0.5)
        let current = AIMovieRecommendation(title: "Current", year: 2021, reason: "Current", score: 0.6)

        await model.markNotWatched(recommendation: old, service: service)
        await model.markNotWatched(recommendation: current, service: service)
        model.resetHiddenState(for: [current])

        #expect(model.hiddenRecommendationIDs.contains(current.id))
        #expect(model.hiddenRecommendationIDs.contains(old.id) == false)
    }

    @Test("Media previews are hidden after feedback using stable recommendation IDs")
    func mediaPreviewVisibilityUsesRecommendationID() async throws {
        let db = try makeTestDatabase()
        let service = UserFeedbackService(database: db, metadataService: nil)
        let model = DiscoverFeedbackViewModel()
        let preview = MediaPreview(
            id: "tmdb-55",
            type: .movie,
            title: "Hidden Preview",
            year: 2024,
            posterPath: "/poster.jpg",
            imdbRating: 8.0,
            tmdbId: 55
        )
        let recommendation = model.recommendation(for: preview)

        await model.markNotWatched(recommendation: recommendation, service: service)

        let visible = model.visibleMediaPreviews(from: [preview])
        #expect(visible.isEmpty)
        #expect(model.hiddenRecommendationIDs.contains(recommendation.id))
    }

    @Test("Reset hidden state with valid IDs prunes stale card states")
    func resetHiddenStateWithValidIDs() async throws {
        let db = try makeTestDatabase()
        let service = UserFeedbackService(database: db, metadataService: nil)
        let model = DiscoverFeedbackViewModel()
        let first = AIMovieRecommendation(title: "First", year: 2024, reason: "r", score: 0.2)
        let second = AIMovieRecommendation(title: "Second", year: 2025, reason: "r", score: 0.8)

        await model.markNotWatched(recommendation: first, service: service)
        await model.markNotWatched(recommendation: second, service: service)

        model.resetHiddenState(validIDs: [second.id])

        #expect(model.hiddenRecommendationIDs == Set([second.id]))
        #expect(model.cardState(for: second) == .notWatched)
        #expect(model.cardState(for: first) == .idle)
    }
}
