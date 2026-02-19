import Testing
import Foundation
import AppKit
@testable import DebridStreamer

@Suite("PlayerViewModel Tests")
@MainActor
struct PlayerViewModelTests {
    @Test("Successful VLC playback sets active engine and playing state")
    func successfulVLCPlayback() async throws {
        let stream = makeStream(url: "https://cdn.example.com/movie.mkv")
        let session = MockVLCSession()
        let model = PlayerViewModel(
            selector: PlayerEngineSelector(),
            vlcEngine: MockEngine(
                kind: .vlc,
                result: .success(
                    PreparedPlayback(
                        kind: .vlc,
                        streamURL: URL(string: stream.streamURL)!,
                        avPlayer: nil,
                        vlcSession: session
                    )
                )
            )
        )

        await model.preparePlayback(
            stream: stream,
            backendPreference: .automatic,
            externalPlayerPreference: .auto
        )

        #expect(model.selectedEngine == .vlc)
        #expect(model.vlcSession != nil)
        #expect(model.runtimeState == .playing)
        #expect(model.errorMessage == nil)
    }

    @Test("VLC failures remain in-app and expose failed runtime state")
    func failureStaysInApp() async {
        let stream = makeStream(url: "https://cdn.example.com/movie.mkv")
        let model = PlayerViewModel(
            selector: PlayerEngineSelector(),
            vlcEngine: MockEngine(
                kind: .vlc,
                result: .failure(PlayerEngineError.vlcKitUnavailable)
            )
        )

        await model.preparePlayback(
            stream: stream,
            backendPreference: .automatic,
            externalPlayerPreference: .auto
        )

        #expect(model.selectedEngine == nil)
        #expect(model.runtimeState == .failed)
        #expect(model.errorMessage?.isEmpty == false)
    }

    @Test("Retry with VLC re-prepares same stream")
    func retryVLC() async {
        let stream = makeStream(url: "https://cdn.example.com/movie.mkv")
        let session = MockVLCSession()
        let engine = MockEngine(
            kind: .vlc,
            result: .success(
                PreparedPlayback(
                    kind: .vlc,
                    streamURL: URL(string: stream.streamURL)!,
                    avPlayer: nil,
                    vlcSession: session
                )
            )
        )

        let model = PlayerViewModel(selector: PlayerEngineSelector(), vlcEngine: engine)

        await model.preparePlayback(
            stream: stream,
            backendPreference: .automatic,
            externalPlayerPreference: .auto
        )
        await model.retryWithEngine(.vlc)

        #expect(engine.prepareCalls >= 2)
        #expect(model.selectedEngine == .vlc)
    }

    @Test("Playback progress snapshot survives stop")
    func progressSnapshotSurvivesStop() async {
        let model = PlayerViewModel()
        let session = MockVLCSession()
        session.currentTimeSeconds = 321
        session.durationSeconds = 900
        session.isPlaying = true

        model.vlcSession = session
        model.selectedEngine = .vlc

        let snapshot = model.playbackProgressSnapshot()
        model.stop()

        #expect(snapshot?.progressSeconds == 321)
        #expect(snapshot?.durationSeconds == 900)
        #expect(model.vlcSession == nil)
        #expect(session.stopCallCount == 1)
    }

