import Foundation

struct PlayerEngineSelector {
    func engineOrder(
        for stream: StreamInfo,
        backendPreference: InternalPlayerBackend
    ) -> [PlayerEngineKind] {
        _ = stream
        _ = backendPreference
        return [.vlc]
    }
}
