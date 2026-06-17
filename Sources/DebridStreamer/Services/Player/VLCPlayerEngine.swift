import Foundation

struct VLCPlayerEngine: PlayerEngine {
    let kind: PlayerEngineKind = .vlc
    private let sessionFactory: @MainActor (URL) throws -> any VLCPlaybackSession

    init(
        sessionFactory: @escaping @MainActor (URL) throws -> any VLCPlaybackSession = { try Self.defaultSessionFactory(url: $0) }
    ) {
        self.sessionFactory = sessionFactory
    }

    func canHandle(_ stream: StreamInfo) -> Bool {
        stream.url != nil
    }

    @MainActor
    func prepare(stream: StreamInfo) async throws -> PreparedPlayback {
        guard let url = stream.url else {
            throw PlayerEngineError.invalidStreamURL(stream.streamURL)
        }

        let session = try sessionFactory(url)
        return PreparedPlayback(
            kind: .vlc,
            streamURL: url,
            avPlayer: nil,
            vlcSession: session
        )
    }

    @MainActor
    private static func defaultSessionFactory(url: URL) throws -> any VLCPlaybackSession {
        #if canImport(VLCKit)
        return VLCKitPlaybackSession(url: url)
        #else
        throw PlayerEngineError.vlcKitUnavailable
        #endif
    }
}
