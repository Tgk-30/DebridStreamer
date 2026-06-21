import Foundation

enum PlayerRuntimeState: String, Sendable, Equatable {
    case preparing
    case buffering
    case playing
    case stalled
    case failed
    case fallbackLaunched

    var displayName: String {
        switch self {
        case .preparing:
            return "Preparing"
        case .buffering:
            return "Buffering"
        case .playing:
            return "Playing"
        case .stalled:
            return "Stalled"
        case .failed:
            return "Failed"
        case .fallbackLaunched:
            return "Fallback Launched"
        }
    }
}
