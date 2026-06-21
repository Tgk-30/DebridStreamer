import Foundation
import AppKit
import Observation

@MainActor
@Observable
final class PlayerViewModel {
    /// Sentinel index that turns subtitles off. VLCKit disables the subtitle track
    /// when `currentVideoSubTitleIndex` is set to a negative value.
    static let subtitlesOffTrackID: Int32 = -1

    struct PlaybackProgressSnapshot: Sendable {
        let progressSeconds: Double
        let durationSeconds: Double?
    }

    private struct PendingResumeTarget: Sendable {
        let progressSeconds: Double
        let storedDurationSeconds: Double?
        let completionThreshold: Double
    }

    var runtimeState: PlayerRuntimeState = .preparing
    var diagnostics: String?
    var errorMessage: String?
    var vlcSession: (any VLCPlaybackSession)?
    var selectedEngine: PlayerEngineKind?
    var playbackRate: Float = 1.0
    var controlsVisible = true
    var isFullscreenActive = false
    var isFullscreenTransitioning = false

    var availableStreams: [StreamInfo] = []
    var selectedStreamURL: String?
    var availableAudioTracks: [VLCTrackOption] = []
    var availableSubtitleTracks: [VLCTrackOption] = []
    var selectedAudioTrackID: Int32?
    var selectedSubtitleTrackID: Int32?
    var hasDetailedAudioMetadata: Bool {
        availableAudioTracks.contains(where: \.hasRichMetadata)
    }
    var hasDetailedSubtitleMetadata: Bool {
        availableSubtitleTracks.contains(where: \.hasRichMetadata)
    }

    private let selector: PlayerEngineSelector
    private let vlcEngine: any PlayerEngine
    private let fullscreenToggler: @MainActor (NSWindow) -> Void
    private let fullscreenWindowResolver: @MainActor (NSWindow?) -> NSWindow?
    private let controlsAutoHideDelay: TimeInterval

    private var controlsAutoHideTask: Task<Void, Never>?
    private var fullscreenTransitionTask: Task<Void, Never>?
    private var lastStream: StreamInfo?
    private var lastBackendPreference: InternalPlayerBackend = .automatic
    private var lastExternalPreference: PreferredPlayer = .auto
    private var didApplyResumePosition = false
    private var pendingResumeTarget: PendingResumeTarget?

    var isLoading: Bool {
        runtimeState == .preparing || runtimeState == .buffering
    }

    var isPlaying: Bool {
        vlcSession?.isPlaying == true
    }

    var currentTimeSeconds: Double {
        vlcSession?.currentTimeSeconds ?? 0
    }

    var durationSeconds: Double? {
        vlcSession?.durationSeconds
    }

    init(
        selector: PlayerEngineSelector = PlayerEngineSelector(),
        vlcEngine: any PlayerEngine = VLCPlayerEngine(),
        fullscreenToggler: @escaping @MainActor (NSWindow) -> Void = { window in
            window.toggleFullScreen(nil)
        },
        fullscreenWindowResolver: @escaping @MainActor (NSWindow?) -> NSWindow? = { PlayerViewModel.defaultFullscreenWindowResolver(window: $0) },
        controlsAutoHideDelay: TimeInterval = 10
    ) {
        self.selector = selector
        self.vlcEngine = vlcEngine
        self.fullscreenToggler = fullscreenToggler
        self.fullscreenWindowResolver = fullscreenWindowResolver
        self.controlsAutoHideDelay = max(1, controlsAutoHideDelay)
    }

    func preparePlayback(
        stream: StreamInfo,
        availableStreams: [StreamInfo] = [],
        backendPreference: InternalPlayerBackend,
        externalPlayerPreference: PreferredPlayer,
        forcedEngine: PlayerEngineKind? = nil
    ) async {
        lastStream = stream
        lastBackendPreference = backendPreference
        lastExternalPreference = externalPlayerPreference

        let normalized = normalizeAvailableStreams(current: stream, availableStreams: availableStreams)
        self.availableStreams = normalized
        selectedStreamURL = stream.streamURL

        resetRuntime()

        let order = engineOrder(
            for: stream,
            backendPreference: backendPreference,
            forcedEngine: forcedEngine
        )

        for kind in order {
            guard kind == .vlc else { continue }
            guard vlcEngine.canHandle(stream) else { continue }

            do {
                try await prepareWithVLC(engine: vlcEngine, stream: stream)
                try Task.checkCancellation()
                return
            } catch {
                if Task.isCancelled || error is CancellationError {
                    diagnostics = "Playback preparation cancelled."
                    stopInternalPlayback()
                    return
                }
                stopInternalPlayback(clearSelection: false)
                selectedEngine = nil
                runtimeState = .failed
                errorMessage = error.localizedDescription
                diagnostics = "VLC initialization failed."
                controlsVisible = true
                return
            }
        }

        runtimeState = .failed
        diagnostics = "No supported internal playback engine available."
        errorMessage = "Unable to initialize VLC playback."
        controlsVisible = true
    }

