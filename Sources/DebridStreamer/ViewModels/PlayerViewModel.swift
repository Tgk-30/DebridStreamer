import Foundation
import AVKit
import AppKit
import Observation

@MainActor
@Observable
final class PlayerViewModel {
    struct PlaybackProgressSnapshot: Sendable {
        let progressSeconds: Double
        let durationSeconds: Double?
    }

    var runtimeState: PlayerRuntimeState = .preparing
    var diagnostics: String?
    var errorMessage: String?
    var avPlayer: AVPlayer?
    var vlcSession: (any VLCPlaybackSession)?
    var launchedExternal = false
    var externalLaunchMessage: String?
    var selectedEngine: PlayerEngineKind?
    var playbackRate: Float = 1.0

    private let selector: PlayerEngineSelector
    private let avEngine: any PlayerEngine
    private let vlcEngine: any PlayerEngine
    private let avReadinessMonitor: any AVPlayerReadinessMonitoring
    private let avStartupTimeout: TimeInterval
    private let externalLauncher: ExternalPlayerLauncher
    private let fullscreenToggler: @MainActor (NSWindow) -> Void
    private let fullscreenWindowResolver: @MainActor (NSWindow?) -> NSWindow?
    private let windowVisibleFrameProvider: @MainActor (NSWindow) -> NSRect?
    private let windowFrameApplier: @MainActor (NSWindow, NSRect) -> Void

    private var lastStream: StreamInfo?
    private var lastBackendPreference: InternalPlayerBackend = .automatic
    private var lastExternalPreference: PreferredPlayer = .auto
    private var expandedWindowID: ObjectIdentifier?
    private var expandedWindowFrame: NSRect?

    var isLoading: Bool {
        runtimeState == .preparing || runtimeState == .buffering
    }

    var isPlaying: Bool {
        switch selectedEngine {
        case .avPlayer:
            return avPlayer?.timeControlStatus == .playing
        case .vlc:
            return vlcSession?.isPlaying == true
        case .none:
            return false
        }
    }

    var currentTimeSeconds: Double {
        switch selectedEngine {
        case .avPlayer:
            let value = avPlayer?.currentTime().seconds ?? 0
            return value.isFinite ? max(0, value) : 0
        case .vlc:
            return vlcSession?.currentTimeSeconds ?? 0
        case .none:
            return 0
        }
    }

    var durationSeconds: Double? {
        switch selectedEngine {
        case .avPlayer:
            let value = avPlayer?.currentItem?.duration.seconds
            guard let value, value.isFinite, value > 0 else { return nil }
            return value
        case .vlc:
            return vlcSession?.durationSeconds
        case .none:
            return nil
        }
    }

    init(
        selector: PlayerEngineSelector = PlayerEngineSelector(),
        avEngine: any PlayerEngine = AVPlayerEngine(),
        vlcEngine: any PlayerEngine = VLCPlayerEngine(),
        avReadinessMonitor: any AVPlayerReadinessMonitoring = AVPlayerReadinessMonitor(),
        avStartupTimeout: TimeInterval = 8,
        externalLauncher: ExternalPlayerLauncher = .live,
        fullscreenToggler: @escaping @MainActor (NSWindow) -> Void = { window in
            window.toggleFullScreen(nil)
        },
        fullscreenWindowResolver: @escaping @MainActor (NSWindow?) -> NSWindow? = PlayerViewModel.defaultFullscreenWindowResolver(window:),
        windowVisibleFrameProvider: @escaping @MainActor (NSWindow) -> NSRect? = { window in
            if let frame = window.screen?.visibleFrame {
                return frame
            }
            return NSScreen.main?.visibleFrame
        },
        windowFrameApplier: @escaping @MainActor (NSWindow, NSRect) -> Void = { window, frame in
            window.setFrame(frame, display: true, animate: true)
        }
    ) {
        self.selector = selector
        self.avEngine = avEngine
        self.vlcEngine = vlcEngine
        self.avReadinessMonitor = avReadinessMonitor
        self.avStartupTimeout = max(1, avStartupTimeout)
        self.externalLauncher = externalLauncher
        self.fullscreenToggler = fullscreenToggler
        self.fullscreenWindowResolver = fullscreenWindowResolver
        self.windowVisibleFrameProvider = windowVisibleFrameProvider
        self.windowFrameApplier = windowFrameApplier
    }

