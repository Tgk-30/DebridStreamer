import Testing
import Foundation
@testable import DebridStreamer

@Suite("WatchedStatus Tests")
struct WatchedStatusTests {
    // MARK: - Helpers

    private func history(
        progressSeconds: Double,
        durationSeconds: Double?,
        completed: Bool
    ) -> WatchHistory {
        WatchHistory(
            id: "wh-1",
            mediaId: "tt1234567",
            progressSeconds: progressSeconds,
            durationSeconds: durationSeconds,
            completed: completed,
            lastWatched: Date()
        )
    }

    /// ~50% through, not flagged completed — a genuine resume point.
    private var inProgressHistory: WatchHistory {
        history(progressSeconds: 3600, durationSeconds: 7200, completed: false)
    }

    /// Flagged completed by the player at >= 95%.
    private var completedHistory: WatchHistory {
        history(progressSeconds: 7200, durationSeconds: 7200, completed: true)
    }

    // MARK: - Three base states

    @Test("Unwatched when there is no history and no watched state")
    func unwatchedWhenNothing() {
        #expect(WatchedStatus.derive(history: nil, watchedState: nil) == .unwatched)
    }

    @Test("In progress from a resume point")
    func inProgressFromResumePoint() {
        #expect(WatchedStatus.derive(history: inProgressHistory, watchedState: nil) == .inProgress)
    }

    @Test("Watched from completed history")
    func watchedFromCompletedHistory() {
        #expect(WatchedStatus.derive(history: completedHistory, watchedState: nil) == .watched)
    }

    @Test("Watched from an explicit watched state alone")
    func watchedFromExplicitState() {
        #expect(WatchedStatus.derive(history: nil, watchedState: .watched) == .watched)
    }

    // MARK: - Precedence

    @Test("Explicit watched wins over an in-progress resume point")
    func explicitWatchedBeatsResumePoint() {
        #expect(WatchedStatus.derive(history: inProgressHistory, watchedState: .watched) == .watched)
    }

    @Test("Completed history wins even when the latest state is not watched")
    func completedBeatsNotWatched() {
        #expect(WatchedStatus.derive(history: completedHistory, watchedState: .notWatched) == .watched)
    }

    @Test("Not-watched state does not force unwatched over a resume point")
    func notWatchedKeepsInProgress() {
        #expect(WatchedStatus.derive(history: inProgressHistory, watchedState: .notWatched) == .inProgress)
    }

    @Test("Not-watched state with no history is unwatched")
    func notWatchedWithoutHistoryIsUnwatched() {
        #expect(WatchedStatus.derive(history: nil, watchedState: .notWatched) == .unwatched)
    }

    // MARK: - Boundary: history present but below the resume threshold

    @Test("Barely-started history (below 2%) is unwatched")
    func belowResumeThresholdIsUnwatched() {
        let barelyStarted = history(progressSeconds: 10, durationSeconds: 7200, completed: false)
        #expect(WatchedStatus.derive(history: barelyStarted, watchedState: nil) == .unwatched)
    }

    // MARK: - Convenience flags

    @Test("Convenience flags match the case")
    func convenienceFlags() {
        #expect(WatchedStatus.watched.isWatched == true)
        #expect(WatchedStatus.watched.isInProgress == false)
        #expect(WatchedStatus.inProgress.isInProgress == true)
        #expect(WatchedStatus.inProgress.isWatched == false)
        #expect(WatchedStatus.unwatched.isWatched == false)
        #expect(WatchedStatus.unwatched.isInProgress == false)
    }
}