    func retryLastPlayback() async {
        guard let lastStream else { return }
        await preparePlayback(
            stream: lastStream,
            availableStreams: availableStreams,
            backendPreference: lastBackendPreference,
            externalPlayerPreference: lastExternalPreference
        )
    }

    func retryWithEngine(_ kind: PlayerEngineKind) async {
        guard kind == .vlc else { return }
        guard let lastStream else { return }
        await preparePlayback(
            stream: lastStream,
            availableStreams: availableStreams,
            backendPreference: lastBackendPreference,
            externalPlayerPreference: lastExternalPreference,
            forcedEngine: .vlc
        )
    }

    func switchToStream(_ stream: StreamInfo) async {
        await preparePlayback(
            stream: stream,
            availableStreams: availableStreams,
            backendPreference: lastBackendPreference,
            externalPlayerPreference: lastExternalPreference,
            forcedEngine: .vlc
        )
    }

    func togglePlayPause() {
        guard let session = vlcSession else { return }
        registerUserInteraction()

        if session.isPlaying {
            session.pause()
            runtimeState = .stalled
            diagnostics = "Paused."
            controlsVisible = true
            cancelControlsAutoHide()
        } else {
            session.playbackRate = playbackRate
            session.play()
            runtimeState = .playing
            diagnostics = "Playing."
            scheduleControlsAutoHideIfNeeded()
        }
    }

    func seek(by seconds: Double) {
        guard seconds != 0, let session = vlcSession else { return }
        registerUserInteraction()
        let target = max(0, session.currentTimeSeconds + seconds)
        session.seek(to: target)
    }

    func seek(to progress: Double) {
        guard let duration = durationSeconds, duration > 0 else { return }
        registerUserInteraction()
        let clamped = min(max(progress, 0), 1)
        vlcSession?.seek(to: duration * clamped)
    }

    func setPlaybackRate(_ rate: Float) {
        playbackRate = max(0.25, min(2.0, rate))
        vlcSession?.playbackRate = playbackRate
        registerUserInteraction()
    }

    @discardableResult
    func resumePlaybackIfNeeded(
        progressSeconds: Double,
        storedDurationSeconds: Double?,
        completionThreshold: Double = 0.95
    ) -> Bool {
        guard queueResumeTarget(
            progressSeconds: progressSeconds,
            storedDurationSeconds: storedDurationSeconds,
            completionThreshold: completionThreshold
        ) else {
            return false
        }
        return applyPendingResumeIfPossible()
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
        guard !isFullscreenTransitioning else {
            diagnostics = "Fullscreen transition already in progress."
            return
        }
        guard let resolvedWindow = fullscreenWindowResolver(window) else {
            diagnostics = "Fullscreen is unavailable because no active player window was found."
            return
        }

        // Cancel any in-flight exitFullscreen delayed write so it can't clobber the
        // transition state this toggle is about to own.
        cancelFullscreenTransitionTask()

        isFullscreenTransitioning = true
        defer { isFullscreenTransitioning = false }

        let wasFullscreen = resolvedWindow.styleMask.contains(.fullScreen)
        fullscreenToggler(resolvedWindow)
        try? await Task.sleep(for: .milliseconds(300))
        let isFullscreenNow = resolvedWindow.styleMask.contains(.fullScreen)
        isFullscreenActive = isFullscreenNow

        if wasFullscreen == isFullscreenNow {
            diagnostics = "Unable to toggle fullscreen on this window."
        } else if isFullscreenNow {
            diagnostics = "Entered fullscreen player mode."
        } else {
            diagnostics = "Exited fullscreen player mode."
        }
    }

