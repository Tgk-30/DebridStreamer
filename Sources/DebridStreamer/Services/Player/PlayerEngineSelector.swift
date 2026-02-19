import Foundation

struct PlayerEngineSelector {
    func engineOrder(
        for stream: StreamInfo,
        backendPreference: InternalPlayerBackend
    ) -> [PlayerEngineKind] {
        switch backendPreference {
        case .avPlayer:
            return [.avPlayer, .vlc]
        case .vlc:
            return [.vlc, .avPlayer]
        case .automatic:
            if prefersVLC(for: stream) {
                return [.vlc, .avPlayer]
            }
            return [.avPlayer, .vlc]
        }
    }

    private func prefersVLC(for stream: StreamInfo) -> Bool {
        let extensionBased = stream.url?.pathExtension.lowercased() ?? ""
        let vlcPreferredExtensions = Set(["mkv", "avi", "flv", "wmv", "webm", "m2ts"])
        if vlcPreferredExtensions.contains(extensionBased) {
            return true
        }

        if stream.codec == .av1 {
            return true
        }

        return false
    }
}
