import Foundation

enum InternalPlayerBackend: String, Codable, Sendable, CaseIterable {
    case automatic
    case avPlayer = "av_player"
    case vlc

    var displayName: String {
        switch self {
        case .automatic:
            return "Automatic (Best)"
        case .avPlayer:
            return "AVPlayer"
        case .vlc:
            return "VLC"
        }
    }
}