    @Test("Fullscreen toggle invokes configured toggler")
    func fullscreenToggleInvokesToggler() async {
        var toggleCount = 0
        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 640, height: 360),
            styleMask: [.titled, .closable, .resizable],
            backing: .buffered,
            defer: false
        )
        let model = PlayerViewModel(
            fullscreenToggler: { _ in toggleCount += 1 },
            fullscreenWindowResolver: { _ in window }
        )

        await model.toggleFullscreen(window: window)
        #expect(toggleCount == 1)
        #expect(model.isFullscreenTransitioning == false)
    }

    @Test("Fullscreen toggle reports diagnostics when unavailable")
    func fullscreenToggleWithoutWindowReportsDiagnostics() async {
        let model = PlayerViewModel(
            fullscreenToggler: { _ in },
            fullscreenWindowResolver: { _ in nil }
        )

        await model.toggleFullscreen(window: nil)
        #expect(model.diagnostics?.contains("Fullscreen is unavailable") == true)
    }

    @Test("Fullscreen transition guard prevents duplicate toggles")
    func fullscreenTransitionGuard() async {
        var toggleCount = 0
        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 640, height: 360),
            styleMask: [.titled, .closable, .resizable],
            backing: .buffered,
            defer: false
        )
        let model = PlayerViewModel(
            fullscreenToggler: { _ in
                toggleCount += 1
            },
            fullscreenWindowResolver: { _ in window }
        )

        await withTaskGroup(of: Void.self) { group in
            group.addTask { await model.toggleFullscreen(window: window) }
            group.addTask { await model.toggleFullscreen(window: window) }
        }

        #expect(toggleCount == 1)
        #expect(model.diagnostics?.contains("already in progress") == true || model.diagnostics?.contains("fullscreen") == true)
    }

    @Test("Fullscreen state follows window callback updates")
    func fullscreenCallbackStateUpdate() async {
        let model = PlayerViewModel()
        #expect(model.isFullscreenActive == false)
        model.setFullscreenActive(true)
        #expect(model.isFullscreenActive == true)
        model.setFullscreenActive(false)
        #expect(model.isFullscreenActive == false)
    }

    @Test("Controls auto-hide and reappear on interaction")
    func controlsAutoHide() async {
        let stream = makeStream(url: "https://cdn.example.com/movie.mkv")
        let session = MockVLCSession()
        session.isPlaying = true
        let model = PlayerViewModel(
            selector: PlayerEngineSelector(),
            vlcEngine: MockEngine(
                kind: .vlc,
                result: .success(
                    PreparedPlayback(
                        kind: .vlc,
                        streamURL: URL(string: stream.streamURL)!,
                        avPlayer: nil,
                        vlcSession: session
                    )
                )
            ),
            controlsAutoHideDelay: 0.05
        )

        await model.preparePlayback(
            stream: stream,
            backendPreference: .automatic,
            externalPlayerPreference: .auto
        )
        #expect(model.controlsVisible == true)

        for _ in 0..<40 {
            if model.controlsVisible == false {
                break
            }
            try? await Task.sleep(for: .milliseconds(50))
        }
        #expect(model.controlsVisible == false)

        model.registerUserInteraction()
        #expect(model.controlsVisible == true)
    }

    @Test("Controls stay visible while paused")
    func controlsStayVisibleWhenPaused() async {
        let stream = makeStream(url: "https://cdn.example.com/movie.mkv")
        let session = MockVLCSession()
        session.isPlaying = true
        let model = PlayerViewModel(
            selector: PlayerEngineSelector(),
            vlcEngine: MockEngine(
                kind: .vlc,
                result: .success(
                    PreparedPlayback(
                        kind: .vlc,
                        streamURL: URL(string: stream.streamURL)!,
                        avPlayer: nil,
                        vlcSession: session
                    )
                )
            ),
            controlsAutoHideDelay: 0.05
        )

        await model.preparePlayback(
            stream: stream,
            backendPreference: .automatic,
            externalPlayerPreference: .auto
        )
        model.togglePlayPause() // Pause
        try? await Task.sleep(for: .milliseconds(100))

        #expect(model.runtimeState == .stalled)
        #expect(model.controlsVisible == true)
    }

    @Test("Track refresh and selection flows through VLC session")
    func trackSelectionFlow() async {
        let stream = makeStream(url: "https://cdn.example.com/movie.mkv")
        let session = MockVLCSession()
        session.availableAudioTracks = [
            VLCTrackOption(id: 1, name: "English"),
            VLCTrackOption(id: 2, name: "Spanish")
        ]
        session.availableSubtitleTracks = [
            VLCTrackOption(id: -1, name: "Off"),
            VLCTrackOption(id: 4, name: "English CC")
        ]

        let model = PlayerViewModel(
            selector: PlayerEngineSelector(),
            vlcEngine: MockEngine(
                kind: .vlc,
                result: .success(
                    PreparedPlayback(
                        kind: .vlc,
                        streamURL: URL(string: stream.streamURL)!,
                        avPlayer: nil,
                        vlcSession: session
                    )
                )
            )
        )

        await model.preparePlayback(
            stream: stream,
            backendPreference: .automatic,
            externalPlayerPreference: .auto
        )
        model.refreshTrackOptions()
        model.selectAudioTrack(2)
        model.selectSubtitleTrack(4)

        #expect(model.availableAudioTracks.count == 2)
        #expect(model.availableSubtitleTracks.count == 2)
        #expect(model.selectedAudioTrackID == 2)
        #expect(model.selectedSubtitleTrackID == 4)
    }

    @Test("Switching stream updates selected stream URL")
    func switchStreamUpdatesSelection() async {
        let first = makeStream(url: "https://cdn.example.com/movie-1080.mkv")
        let second = makeStream(url: "https://cdn.example.com/movie-720.mkv")
        let session = MockVLCSession()
        let engine = MockEngine(
            kind: .vlc,
            result: .success(
                PreparedPlayback(
                    kind: .vlc,
                    streamURL: URL(string: first.streamURL)!,
                    avPlayer: nil,
                    vlcSession: session
                )
            )
        )

        let model = PlayerViewModel(selector: PlayerEngineSelector(), vlcEngine: engine)
        await model.preparePlayback(
            stream: first,
            availableStreams: [first, second],
            backendPreference: .automatic,
            externalPlayerPreference: .auto
        )

        await model.switchToStream(second)
        #expect(model.selectedStreamURL == second.streamURL)
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

private final class MockEngine: PlayerEngine {
    let kind: PlayerEngineKind
    let result: Result<PreparedPlayback, Error>
    private(set) var prepareCalls = 0

    init(kind: PlayerEngineKind, result: Result<PreparedPlayback, Error>) {
        self.kind = kind
        self.result = result
    }

    func canHandle(_ stream: StreamInfo) -> Bool {
        _ = stream
        return true
    }

    @MainActor
    func prepare(stream: StreamInfo) async throws -> PreparedPlayback {
        _ = stream
        prepareCalls += 1
        return try result.get()
    }
}

@MainActor
private final class MockVLCSession: VLCPlaybackSession {
    var isPlaying: Bool = false
    var position: Float = 0
    var playbackRate: Float = 1.0
    var currentTimeSeconds: Double = 0
    var durationSeconds: Double? = 0
    var availableAudioTracks: [VLCTrackOption] = []
    var availableSubtitleTracks: [VLCTrackOption] = []
    var selectedAudioTrackID: Int32?
    var selectedSubtitleTrackID: Int32?
    var stopCallCount = 0

    func makeVideoView() -> NSView { NSView(frame: .zero) }

    func seek(to seconds: Double) {
        currentTimeSeconds = max(0, seconds)
    }

    func refreshTrackOptions() {}

    func selectAudioTrack(id: Int32) {
        selectedAudioTrackID = id
    }

    func selectSubtitleTrack(id: Int32) {
        selectedSubtitleTrackID = id
    }

    func play() { isPlaying = true }
    func pause() { isPlaying = false }
    func stop() {
        stopCallCount += 1
        isPlaying = false
    }
}
