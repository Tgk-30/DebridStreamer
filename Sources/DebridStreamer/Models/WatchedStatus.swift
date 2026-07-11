import Foundation

/// Derived watched state for a title in the library UI.
///
/// A pure reduction of the two persisted signals the app already tracks: a
/// `WatchHistory` row (playback progress written by the player) and the latest
/// explicit `WatchedState` the user set through the rating flow. Deriving both
/// through one function keeps the watched/unwatched indicator consistent
/// wherever it appears (library grid, history rows, item detail).
enum WatchedStatus: String, Equatable, Sendable {
    /// Finished, or explicitly marked watched.
    case watched
    /// Meaningful playback progress but not finished.
    case inProgress
    /// No progress recorded and never marked watched.
    case unwatched

    /// Reduce the two signals into a single status.
    ///
    /// Precedence:
    /// 1. An explicit `WatchedState.watched`, or `history.completed`, yields
    ///    `.watched`.
    /// 2. Otherwise a resume point (`history.hasResumePoint`) yields
    ///    `.inProgress`.
    /// 3. Otherwise `.unwatched`.
    ///
    /// An explicit `WatchedState.notWatched` never forces `.unwatched` on its
    /// own: a resume point still reads as `.inProgress`. It only means the title
    /// is not promoted to `.watched` by that signal.
    static func derive(history: WatchHistory?, watchedState: WatchedState?) -> WatchedStatus {
        if watchedState == .watched || history?.completed == true {
            return .watched
        }
        if history?.hasResumePoint == true {
            return .inProgress
        }
        return .unwatched
    }

    var isWatched: Bool { self == .watched }
    var isInProgress: Bool { self == .inProgress }
}
