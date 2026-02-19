import Testing
import Foundation
import AVKit
import AppKit
@testable import DebridStreamer

@Suite("PlayerViewModel Tests")
@MainActor
struct PlayerViewModelTests {
    @Test("Successful AV playback sets playing state")
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
            avReadinessMonitor: ImmediateReadinessMonitor(),
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
        #expect(model.selectedEngine == .avPlayer)
        #expect(model.runtimeState == .playing)
        #expect(model.launchedExternal == false)
        #expect(model.errorMessage == nil)
    }

    @Test("AV timeout/failure falls back to VLC")
    func avFailureFallsBackToVLC() async {
        let stream = makeStream(url: "https://cdn.example.com/movie.mkv")
        let player = AVPlayer(url: URL(string: stream.streamURL)!)
        let vlcSession = MockVLCSession()

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
            avReadinessMonitor: FailingReadinessMonitor(),
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
        #expect(model.runtimeState == .playing || model.runtimeState == .stalled)
    }

    @Test("Engine failures fall back to external launch")
    func fallsBackToExternalLaunch() async {
        let stream = makeStream(url: "https://cdn.example.com/movie.mkv")
        var defaultOpenCalls = 0

        let model = PlayerViewModel(
            selector: PlayerEngineSelector(),
            avEngine: MockEngine(kind: .avPlayer, result: .failure(PlayerEngineError.unsupported("AV failed"))),
            vlcEngine: MockEngine(kind: .vlc, result: .failure(PlayerEngineError.vlcKitUnavailable)),
            avReadinessMonitor: ImmediateReadinessMonitor(),
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
        #expect(model.runtimeState == .fallbackLaunched)
        #expect(defaultOpenCalls == 1)
    }

    @Test("When external fallback also fails a failed state is exposed")
    func reportsErrorWhenAllPlaybackPathsFail() async {
        let stream = makeStream(url: "https://cdn.example.com/movie.mkv")

        let model = PlayerViewModel(
            selector: PlayerEngineSelector(),
            avEngine: MockEngine(kind: .avPlayer, result: .failure(PlayerEngineError.unsupported("AV failed"))),
            vlcEngine: MockEngine(kind: .vlc, result: .failure(PlayerEngineError.vlcKitUnavailable)),
            avReadinessMonitor: ImmediateReadinessMonitor(),
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
        #expect(model.runtimeState == .failed)
        #expect(model.errorMessage?.isEmpty == false)
    }

    @Test("Forced engine retry uses selected backend")
    func forcedRetryUsesEngine() async {
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
            avReadinessMonitor: ImmediateReadinessMonitor(),
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

        await model.retryWithEngine(.vlc)
        #expect(model.selectedEngine == .vlc)
        #expect(vlcSession.playCallCount >= 2)
    }

    @Test("Cancelling preparation does not trigger external fallback")
    func cancellationDoesNotLaunchExternal() async throws {
        let stream = makeStream(url: "https://cdn.example.com/movie.mp4")
        let player = AVPlayer(url: URL(string: stream.streamURL)!)
        var defaultOpenCalls = 0

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
            avReadinessMonitor: BlockingReadinessMonitor(),
            externalLauncher: ExternalPlayerLauncher(
                resolveApplicationInstalled: { _ in false },
                openWithBundle: { _, _ in false },
                openWithDefaultApplication: { _ in
                    defaultOpenCalls += 1
                    return true
                }
            )
        )

        let task = Task {
            await model.preparePlayback(
                stream: stream,
                backendPreference: .automatic,
                externalPlayerPreference: .auto
            )
        }

        try await Task.sleep(for: .milliseconds(60))
        task.cancel()
        _ = await task.value

        #expect(defaultOpenCalls == 0)
        #expect(model.launchedExternal == false)
        #expect(model.runtimeState != .fallbackLaunched)
        #expect(model.avPlayer == nil)
        #expect(model.vlcSession == nil)
    }

    @Test("Launching external playback stops active internal engine")
    func externalLaunchStopsInternalEngine() async {
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
            avReadinessMonitor: ImmediateReadinessMonitor(),
            externalLauncher: ExternalPlayerLauncher(
                resolveApplicationInstalled: { _ in false },
                openWithBundle: { _, _ in false },
                openWithDefaultApplication: { _ in true }
            )
        )

        await model.preparePlayback(
            stream: stream,
            backendPreference: .automatic,
            externalPlayerPreference: .auto
        )
        #expect(model.selectedEngine == .avPlayer)
        #expect(model.avPlayer != nil)

        await model.launchExternalNow()

        #expect(model.runtimeState == .fallbackLaunched)
        #expect(model.launchedExternal == true)
        #expect(model.avPlayer == nil)
        #expect(model.selectedEngine == nil)
    }

    @Test("Playback progress snapshot survives stop")
    func progressSnapshotSurvivesStop() async {
        let model = PlayerViewModel()
        let vlcSession = MockVLCSession()
        vlcSession.currentTimeSeconds = 321
        vlcSession.durationSeconds = 900
        vlcSession.isPlaying = true

        model.vlcSession = vlcSession
        model.selectedEngine = .vlc

        let snapshot = model.playbackProgressSnapshot()
        model.stop()

        #expect(snapshot?.progressSeconds == 321)
        #expect(snapshot?.durationSeconds == 900)
        #expect(model.vlcSession == nil)
        #expect(vlcSession.stopCallCount == 1)
    }

    @Test("Fullscreen toggle invokes configured window toggler")
    func fullscreenToggleInvokesToggler() async {
        var toggleCount = 0
        let targetWindow = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 640, height: 360),
            styleMask: [.titled, .closable, .resizable],
            backing: .buffered,
            defer: false
        )
        let model = PlayerViewModel(
            fullscreenToggler: { _ in
                toggleCount += 1
            },
            fullscreenWindowResolver: { _ in
                targetWindow
            }
        )

        await model.toggleFullscreen(window: nil)

        #expect(toggleCount == 1)
    }

    @Test("Fullscreen toggle reports diagnostics when window is unavailable")
    func fullscreenToggleWithoutWindowReportsDiagnostics() async {
        var toggleCount = 0
        let model = PlayerViewModel(
            fullscreenToggler: { _ in
                toggleCount += 1
            },
            fullscreenWindowResolver: { _ in
                nil
            }
        )

        await model.toggleFullscreen(window: nil)

        #expect(toggleCount == 0)
        #expect(model.diagnostics?.contains("Fullscreen is unavailable") == true)
    }

    @Test("isFullscreen uses resolved window state")
    func isFullscreenUsesResolvedWindow() async {
        let targetWindow = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 640, height: 360),
            styleMask: [.titled, .closable, .resizable, .fullScreen],
            backing: .buffered,
            defer: false
        )
        let model = PlayerViewModel(
            fullscreenWindowResolver: { _ in
                targetWindow
            }
        )

        #expect(model.isFullscreen(window: nil) == true)
    }

    @Test("Fullscreen toggle falls back to expanded mode when fullscreen transition fails")
    func fullscreenToggleFallsBackToExpandedWindowMode() async {
        let expandedFrame = NSRect(x: 0, y: 0, width: 1728, height: 1117)
        let window = NSWindow(
            contentRect: NSRect(x: 40, y: 40, width: 900, height: 540),
            styleMask: [.titled, .closable, .resizable],
            backing: .buffered,
            defer: false
        )
        let initialFrame = window.frame
        var appliedFrames: [NSRect] = []

        let model = PlayerViewModel(
            fullscreenToggler: { _ in
                // Simulate a no-op fullscreen request.
            },
            fullscreenWindowResolver: { _ in window },
            windowVisibleFrameProvider: { _ in expandedFrame },
            windowFrameApplier: { _, frame in
                appliedFrames.append(frame)
            }
        )

        await model.toggleFullscreen(window: nil)
        #expect(appliedFrames == [expandedFrame])
        #expect(model.diagnostics?.contains("Expanded player") == true)

        await model.toggleFullscreen(window: nil)
        #expect(appliedFrames == [expandedFrame, initialFrame])
        #expect(model.diagnostics?.contains("windowed") == true)
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
private struct ImmediateReadinessMonitor: AVPlayerReadinessMonitoring {
    func waitUntilReady(
        player: AVPlayer,
        timeout: TimeInterval,
        onStateChange: (_ state: PlayerRuntimeState, _ diagnostics: String?) -> Void
    ) async throws {
        onStateChange(.buffering, "Buffering...")
        onStateChange(.playing, "Ready.")
    }
}

@MainActor
private struct FailingReadinessMonitor: AVPlayerReadinessMonitoring {
    func waitUntilReady(
        player: AVPlayer,
        timeout: TimeInterval,
        onStateChange: (_ state: PlayerRuntimeState, _ diagnostics: String?) -> Void
    ) async throws {
        onStateChange(.stalled, "Timed out.")
        throw PlayerEngineError.unsupported("AV timed out.")
    }
}

@MainActor
private struct BlockingReadinessMonitor: AVPlayerReadinessMonitoring {
    func waitUntilReady(
        player: AVPlayer,
        timeout: TimeInterval,
        onStateChange: (_ state: PlayerRuntimeState, _ diagnostics: String?) -> Void
    ) async throws {
        onStateChange(.buffering, "Waiting...")
        try await Task.sleep(for: .seconds(5))
        onStateChange(.playing, "Ready.")
    }
}

@MainActor
private final class MockVLCSession: VLCPlaybackSession {
    var isPlaying: Bool = false
    var position: Float = 0
    var currentTimeSeconds: Double = 0
    var durationSeconds: Double? = 0
    var playCallCount = 0
    var stopCallCount = 0

    func makeVideoView() -> NSView { NSView(frame: .zero) }
    func seek(to seconds: Double) {
        currentTimeSeconds = max(0, seconds)
    }
    func play() {
        playCallCount += 1
        isPlaying = true
    }
    func pause() { isPlaying = false }
    func stop() {
        stopCallCount += 1
        isPlaying = false
    }
}
