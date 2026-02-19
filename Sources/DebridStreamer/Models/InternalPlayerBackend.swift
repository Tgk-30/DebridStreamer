import Foundation

enum InternalPlayerBackend: String, Codable, Sendable, CaseIterable {
    case automatic
    case vlc

    var displayName: String {
        switch self {
        case .automatic:
            return "Automatic (VLC)"
        case .vlc:
            return "VLC"
        }
    }
}
