import Foundation
import AVKit

enum PlayerEngineKind: String, Sendable {
    case avPlayer
    case vlc

    var displayName: String {
        switch self {
        case .avPlayer:
            return "AVPlayer"
        case .vlc:
            return "VLC"
        }
    }
}

enum PlayerEngineError: LocalizedError, Equatable {
    case invalidStreamURL(String)
    case streamHTTPStatus(Int)
    case network(String)
    case unsupported(String)
    case vlcKitUnavailable

    var errorDescription: String? {
        switch self {
        case .invalidStreamURL(let value):
            return "Invalid stream URL: \(value)"
        case .streamHTTPStatus(let status):
            return "Stream returned HTTP \(status)."
        case .network(let message):
            return "Network check failed: \(message)"
        case .unsupported(let message):
            return message
        case .vlcKitUnavailable:
            return "VLCKit is not bundled in this build."
        }
    }
}

struct PreparedPlayback {
    let kind: PlayerEngineKind
    let streamURL: URL
    let avPlayer: AVPlayer?
    let vlcSession: (any VLCPlaybackSession)?
}

protocol PlayerEngine {
    var kind: PlayerEngineKind { get }
    func canHandle(_ stream: StreamInfo) -> Bool
    @MainActor func prepare(stream: StreamInfo) async throws -> PreparedPlayback
}
