import Foundation

enum FeedbackScaleMode: String, Codable, Sendable, CaseIterable, Identifiable {
    case none
    case likeDislike = "like_dislike"
    case scale1to10 = "scale_1_10"
    case scale1to100 = "scale_1_100"

    var id: String { rawValue }

    var displayName: String {
        switch self {
        case .none:
            return "None"
        case .likeDislike:
            return "Like / Dislike"
        case .scale1to10:
            return "1 to 10"
        case .scale1to100:
            return "1 to 100"
        }
    }
}

enum WatchedState: String, Codable, Sendable, CaseIterable {
    case watched
    case notWatched = "not_watched"
}

enum FeedbackSource: String, Codable, Sendable {
    case manual
    case auto
}
