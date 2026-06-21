import Testing
import Foundation
@testable import DebridStreamer

@Suite("RenewalEvaluator Tests")
struct RenewalEvaluatorTests {
    @Test("Returning or in-production series are added to release wait when liked")
    func returningSeriesAdded() {
        let evaluator = RenewalEvaluator()
        let metadata = TMDBSeriesRenewalMetadata(
            status: "Returning Series",
            inProduction: true,
            nextEpisodeAirDate: nil,
            lastAirDate: "2025-10-01",
            numberOfSeasons: 3
        )

        let result = evaluator.evaluateSeries(metadata: metadata, liked: true)
        #expect(result.shouldAddToReleaseWait == true)
        #expect(result.renewalStatus == "Returning Series")
    }

    @Test("Future next episode date is treated as release wait signal")
    func futureEpisodeDateAdded() {
        let evaluator = RenewalEvaluator()
        let metadata = TMDBSeriesRenewalMetadata(
            status: "Ended",
            inProduction: false,
            nextEpisodeAirDate: "2099-01-10",
            lastAirDate: "2024-01-01",
            numberOfSeasons: 1
        )

        let result = evaluator.evaluateSeries(metadata: metadata, liked: true, now: Date(timeIntervalSince1970: 0))
        #expect(result.shouldAddToReleaseWait == true)
        #expect(result.releaseDateHint == "2099-01-10")
    }

    @Test("Disliked series is not added to release wait")
    func dislikedSeriesSkipped() {
        let evaluator = RenewalEvaluator()
        let metadata = TMDBSeriesRenewalMetadata(
            status: "Returning Series",
            inProduction: true,
            nextEpisodeAirDate: "2026-05-01",
            lastAirDate: "2025-05-01",
            numberOfSeasons: 2
        )

        let result = evaluator.evaluateSeries(metadata: metadata, liked: false)
        #expect(result.shouldAddToReleaseWait == false)
    }
}