    func preparePlayback(
        stream: StreamInfo,
        backendPreference: InternalPlayerBackend,
        externalPlayerPreference: PreferredPlayer,
        forcedEngine: PlayerEngineKind? = nil
    ) async {
        lastStream = stream
        lastBackendPreference = backendPreference
        lastExternalPreference = externalPlayerPreference

        resetRuntime()

        let order = engineOrder(
            for: stream,
            backendPreference: backendPreference,
            forcedEngine: forcedEngine
        )
        var errors: [String] = []

        for kind in order {
            let engine = engine(for: kind)
            guard engine.canHandle(stream) else { continue }

            do {
                switch kind {
                case .avPlayer:
                    try await prepareWithAV(engine: engine, stream: stream)
                case .vlc:
                    try await prepareWithVLC(engine: engine, stream: stream)
                }
                try Task.checkCancellation()
                return
            } catch {
                if Task.isCancelled || error is CancellationError {
                    diagnostics = "Playback preparation cancelled."
                    stopInternalPlayback()
                    return
                }
                errors.append("\(kind.displayName): \(error.localizedDescription)")
                diagnostics = "Failed \(kind.displayName) initialization. Trying fallback."
                stopInternalPlayback(clearSelection: false)
                selectedEngine = nil
            }
        }

        if Task.isCancelled {
            diagnostics = "Playback preparation cancelled."
            stopInternalPlayback()
            return
        }
        await launchExternalFallback(stream: stream, preferredPlayer: externalPlayerPreference, engineErrors: errors)
    }

    func retryLastPlayback() async {
        guard let lastStream else { return }
        await preparePlayback(
            stream: lastStream,
            backendPreference: lastBackendPreference,
            externalPlayerPreference: lastExternalPreference
        )
    }

    func retryWithEngine(_ kind: PlayerEngineKind) async {
        guard let lastStream else { return }
        await preparePlayback(
            stream: lastStream,
            backendPreference: lastBackendPreference,
            externalPlayerPreference: lastExternalPreference,
            forcedEngine: kind
        )
    }

    func launchExternalNow() async {
        guard let stream = lastStream else { return }
        stopInternalPlayback()
        await launchExternalFallback(stream: stream, preferredPlayer: lastExternalPreference, engineErrors: [])
    }

    func togglePlayPause() {
        switch selectedEngine {
        case .avPlayer:
            guard let player = avPlayer else { return }
            if player.timeControlStatus == .playing {
                player.pause()
                runtimeState = .stalled
                diagnostics = "Paused."
            } else {
                player.playImmediately(atRate: playbackRate)
                runtimeState = .playing
                diagnostics = "Playing."
            }
        case .vlc:
            guard let session = vlcSession else { return }
            if session.isPlaying {
                session.pause()
                runtimeState = .stalled
                diagnostics = "Paused."
            } else {
                session.play()
                runtimeState = .playing
                diagnostics = "Playing."
            }
        case .none:
            break
        }
    }

    func seek(by seconds: Double) {
        guard seconds != 0 else { return }
        switch selectedEngine {
        case .avPlayer:
            guard let player = avPlayer else { return }
            let current = player.currentTime().seconds
            let base = current.isFinite ? current : 0
            let target = max(0, base + seconds)
            player.seek(to: CMTime(seconds: target, preferredTimescale: 600))
        case .vlc:
            guard let session = vlcSession else { return }
            let target = max(0, session.currentTimeSeconds + seconds)
            session.seek(to: target)
        case .none:
            break
        }
    }

    func seek(to progress: Double) {
        let clamped = min(max(progress, 0), 1)
        guard let duration = durationSeconds, duration > 0 else { return }
        let target = duration * clamped
        switch selectedEngine {
        case .avPlayer:
            avPlayer?.seek(to: CMTime(seconds: target, preferredTimescale: 600))
        case .vlc:
            vlcSession?.seek(to: target)
        case .none:
            break
        }
    }

    func setPlaybackRate(_ rate: Float) {
        playbackRate = max(0.25, min(2.0, rate))
        if selectedEngine == .avPlayer, avPlayer?.timeControlStatus == .playing {
            avPlayer?.rate = playbackRate
        }
    }

    func stop() {
        stopInternalPlayback()
    }

    static func defaultFullscreenWindowResolver(window: NSWindow?) -> NSWindow? {
        if let window {
            return window
        }
        if let keyWindow = NSApplication.shared.keyWindow {
            return keyWindow
        }
        return NSApplication.shared.mainWindow
    }

    func toggleFullscreen(window: NSWindow?) async {
        guard let resolvedWindow = fullscreenWindowResolver(window) else {
            diagnostics = "Fullscreen is unavailable because no active player window was found."
            return
        }

        let wasFullscreen = resolvedWindow.styleMask.contains(.fullScreen)
        fullscreenToggler(resolvedWindow)

        // Allow AppKit to process fullscreen transition before deciding on fallback.
        try? await Task.sleep(for: .milliseconds(220))
        let isFullscreenNow = resolvedWindow.styleMask.contains(.fullScreen)
        if !wasFullscreen && !isFullscreenNow {
            toggleExpandedWindow(on: resolvedWindow)
        }
    }

    func isFullscreen(window: NSWindow?) -> Bool {
        guard let resolvedWindow = fullscreenWindowResolver(window) else { return false }
        return resolvedWindow.styleMask.contains(.fullScreen)
    }

    func exitFullscreen(window: NSWindow?) {
        guard let resolvedWindow = fullscreenWindowResolver(window) else { return }

        if resolvedWindow.styleMask.contains(.fullScreen) {
            fullscreenToggler(resolvedWindow)
            diagnostics = "Exited fullscreen player mode."
            return
        }

        let windowID = ObjectIdentifier(resolvedWindow)
        if expandedWindowID == windowID, expandedWindowFrame != nil {
            toggleExpandedWindow(on: resolvedWindow)
        }
    }

