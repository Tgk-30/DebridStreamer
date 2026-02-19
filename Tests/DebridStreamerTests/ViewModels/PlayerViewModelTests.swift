import Testing
import Foundation
import AVKit
import AppKit
@testable import DebridStreamer

@Suite("PlayerViewModel Tests")
@MainActor
struct PlayerViewModelTests {
    @Test("Successful AV playback sets AVPlayer and does not launch external player")
    func successfulAVPlayback() async {
        let stream = makeStream(url: "https://cdn.example.com/movie.mp4")
        let player = AVPlayer(url: URL(string: stream.streamURL)!)

        let model = PlayerViewModel(
            selector: PlayerEngineSelector(),
            avEngine: MockEngine(
                kind: .avPlayer,
                result: .success(
                    PreparedPlayback(
                        kind: .avPlayer,
                        streamURL: URL(string: stream.streamURL)!,
                        avPlayer: player,
                        vlcSession: nil
                    )
                )
            ),
            vlcEngine: MockEngine(kind: .vlc, result: .failure(PlayerEngineError.vlcKitUnavailable)),
            externalLauncher: ExternalPlayerLauncher(
                resolveApplicationInstalled: { _ in true },
                openWithBundle: { _, _ in false },
                openWithDefaultApplication: { _ in false }
            )
        )

        await model.preparePlayback(
            stream: stream,
            backendPreference: .automatic,
            externalPlayerPreference: .auto
        )

        #expect(model.avPlayer != nil)
        #expect(model.launchedExternal == false)
        #expect(model.errorMessage == nil)
    }

    @Test("Engine failures fall back to external launch")
    func fallsBackToExternalLaunch() async {
        let stream = makeStream(url: "https://cdn.example.com/movie.mkv")
        var defaultOpenCalls = 0

        let model = PlayerViewModel(
            selector: PlayerEngineSelector(),
            avEngine: MockEngine(kind: .avPlayer, result: .failure(PlayerEngineError.unsupported("AV failed"))),
            vlcEngine: MockEngine(kind: .vlc, result: .failure(PlayerEngineError.vlcKitUnavailable)),
            externalLauncher: ExternalPlayerLauncher(
                resolveApplicationInstalled: { _ in false },
                openWithBundle: { _, _ in false },
                openWithDefaultApplication: { _ in
                    defaultOpenCalls += 1
                    return true
                }
            )
        )

        await model.preparePlayback(
            stream: stream,
            backendPreference: .automatic,
            externalPlayerPreference: .auto
        )

        #expect(model.avPlayer == nil)
        #expect(model.launchedExternal == true)
        #expect(defaultOpenCalls == 1)
    }

    @Test("When external fallback also fails an error is exposed")
    func reportsErrorWhenAllPlaybackPathsFail() async {
        let stream = makeStream(url: "https://cdn.example.com/movie.mkv")

        let model = PlayerViewModel(
            selector: PlayerEngineSelector(),
            avEngine: MockEngine(kind: .avPlayer, result: .failure(PlayerEngineError.unsupported("AV failed"))),
            vlcEngine: MockEngine(kind: .vlc, result: .failure(PlayerEngineError.vlcKitUnavailable)),
            externalLauncher: ExternalPlayerLauncher(
                resolveApplicationInstalled: { _ in false },
                openWithBundle: { _, _ in false },
                openWithDefaultApplication: { _ in false }
            )
        )

        await model.preparePlayback(
            stream: stream,
            backendPreference: .automatic,
            externalPlayerPreference: .auto
        )

        #expect(model.launchedExternal == false)
        #expect(model.errorMessage?.isEmpty == false)
    }

    @Test("VLC playback path is used when engine prepares session")
    func vlcPlaybackPath() async {
        let stream = makeStream(url: "https://cdn.example.com/movie.mkv")
        let vlcSession = MockVLCSession()

        let model = PlayerViewModel(
            selector: PlayerEngineSelector(),
            avEngine: MockEngine(kind: .avPlayer, result: .failure(PlayerEngineError.unsupported("AV failed"))),
            vlcEngine: MockEngine(
                kind: .vlc,
                result: .success(
                    PreparedPlayback(
                        kind: .vlc,
                        streamURL: URL(string: stream.streamURL)!,
                        avPlayer: nil,
                        vlcSession: vlcSession
                    )
                )
            ),
            externalLauncher: ExternalPlayerLauncher(
                resolveApplicationInstalled: { _ in false },
                openWithBundle: { _, _ in false },
                openWithDefaultApplication: { _ in false }
            )
        )

        await model.preparePlayback(
            stream: stream,
            backendPreference: .automatic,
            externalPlayerPreference: .auto
        )

        #expect(model.selectedEngine == .vlc)
        #expect(model.vlcSession != nil)
        #expect(vlcSession.playCallCount == 1)
    }

    private func makeStream(url: String) -> StreamInfo {
        StreamInfo(
            streamURL: url,
            quality: .hd1080p,
            codec: .h264,
            audio: .aac,
            source: .webDL,
            sizeBytes: 1_000_000_000,
            fileName: "Movie.1080p",
            debridService: "Real-Debrid"
        )
    }
}

private struct MockEngine: PlayerEngine {
    let kind: PlayerEngineKind
    let result: Result<PreparedPlayback, Error>

    func canHandle(_ stream: StreamInfo) -> Bool { true }

    @MainActor
    func prepare(stream: StreamInfo) async throws -> PreparedPlayback {
        try result.get()
    }
}

@MainActor
private final class MockVLCSession: VLCPlaybackSession {
    var isPlaying: Bool = false
    var position: Float = 0
    var currentTimeSeconds: Double = 0
    var durationSeconds: Double? = 0
    var playCallCount = 0

    func makeVideoView() -> NSView { NSView(frame: .zero) }
    func seek(to seconds: Double) {
        currentTimeSeconds = max(0, seconds)
    }
    func play() {
        playCallCount += 1
        isPlaying = true
    }
    func pause() { isPlaying = false }
    func stop() { isPlaying = false }
}
