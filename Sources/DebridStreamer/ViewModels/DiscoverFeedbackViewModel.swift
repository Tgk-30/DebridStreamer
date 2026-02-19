import Foundation
import Observation

@MainActor
@Observable
final class DiscoverFeedbackViewModel {
    enum CardState: Equatable {
        case idle
        case saving
        case watched
        case notWatched
        case failed(String)
    }

    struct PendingFeedback: Identifiable, Equatable {
        let recommendation: AIMovieRecommendation
        let mode: FeedbackScaleMode
        var value: Double?

        var id: String { recommendation.id }
    }

    private(set) var cardStates: [String: CardState] = [:]
    var pendingFeedback: PendingFeedback?

    func cardState(for recommendation: AIMovieRecommendation) -> CardState {
        cardStates[recommendation.id] ?? .idle
    }

    func beginWatchedFlow(
        recommendation: AIMovieRecommendation,
        settings: SettingsManager?
    ) async -> FeedbackScaleMode {
        let mode = (try? await settings?.getFeedbackScaleMode()) ?? .likeDislike
        if mode == .none {
            pendingFeedback = nil
        } else {
            pendingFeedback = PendingFeedback(
                recommendation: recommendation,
                mode: mode,
                value: defaultFeedbackValue(for: mode)
            )
        }
        return mode
    }

    func markNotWatched(
        recommendation: AIMovieRecommendation,
        service: UserFeedbackService?
    ) async {
        guard let service else {
            cardStates[recommendation.id] = .failed("Feedback service unavailable.")
            return
        }
        cardStates[recommendation.id] = .saving
        await service.recordRecommendationFeedback(
            recommendation: recommendation,
            watchedState: .notWatched,
            feedbackScaleMode: .none,
            feedbackValue: nil,
            source: .manual
        )
        cardStates[recommendation.id] = .notWatched
    }

    func submitWatched(
        recommendation: AIMovieRecommendation,
        mode: FeedbackScaleMode,
        value: Double?,
        service: UserFeedbackService?
    ) async {
        guard let service else {
            cardStates[recommendation.id] = .failed("Feedback service unavailable.")
            return
        }

        cardStates[recommendation.id] = .saving
        await service.recordRecommendationFeedback(
            recommendation: recommendation,
            watchedState: .watched,
            feedbackScaleMode: mode,
            feedbackValue: value,
            source: .manual
        )
        cardStates[recommendation.id] = .watched
        pendingFeedback = nil
    }

    func dismissPendingFeedback() {
        pendingFeedback = nil
    }

    private func defaultFeedbackValue(for mode: FeedbackScaleMode) -> Double? {
        switch mode {
        case .none:
            return nil
        case .likeDislike:
            return 1
        case .scale1to10:
            return 8
        case .scale1to100:
            return 80
        }
    }
}