    func isFullscreen(window: NSWindow?) -> Bool {
        guard let resolvedWindow = fullscreenWindowResolver(window) else {
            return isFullscreenActive
        }
        let actual = resolvedWindow.styleMask.contains(.fullScreen)
        if actual != isFullscreenActive {
            isFullscreenActive = actual
        }
        return actual
    }

    func exitFullscreen(window: NSWindow?) {
        guard !isFullscreenTransitioning else { return }
        guard let resolvedWindow = fullscreenWindowResolver(window) else { return }
        guard resolvedWindow.styleMask.contains(.fullScreen) else { return }

        // Supersede any prior in-flight transition write before starting this one.
        cancelFullscreenTransitionTask()

        isFullscreenTransitioning = true
        fullscreenToggler(resolvedWindow)
        diagnostics = "Exiting fullscreen player mode."

        fullscreenTransitionTask = Task { @MainActor [weak self, weak resolvedWindow] in
            try? await Task.sleep(for: .milliseconds(300))
            guard !Task.isCancelled else { return }
            guard let self else { return }
            if let resolvedWindow {
                self.isFullscreenActive = resolvedWindow.styleMask.contains(.fullScreen)
            } else {
                self.isFullscreenActive = false
            }
            self.isFullscreenTransitioning = false
            self.fullscreenTransitionTask = nil
            if self.isFullscreenActive {
                self.diagnostics = "Unable to exit fullscreen on this window."
            } else {
                self.diagnostics = "Exited fullscreen player mode."
            }
        }
    }

    func syncFullscreenState(window: NSWindow?) {
        guard let resolvedWindow = fullscreenWindowResolver(window) else {
            isFullscreenActive = false
            return
        }
        isFullscreenActive = resolvedWindow.styleMask.contains(.fullScreen)
    }

    func setFullscreenActive(_ isFullscreen: Bool) {
        isFullscreenActive = isFullscreen
        if isFullscreenTransitioning {
            isFullscreenTransitioning = false
        }
    }

    func playbackProgressSnapshot() -> PlaybackProgressSnapshot? {
        let current = currentTimeSeconds
        guard current.isFinite, current > 0 else { return nil }
        return PlaybackProgressSnapshot(progressSeconds: current, durationSeconds: durationSeconds)
    }

    @discardableResult
    func queueResumeTarget(
        progressSeconds: Double,
        storedDurationSeconds: Double?,
        completionThreshold: Double = 0.95
    ) -> Bool {
        guard !didApplyResumePosition else { return false }
        guard progressSeconds.isFinite, progressSeconds >= 15 else { return false }

        if let storedDurationSeconds, storedDurationSeconds > 0 {
            let ratio = progressSeconds / storedDurationSeconds
            if ratio >= completionThreshold {
                return false
            }
        }

        pendingResumeTarget = PendingResumeTarget(
            progressSeconds: progressSeconds,
            storedDurationSeconds: storedDurationSeconds,
            completionThreshold: completionThreshold
        )
        return true
    }

    @discardableResult
    func applyPendingResumeIfPossible() -> Bool {
        guard !didApplyResumePosition else { return false }
        guard let pendingResumeTarget else { return false }
        guard let session = vlcSession else { return false }
        guard session.isSeekable else { return false }

        let duration = pendingResumeTarget.storedDurationSeconds ?? session.durationSeconds
        if let duration, duration > 0 {
            let ratio = pendingResumeTarget.progressSeconds / duration
            if ratio >= pendingResumeTarget.completionThreshold {
                self.pendingResumeTarget = nil
                return false
            }
        }

        session.seek(to: pendingResumeTarget.progressSeconds)
        didApplyResumePosition = true
        self.pendingResumeTarget = nil
        diagnostics = "Resumed from \(formatTime(pendingResumeTarget.progressSeconds))."
        registerUserInteraction()
        return true
    }

    func registerUserInteraction() {
        controlsVisible = true
        scheduleControlsAutoHideIfNeeded()
    }

    func refreshTrackOptions() {
        guard let session = vlcSession else {
            availableAudioTracks = []
            availableSubtitleTracks = []
            selectedAudioTrackID = nil
            selectedSubtitleTrackID = nil
            return
        }

        session.refreshTrackOptions()
        availableAudioTracks = session.availableAudioTracks
        availableSubtitleTracks = session.availableSubtitleTracks
        selectedAudioTrackID = session.selectedAudioTrackID
        selectedSubtitleTrackID = session.selectedSubtitleTrackID
    }

