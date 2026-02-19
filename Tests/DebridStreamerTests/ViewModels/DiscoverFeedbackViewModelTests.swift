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
    }
}