    func playbackProgressSnapshot() -> PlaybackProgressSnapshot? {
        let current = currentTimeSeconds
        guard current.isFinite, current > 0 else { return nil }
        return PlaybackProgressSnapshot(
            progressSeconds: current,
            durationSeconds: durationSeconds
        )
    }

    private func prepareWithAV(engine: any PlayerEngine, stream: StreamInfo) async throws {
        runtimeState = .preparing
        diagnostics = "Preparing AVPlayer..."

        let prepared = try await engine.prepare(stream: stream)
        try Task.checkCancellation()
        guard let player = prepared.avPlayer else {
            throw PlayerEngineError.unsupported("AVPlayer engine returned no AVPlayer instance.")
        }

        selectedEngine = .avPlayer
        avPlayer = player
        runtimeState = .buffering
        diagnostics = "Waiting for first playable frame."
        player.playImmediately(atRate: playbackRate)

        try await avReadinessMonitor.waitUntilReady(player: player, timeout: avStartupTimeout) { [weak self] state, note in
            guard let self else { return }
            runtimeState = state
            if let note {
                diagnostics = note
            }
        }
        try Task.checkCancellation()

        runtimeState = .playing
        diagnostics = "Playing with AVPlayer."
    }

    private func prepareWithVLC(engine: any PlayerEngine, stream: StreamInfo) async throws {
        runtimeState = .preparing
        diagnostics = "Preparing VLC..."

        let prepared = try await engine.prepare(stream: stream)
        try Task.checkCancellation()
        guard let session = prepared.vlcSession else {
            throw PlayerEngineError.unsupported("VLC engine returned no playback session.")
        }

        selectedEngine = .vlc
        vlcSession = session
        runtimeState = .buffering
        diagnostics = "Starting VLC stream."
        session.play()

        try await Task.sleep(for: .milliseconds(200))
        try Task.checkCancellation()
        runtimeState = session.isPlaying ? .playing : .stalled
        diagnostics = session.isPlaying ? "Playing with VLC." : "VLC started but has not begun rendering yet."
    }

    private func launchExternalFallback(
        stream: StreamInfo,
        preferredPlayer: PreferredPlayer,
        engineErrors: [String]
    ) async {
        guard let url = stream.url else {
            runtimeState = .failed
            errorMessage = PlayerEngineError.invalidStreamURL(stream.streamURL).localizedDescription
            return
        }

        stopInternalPlayback()
        let fallbackPreference = preferredPlayer == .builtIn ? .auto : preferredPlayer
        let launched = await externalLauncher.launch(url: url, preference: fallbackPreference)
        if launched {
            launchedExternal = true
            runtimeState = .fallbackLaunched
            externalLaunchMessage = "Opened stream in external player after internal fallback chain."
            diagnostics = "AV/VLC path failed; external fallback launched."
            return
        }

        runtimeState = .failed
        errorMessage = engineErrors.isEmpty
            ? "Unable to initialize playback."
            : engineErrors.joined(separator: "\n")
        diagnostics = "All playback paths failed."
    }

    private func resetRuntime() {
        errorMessage = nil
        diagnostics = "Preparing playback."
        launchedExternal = false
        externalLaunchMessage = nil
        runtimeState = .preparing
        selectedEngine = nil

        stopInternalPlayback(clearSelection: false)
    }

    private func engineOrder(
        for stream: StreamInfo,
        backendPreference: InternalPlayerBackend,
        forcedEngine: PlayerEngineKind?
    ) -> [PlayerEngineKind] {
        let preferred = selector.engineOrder(for: stream, backendPreference: backendPreference)
        guard let forcedEngine else { return preferred }
        return [forcedEngine] + preferred.filter { $0 != forcedEngine }
    }

    private func engine(for kind: PlayerEngineKind) -> any PlayerEngine {
        switch kind {
        case .avPlayer:
            return avEngine
        case .vlc:
            return vlcEngine
        }
    }

    private func stopInternalPlayback(clearSelection: Bool = true) {
        avPlayer?.pause()
        avPlayer = nil
        vlcSession?.stop()
        vlcSession = nil
        if clearSelection {
            selectedEngine = nil
        }
    }

    private func toggleExpandedWindow(on window: NSWindow) {
        let windowID = ObjectIdentifier(window)
        if expandedWindowID == windowID, let original = expandedWindowFrame {
            windowFrameApplier(window, original)
            expandedWindowID = nil
            expandedWindowFrame = nil
            diagnostics = "Returned to windowed player mode."
            return
        }

        guard let targetFrame = windowVisibleFrameProvider(window) else {
            diagnostics = "Unable to expand player window on this display."
            return
        }

        expandedWindowID = windowID
        expandedWindowFrame = window.frame
        windowFrameApplier(window, targetFrame)
        window.makeKeyAndOrderFront(nil)
        diagnostics = "Expanded player to fill the screen."
    }
}