    func selectAudioTrack(_ id: Int32) {
        guard let session = vlcSession else { return }
        session.selectAudioTrack(id: id)
        refreshTrackOptions()
        diagnostics = "Audio track updated."
        registerUserInteraction()
    }

    func selectSubtitleTrack(_ id: Int32) {
        guard let session = vlcSession else { return }
        session.selectSubtitleTrack(id: id)
        refreshTrackOptions()
        diagnostics = "Subtitle track updated."
        registerUserInteraction()
    }

    private func prepareWithVLC(engine: any PlayerEngine, stream: StreamInfo) async throws {
        runtimeState = .preparing
        diagnostics = "Preparing VLC..."
        controlsVisible = true

        let prepared = try await engine.prepare(stream: stream)
        try Task.checkCancellation()
        guard let session = prepared.vlcSession else {
            throw PlayerEngineError.unsupported("VLC engine returned no playback session.")
        }

        selectedEngine = .vlc
        vlcSession = session
        runtimeState = .buffering
        diagnostics = "Starting VLC stream."
        session.playbackRate = playbackRate
        session.play()

        try await Task.sleep(for: .milliseconds(250))
        try Task.checkCancellation()

        runtimeState = session.isPlaying ? .playing : .stalled
        diagnostics = session.isPlaying ? "Playing with VLC." : "VLC started but has not begun rendering yet."
        refreshTrackOptions()
        _ = applyPendingResumeIfPossible()
        scheduleControlsAutoHideIfNeeded()
    }

    private func resetRuntime() {
        errorMessage = nil
        diagnostics = "Preparing playback."
        runtimeState = .preparing
        selectedEngine = nil
        didApplyResumePosition = false
        pendingResumeTarget = nil
        controlsVisible = true
        cancelControlsAutoHide()
        stopInternalPlayback(clearSelection: false)
    }

    private func engineOrder(
        for stream: StreamInfo,
        backendPreference: InternalPlayerBackend,
        forcedEngine: PlayerEngineKind?
    ) -> [PlayerEngineKind] {
        _ = stream
        if let forcedEngine {
            return forcedEngine == .vlc ? [.vlc] : []
        }
        return selector.engineOrder(for: stream, backendPreference: backendPreference)
    }

    private func stopInternalPlayback(clearSelection: Bool = true) {
        cancelControlsAutoHide()
        cancelFullscreenTransitionTask()
        vlcSession?.stop()
        vlcSession = nil
        availableAudioTracks = []
        availableSubtitleTracks = []
        selectedAudioTrackID = nil
        selectedSubtitleTrackID = nil
        if clearSelection {
            selectedEngine = nil
        }
        pendingResumeTarget = nil
        isFullscreenTransitioning = false
        controlsVisible = true
    }

    private func normalizeAvailableStreams(current: StreamInfo, availableStreams: [StreamInfo]) -> [StreamInfo] {
        var deduped: [String: StreamInfo] = [:]
        deduped[current.streamURL] = current
        for stream in availableStreams {
            deduped[stream.streamURL] = stream
        }
        return deduped.values.sorted {
            if $0.quality == $1.quality {
                return $0.sizeBytes > $1.sizeBytes
            }
            return $0.quality > $1.quality
        }
    }

    private func scheduleControlsAutoHideIfNeeded() {
        cancelControlsAutoHide()
        guard runtimeState == .playing, isPlaying else {
            controlsVisible = true
            return
        }

        controlsAutoHideTask = Task { [weak self] in
            guard let self else { return }
            try? await Task.sleep(for: .seconds(controlsAutoHideDelay))
            guard !Task.isCancelled else { return }
            guard runtimeState == .playing, isPlaying else { return }
            controlsVisible = false
        }
    }

    private func cancelControlsAutoHide() {
        controlsAutoHideTask?.cancel()
        controlsAutoHideTask = nil
    }

    private func cancelFullscreenTransitionTask() {
        fullscreenTransitionTask?.cancel()
        fullscreenTransitionTask = nil
    }

    private func formatTime(_ value: Double) -> String {
        guard value.isFinite, value > 0 else { return "00:00" }
        let total = Int(value.rounded())
        let hours = total / 3600
        let minutes = (total % 3600) / 60
        let seconds = total % 60
        if hours > 0 {
            return String(format: "%d:%02d:%02d", hours, minutes, seconds)
        }
        return String(format: "%02d:%02d", minutes, seconds)
    }
}
