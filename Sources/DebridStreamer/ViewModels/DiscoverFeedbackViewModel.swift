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
    private(set) var cardMessages: [String: String] = [:]
    private(set) var hiddenRecommendationIDs: Set<String> = []
    var statusMessage: String?
    var pendingFeedback: PendingFeedback?

    func cardState(for recommendation: AIMovieRecommendation) -> CardState {
        cardStates[recommendation.id] ?? .idle
    }

    func visibleRecommendations(from recommendations: [AIMovieRecommendation]) -> [AIMovieRecommendation] {
        recommendations.filter { !hiddenRecommendationIDs.contains($0.id) }
    }

    func visibleMediaPreviews(from items: [MediaPreview]) -> [MediaPreview] {
        items.filter { !hiddenRecommendationIDs.contains(recommendationID(for: $0)) }
    }

    func recommendationID(for preview: MediaPreview) -> String {
        recommendation(for: preview).id
    }

    func recommendation(for preview: MediaPreview, reason: String = "From Discover") -> AIMovieRecommendation {
        AIMovieRecommendation(
            title: preview.title,
            year: preview.year,
            reason: reason,
            score: preview.imdbRating ?? 0,
            mediaId: preview.id,
            mediaType: preview.type,
            posterPath: preview.posterPath
        )
    }

    func resetHiddenState(for recommendations: [AIMovieRecommendation]) {
        resetHiddenState(validIDs: Set(recommendations.map(\.id)))
    }

    func resetHiddenState(validIDs: Set<String>) {
        hiddenRecommendationIDs = hiddenRecommendationIDs.intersection(validIDs)
        cardStates = cardStates.filter { validIDs.contains($0.key) }
        cardMessages = cardMessages.filter { validIDs.contains($0.key) }
    }

    func cardMessage(for recommendation: AIMovieRecommendation) -> String? {
        cardMessages[recommendation.id]
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
        _ = await service.recordRecommendationFeedback(
            recommendation: recommendation,
            watchedState: .notWatched,
            feedbackScaleMode: .none,
            feedbackValue: nil,
            source: .manual
        )
        cardStates[recommendation.id] = .notWatched
        let message = "Marked as not watched."
        cardMessages[recommendation.id] = message
        statusMessage = message
        hiddenRecommendationIDs.insert(recommendation.id)
        pendingFeedback = nil
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
        let outcome = await service.recordRecommendationFeedback(
            recommendation: recommendation,
            watchedState: .watched,
            feedbackScaleMode: mode,
            feedbackValue: value,
            source: .manual
        )
        cardStates[recommendation.id] = .watched
        let message: String
        if outcome.addedToReleaseWait {
            if let releaseDateHint = outcome.releaseDateHint, !releaseDateHint.isEmpty {
                if let renewalStatus = outcome.renewalStatus, !renewalStatus.isEmpty {
                    message = "Marked watched and added to Release Wait (\(renewalStatus), \(releaseDateHint))."
                } else {
                    message = "Marked watched and added to Release Wait (\(releaseDateHint))."
                }
            } else if let renewalStatus = outcome.renewalStatus, !renewalStatus.isEmpty {
                message = "Marked watched and added to Release Wait (\(renewalStatus))."
            } else {
                message = "Marked watched and added to Release Wait."
            }
        } else if outcome.addedToWatchedFolder {
            message = "Marked watched and added to Watched."
        } else {
            message = "Marked watched."
        }
        cardMessages[recommendation.id] = message
        statusMessage = message
        hiddenRecommendationIDs.insert(recommendation.id)
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
