import Foundation

/// Preferred playback app for opening resolved stream URLs.
enum PreferredPlayer: String, Codable, Sendable, CaseIterable {
    case auto
    case builtIn = "built_in"
    case iina
    case vlc
    case mpv
    case quickTime = "quicktime"
    case systemDefault = "system_default"

    var displayName: String {
        switch self {
        case .auto:
            return "Auto (IINA/VLC/mpv)"
        case .builtIn:
            return "Built-in Player"
        case .iina:
            return "IINA"
        case .vlc:
            return "VLC"
        case .mpv:
            return "mpv"
        case .quickTime:
            return "QuickTime Player"
        case .systemDefault:
            return "System Default App"
        }
    }

    var bundleIdentifier: String? {
        switch self {
        case .iina:
            return "com.colliderli.iina"
        case .vlc:
            return "org.videolan.vlc"
        case .mpv:
            return "io.mpv"
        case .quickTime:
            return "com.apple.QuickTimePlayerX"
        case .auto, .builtIn, .systemDefault:
            return nil
        }
    }

    static let autoBundlePriority: [String] = [
        "com.colliderli.iina",
        "org.videolan.vlc",
        "io.mpv",
        "com.apple.QuickTimePlayerX"
    ]
}
