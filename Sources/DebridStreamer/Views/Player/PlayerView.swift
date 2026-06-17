import Foundation
import SwiftUI
import AppKit

struct PlayerView: View {
    @Environment(AppState.self) private var appState

    let stream: StreamInfo
    let availableStreams: [StreamInfo]
    let mediaTitle: String
    let mediaId: String
    let episodeId: String?
    let sessionRequestID: UUID
    var onClose: () -> Void = {}

    @State private var viewModel = PlayerViewModel()
    @State private var isDraggingProgress = false
    @State private var progress: Double = 0
    @State private var currentTime: Double = 0
    @State private var duration: Double = 0
    @State private var speed: Float = 1.0
    @State private var playerWindow: NSWindow?
    @State private var didTeardown = false
    @State private var lastPersistedCheckpointSeconds: Double = 0

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()

            playbackSurface
                .contentShape(Rectangle())
                .onTapGesture {
                    viewModel.registerUserInteraction()
                }

            MouseMoveMonitor {
                viewModel.registerUserInteraction()
            }
            .allowsHitTesting(false)

            controlsLayer

            if viewModel.isLoading {
                loadingOverlay
            } else if viewModel.runtimeState == .failed, let errorMessage = viewModel.errorMessage {
                errorOverlay(errorMessage)
            }
        }
        .navigationTitle(mediaTitle)
        .background(
            PlayerWindowAccessor(window: $playerWindow)
                .frame(width: 0, height: 0)
        )
        .task { await startPlayback() }
        .task(id: viewModel.selectedEngine?.rawValue ?? "none") {
            await syncProgressLoop()
        }
        .task(id: "checkpoint-\(viewModel.selectedEngine?.rawValue ?? "none")") {
            await checkpointLoop()
        }
        .onExitCommand {
            viewModel.registerUserInteraction()
            if viewModel.isFullscreenActive || viewModel.isFullscreen(window: playerWindow) {
                viewModel.exitFullscreen(window: playerWindow)
            } else {
                closePlayer()
            }
        }
        .onChange(of: playerWindow) { _, newWindow in
            viewModel.syncFullscreenState(window: newWindow)
        }
        .onChange(of: appState.activePlayerIsFullscreen) { _, isFullscreen in
            viewModel.setFullscreenActive(isFullscreen)
        }
        .onReceive(NotificationCenter.default.publisher(for: .debridPlayerWindowWillClose)) { notification in
            guard let requestID = notification.object as? UUID else { return }
            guard requestID == sessionRequestID else { return }
            teardownPlayer(notifyParent: false)
        }
        .onDisappear {
            teardownPlayer(notifyParent: false)
        }
    }

    @ViewBuilder
    private var playbackSurface: some View {
        if let session = viewModel.vlcSession {
            VLCPlayerSurfaceView(makeView: { session.makeVideoView() })
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else {
            Rectangle().fill(Color.black)
                .overlay {
                    Text("No video frame yet")
                        .foregroundStyle(.white.opacity(0.35))
                        .font(.caption)
                }
        }
    }

    private var controlsLayer: some View {
        VStack(spacing: AppTheme.Spacing.sm) {
            statusPills
                .opacity(viewModel.controlsVisible ? 1 : 0)
            Spacer()
            controlsPanel
                .opacity(viewModel.controlsVisible ? 1 : 0)
        }
        .padding(AppTheme.Spacing.md)
        .animation(.easeInOut(duration: 0.2), value: viewModel.controlsVisible)
    }

    private var statusPills: some View {
        HStack(spacing: AppTheme.Spacing.sm) {
            if let engine = viewModel.selectedEngine {
                Label(engine.displayName, systemImage: "bolt.fill")
                    .font(.caption.weight(.semibold))
                    .padding(.horizontal, AppTheme.Spacing.sm)
                    .padding(.vertical, AppTheme.Spacing.xs)
                    .glassChip()
            }

            Text(viewModel.runtimeState.displayName)
                .font(.caption.weight(.semibold))
                .padding(.horizontal, AppTheme.Spacing.sm)
                .padding(.vertical, AppTheme.Spacing.xs)
                .glassChip()

            if let selected = selectedStream {
                Text(selected.quality.rawValue.uppercased())
                    .font(.caption2.weight(.semibold))
                    .padding(.horizontal, AppTheme.Spacing.sm)
                    .padding(.vertical, AppTheme.Spacing.xs)
                    .glassChip()
            }

            Spacer()
        }
        .foregroundStyle(.white)
    }

    private var controlsPanel: some View {
        let isFullscreen = viewModel.isFullscreenActive

        return VStack(alignment: .leading, spacing: AppTheme.Spacing.sm) {
            HStack(spacing: AppTheme.Spacing.sm) {
                Button {
                    viewModel.seek(by: -10)
                } label: {
                    Image(systemName: "gobackward.10")
                }
                .buttonStyle(.plain)

                Button {
                    viewModel.togglePlayPause()
                } label: {
                    Image(systemName: viewModel.isPlaying ? "pause.fill" : "play.fill")
                        .font(.title3)
                }
                .buttonStyle(.plain)

                Button {
                    viewModel.seek(by: 10)
                } label: {
                    Image(systemName: "goforward.10")
                }
                .buttonStyle(.plain)

                speedMenu
                qualityMenu
                audioMenu
                subtitleMenu

                Spacer()

                Button {
                    guard !viewModel.isFullscreenTransitioning else { return }
                    viewModel.registerUserInteraction()
                    Task { await viewModel.toggleFullscreen(window: playerWindow) }
                } label: {
                    Image(systemName: isFullscreen
                        ? "arrow.down.right.and.arrow.up.left"
                        : "arrow.up.left.and.arrow.down.right")
                }
                .buttonStyle(.plain)
                .help("Toggle fullscreen player window")
                .keyboardShortcut("f", modifiers: [.control, .command])
                .disabled(viewModel.isFullscreenTransitioning)
            }
            .foregroundStyle(.white)

            HStack(spacing: AppTheme.Spacing.sm) {
                Text(timeString(currentTime))
                    .font(.caption.monospacedDigit())
                    .foregroundStyle(.white.opacity(0.85))

                Slider(
                    value: Binding(
                        get: { progress },
                        set: { newValue in
                            progress = newValue
                            if isDraggingProgress {
                                currentTime = duration * newValue
                            }
                        }
                    ),
                    in: 0...1,
                    onEditingChanged: { editing in
                        isDraggingProgress = editing
                        if editing {
                            viewModel.registerUserInteraction()
                        } else {
                            viewModel.seek(to: progress)
                        }
                    }
                )
                .tint(.white)

                Text(timeString(duration))
                    .font(.caption.monospacedDigit())
                    .foregroundStyle(.white.opacity(0.85))
            }

            if let diagnostics = viewModel.diagnostics, !diagnostics.isEmpty {
                Text(diagnostics)
                    .font(.caption2)
                    .foregroundStyle(.white.opacity(0.7))
                    .lineLimit(2)
            }
        }
        .padding(AppTheme.Spacing.md)
        .frame(maxWidth: 960)
        .glassPanel(radius: AppTheme.Radius.md, level: .ultraThin)
    }

    private var qualityMenu: some View {
        Menu {
            ForEach(viewModel.availableStreams, id: \.streamURL) { candidate in
                Button(candidate.qualityLabel) {
                    Task { await viewModel.switchToStream(candidate) }
                }
            }
        } label: {
            Label(
                selectedStream?.quality.rawValue.uppercased() ?? "Quality",
                systemImage: "rectangle.3.group.fill"
            )
            .font(.caption)
        }
    }

    /// Playback-speed presets per the Tier-3 baseline (0.5×–2×).
    private static let speedOptions: [Double] = [0.5, 0.75, 1.0, 1.25, 1.5, 2.0]

    private var speedMenu: some View {
        Menu {
            ForEach(Self.speedOptions, id: \.self) { option in
                let rate = Float(option)
                Button {
                    speed = rate
                    viewModel.setPlaybackRate(rate)
                } label: {
                    if isCurrentSpeed(rate) {
                        Label(speedLabel(rate), systemImage: "checkmark")
                    } else {
                        Text(speedLabel(rate))
                    }
                }
            }
        } label: {
            Label(speedLabel(speed), systemImage: "speedometer")
                .font(.caption)
        }
        .help("Playback speed")
    }

    // The audio switcher is only meaningful when the media exposes more than one
    // selectable track, so it's disabled for 0/1-track media (Tier-3 baseline).
    private var audioMenu: some View {
        let tracks = viewModel.availableAudioTracks
        return Menu {
            if tracks.isEmpty {
                Text("No audio tracks")
            } else {
                ForEach(tracks) { track in
                    Button {
                        viewModel.selectAudioTrack(track.id)
                    } label: {
                        if viewModel.selectedAudioTrackID == track.id {
                            Label(track.menuLabel, systemImage: "checkmark")
                        } else {
                            Text(track.menuLabel)
                        }
                    }
                }
                if !viewModel.hasDetailedAudioMetadata {
                    Divider()
                    Text("Detailed audio metadata is unavailable for this stream.")
                }
            }
        } label: {
            Label("Audio", systemImage: "waveform")
                .font(.caption)
        }
        .help("Audio track")
        .disabled(tracks.count <= 1)
    }

    // VLCKit exposes a "Disable" entry (index -1) among the subtitle tracks, but we
    // surface an explicit "Off" row regardless so it's always reachable. The menu is
    // disabled only when the media has no subtitle tracks at all.
    private var subtitleMenu: some View {
        let tracks = viewModel.availableSubtitleTracks
        let selectableTracks = tracks.filter { !$0.isDisabledTrack }
        let isOff = viewModel.selectedSubtitleTrackID.map { $0 < 0 } ?? true
        return Menu {
            if tracks.isEmpty {
                Text("No subtitles")
            } else {
                Button {
                    viewModel.selectSubtitleTrack(PlayerViewModel.subtitlesOffTrackID)
                } label: {
                    if isOff {
                        Label("Off", systemImage: "checkmark")
                    } else {
                        Text("Off")
                    }
                }
                Divider()
                ForEach(selectableTracks) { track in
                    Button {
                        viewModel.selectSubtitleTrack(track.id)
                    } label: {
                        if viewModel.selectedSubtitleTrackID == track.id {
                            Label(track.menuLabel, systemImage: "checkmark")
                        } else {
                            Text(track.menuLabel)
                        }
                    }
                }
                if !viewModel.hasDetailedSubtitleMetadata {
                    Divider()
                    Text("Detailed subtitle metadata is unavailable for this stream.")
                }
            }
        } label: {
            Label("Subtitles", systemImage: "captions.bubble")
                .font(.caption)
        }
        .help("Subtitle track")
        .disabled(selectableTracks.isEmpty)
    }

    private func isCurrentSpeed(_ rate: Float) -> Bool {
        abs(speed - rate) < 0.001
    }

    private func speedLabel(_ rate: Float) -> String {
        if rate == rate.rounded() {
            return String(format: "%.0f×", rate)
        }
        return String(format: "%.2g×", rate)
    }

    private var loadingOverlay: some View {
        VStack(spacing: AppTheme.Spacing.md) {
            ProgressView()
                .controlSize(.large)
            Text("Preparing player...")
                .font(.headline)
                .foregroundStyle(.white)
            Text(stream.fileName)
                .font(.caption)
                .foregroundStyle(.white.opacity(0.65))
                .lineLimit(1)
            if let diagnostics = viewModel.diagnostics {
                Text(diagnostics)
                    .font(.caption2)
                    .foregroundStyle(.white.opacity(0.55))
            }
        }
        .padding(AppTheme.Spacing.xl)
        .glassCard()
    }

    private func errorOverlay(_ errorMessage: String) -> some View {
        VStack(spacing: AppTheme.Spacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 42))
                .foregroundStyle(AppTheme.warning)
            Text("Playback Failed")
                .font(.title3)
                .fontWeight(.semibold)
                .foregroundStyle(.white)
            Text(errorMessage)
                .font(.caption)
                .foregroundStyle(.white.opacity(0.75))
                .multilineTextAlignment(.center)
                .padding(.horizontal, AppTheme.Spacing.xl)

            HStack(spacing: AppTheme.Spacing.sm) {
                Button("Retry") {
                    Task { await viewModel.retryLastPlayback() }
                }
                .buttonStyle(.glassProminent)
            }
        }
        .padding(AppTheme.Spacing.lg)
        .glassCard()
    }

    private var selectedStream: StreamInfo? {
        guard let selectedStreamURL = viewModel.selectedStreamURL else {
            return viewModel.availableStreams.first
        }
        return viewModel.availableStreams.first(where: { $0.streamURL == selectedStreamURL }) ?? viewModel.availableStreams.first
    }

    private func startPlayback() async {
        let settings = appState.settingsManager
        let backend = (try? await settings?.getInternalPlayerBackend()) ?? .automatic
        let externalPreference = (try? await settings?.getPreferredPlayer()) ?? .auto
        speed = 1

        await viewModel.preparePlayback(
            stream: stream,
            availableStreams: availableStreams.isEmpty ? [stream] : availableStreams,
            backendPreference: backend,
            externalPlayerPreference: externalPreference
        )

        await attemptResumeFromHistory()
    }

    private func syncProgressLoop() async {
        while !Task.isCancelled {
            _ = viewModel.applyPendingResumeIfPossible()
            let current = viewModel.currentTimeSeconds
            let total = viewModel.durationSeconds ?? 0

            if !isDraggingProgress {
                currentTime = current
                duration = total
                if total > 0 {
                    progress = min(max(current / total, 0), 1)
                } else {
                    progress = 0
                }
            }

            try? await Task.sleep(for: .milliseconds(250))
        }
    }

    private func checkpointLoop() async {
        while !Task.isCancelled {
            if let snapshot = viewModel.playbackProgressSnapshot() {
                let delta = abs(snapshot.progressSeconds - lastPersistedCheckpointSeconds)
                if delta >= 15 {
                    lastPersistedCheckpointSeconds = snapshot.progressSeconds
                    await persistWatchProgress(snapshot: snapshot)
                }
            }
            try? await Task.sleep(for: .seconds(4))
        }
    }

    private func persistWatchProgress(
        snapshot: PlayerViewModel.PlaybackProgressSnapshot?,
        isFinalCheckpoint: Bool = false
    ) async {
        guard let database = appState.databaseManager else { return }
        guard let snapshot else { return }

        let current = snapshot.progressSeconds
        guard current.isFinite, current > 0 else { return }

        let duration = snapshot.durationSeconds
        let completed = if let duration, duration > 0 {
            current / duration >= 0.95
        } else {
            false
        }

        let idSuffix = episodeId ?? "movie"
        let entry = WatchHistory(
            id: "\(mediaId)-\(idSuffix)",
            mediaId: mediaId,
            episodeId: episodeId,
            progressSeconds: current,
            durationSeconds: duration,
            completed: completed,
            lastWatched: Date(),
            streamQuality: selectedStream?.quality.rawValue ?? stream.quality.rawValue
        )

        try? await database.saveWatchHistory(entry)
        if completed {
            await appState.userFeedbackService?.recordAutoCompletion(
                mediaId: mediaId,
                episodeId: episodeId,
                progressSeconds: current,
                durationSeconds: duration
            )
        }

        // Best-effort Trakt scrobble. Fire-and-forget; never blocks/fails playback.
        // A `stop` (vs `start`) at >= 95% lets Trakt auto-mark the item watched.
        if let duration, duration > 0 {
            let percent = min(max(current / duration * 100, 0), 100)
            // A `stop` finalizes the scrobble (Trakt auto-marks watched at >= 80%);
            // send it on completion or when the player is tearing down, otherwise a
            // `start`/progress update keeps the item in "currently watching".
            appState.scrobbleTrakt(
                mediaId: mediaId,
                episodeId: episodeId,
                progressPercent: percent,
                action: (completed || isFinalCheckpoint) ? .stop : .start
            )
        }
    }

    private func attemptResumeFromHistory() async {
        guard let database = appState.databaseManager else { return }
        guard let history = try? await database.fetchWatchHistory(mediaId: mediaId, episodeId: episodeId) else { return }
        guard history.completed == false else { return }
        _ = viewModel.queueResumeTarget(
            progressSeconds: history.progressSeconds,
            storedDurationSeconds: history.durationSeconds
        )
        _ = viewModel.applyPendingResumeIfPossible()
    }

    private func closePlayer() {
        if let playerWindow {
            playerWindow.performClose(nil)
            return
        }
        teardownPlayer(notifyParent: true)
    }

    private func teardownPlayer(notifyParent: Bool) {
        guard !didTeardown else { return }
        didTeardown = true

        let snapshot = viewModel.playbackProgressSnapshot()
        viewModel.stop()
        if notifyParent {
            onClose()
        }
        Task { await persistWatchProgress(snapshot: snapshot, isFinalCheckpoint: true) }
    }

    private func timeString(_ value: Double) -> String {
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

private struct VLCPlayerSurfaceView: NSViewRepresentable {
    let makeView: () -> NSView

    func makeNSView(context: Context) -> NSView {
        makeView()
    }

    func updateNSView(_ nsView: NSView, context: Context) {
        // Session owns drawable lifecycle.
    }
}

private struct PlayerWindowAccessor: NSViewRepresentable {
    @Binding var window: NSWindow?

    func makeNSView(context: Context) -> NSView {
        let view = NSView(frame: .zero)
        DispatchQueue.main.async {
            if window !== view.window {
                window = view.window
            }
        }
        return view
    }

    func updateNSView(_ nsView: NSView, context: Context) {
        DispatchQueue.main.async {
            if window !== nsView.window {
                window = nsView.window
            }
        }
    }
}

private struct MouseMoveMonitor: NSViewRepresentable {
    let onMove: () -> Void

    func makeNSView(context: Context) -> TrackingView {
        let view = TrackingView()
        view.onMove = onMove
        return view
    }

    func updateNSView(_ nsView: TrackingView, context: Context) {
        nsView.onMove = onMove
    }

    final class TrackingView: NSView {
        var onMove: (() -> Void)?
        private var trackingArea: NSTrackingArea?

        override func updateTrackingAreas() {
            if let trackingArea {
                removeTrackingArea(trackingArea)
            }
            let area = NSTrackingArea(
                rect: bounds,
                options: [.activeAlways, .mouseMoved, .inVisibleRect],
                owner: self,
                userInfo: nil
            )
            addTrackingArea(area)
            trackingArea = area
            super.updateTrackingAreas()
        }

        override func mouseMoved(with event: NSEvent) {
            onMove?()
            super.mouseMoved(with: event)
        }

        override func viewDidMoveToWindow() {
            super.viewDidMoveToWindow()
            window?.acceptsMouseMovedEvents = true
        }
    }
}
