import SwiftUI
import AppKit

struct PlayerView: View {
    @Environment(AppState.self) private var appState

    let stream: StreamInfo
    let availableStreams: [StreamInfo]
    let mediaTitle: String
    let mediaId: String
    let episodeId: String?
    var onClose: () -> Void = {}

    @State private var viewModel = PlayerViewModel()
    @State private var isDraggingProgress = false
    @State private var progress: Double = 0
    @State private var currentTime: Double = 0
    @State private var duration: Double = 0
    @State private var speed: Float = 1.0
    @State private var playerWindow: NSWindow?
    @State private var didTeardown = false

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
        .onDisappear {
            teardownPlayer(notifyParent: false)
        }
    }

    @ViewBuilder
    private var playbackSurface: some View {
        if let session = viewModel.vlcSession {
            VLCPlayerSurfaceView(session: session)
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
        VStack(spacing: 10) {
            statusPills
                .opacity(viewModel.controlsVisible ? 1 : 0)
            Spacer()
            controlsPanel
                .opacity(viewModel.controlsVisible ? 1 : 0)
        }
        .padding(12)
        .animation(.easeInOut(duration: 0.2), value: viewModel.controlsVisible)
    }

    private var statusPills: some View {
        HStack(spacing: 8) {
            if let engine = viewModel.selectedEngine {
                Label(engine.displayName, systemImage: "bolt.fill")
                    .font(.caption.weight(.semibold))
                    .padding(.horizontal, 10)
                    .padding(.vertical, 5)
                    .background(.thinMaterial, in: Capsule())
            }

            Text(viewModel.runtimeState.displayName)
                .font(.caption.weight(.semibold))
                .padding(.horizontal, 10)
                .padding(.vertical, 5)
                .background(.thinMaterial, in: Capsule())

            if let selected = selectedStream {
                Text(selected.quality.rawValue.uppercased())
                    .font(.caption2.weight(.semibold))
                    .padding(.horizontal, 8)
                    .padding(.vertical, 4)
                    .background(.thinMaterial, in: Capsule())
            }

            Spacer()
        }
        .foregroundStyle(.white)
    }

    private var controlsPanel: some View {
        let isFullscreen = viewModel.isFullscreenActive

        return VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 10) {
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

                Menu {
                    ForEach([0.75, 1.0, 1.25, 1.5, 2.0], id: \.self) { option in
                        Button(String(format: "%.2fx", option)) {
                            let rate = Float(option)
                            speed = rate
                            viewModel.setPlaybackRate(rate)
                        }
                    }
                } label: {
                    Label(String(format: "%.2fx", speed), systemImage: "speedometer")
                        .font(.caption)
                }

                qualityMenu
                audioMenu
                subtitleMenu

                Spacer()

                Button {
                    guard !viewModel.isFullscreenTransitioning else { return }
                    viewModel.registerUserInteraction()
                    Task { await viewModel.toggleFullscreen(window: playerWindow) }
                } label: {
                    Label(
                        isFullscreen ? "Windowed" : "Fullscreen",
                        systemImage: isFullscreen
                            ? "arrow.down.right.and.arrow.up.left"
                            : "arrow.up.left.and.arrow.down.right"
                    )
                }
                .buttonStyle(.bordered)
                .help("Toggle fullscreen player window")
                .keyboardShortcut("f", modifiers: [.control, .command])
                .disabled(viewModel.isFullscreenTransitioning)

                Button("Close") {
                    closePlayer()
                }
                .buttonStyle(.borderedProminent)
            }
            .foregroundStyle(.white)

            HStack(spacing: 8) {
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
        .padding(12)
        .frame(maxWidth: 960)
        .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 14))
        .overlay(
            RoundedRectangle(cornerRadius: 14)
                .stroke(Color.white.opacity(0.2), lineWidth: 1)
        )
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

    private var audioMenu: some View {
        Menu {
            if viewModel.availableAudioTracks.isEmpty {
                Text("No audio tracks")
            } else {
                ForEach(viewModel.availableAudioTracks) { track in
                    Button(track.menuLabel) {
                        viewModel.selectAudioTrack(track.id)
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
    }

    private var subtitleMenu: some View {
        Menu {
            if viewModel.availableSubtitleTracks.isEmpty {
                Text("No subtitles")
            } else {
                ForEach(viewModel.availableSubtitleTracks) { track in
                    Button(track.menuLabel) {
                        viewModel.selectSubtitleTrack(track.id)
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
    }

    private var loadingOverlay: some View {
        VStack(spacing: 14) {
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
        .padding(20)
    }

    private func errorOverlay(_ errorMessage: String) -> some View {
        VStack(spacing: 10) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 42))
                .foregroundStyle(.orange)
            Text("Playback Failed")
                .font(.title3)
                .fontWeight(.semibold)
                .foregroundStyle(.white)
            Text(errorMessage)
                .font(.caption)
                .foregroundStyle(.white.opacity(0.75))
                .multilineTextAlignment(.center)
                .padding(.horizontal, 24)

            HStack(spacing: 8) {
                Button("Retry") {
                    Task { await viewModel.retryLastPlayback() }
                }
                .buttonStyle(.borderedProminent)

                Button("Close") {
                    closePlayer()
                }
                .buttonStyle(.bordered)
            }
        }
        .padding(18)
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
    }

    private func syncProgressLoop() async {
        while !Task.isCancelled {
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

    private func persistWatchProgress(snapshot: PlayerViewModel.PlaybackProgressSnapshot?) async {
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
    }

    private func closePlayer() {
        teardownPlayer(notifyParent: true)
    }

    private func teardownPlayer(notifyParent: Bool) {
        guard !didTeardown else { return }
        didTeardown = true

        viewModel.exitFullscreen(window: playerWindow)
        let snapshot = viewModel.playbackProgressSnapshot()
        viewModel.stop()
        if notifyParent {
            onClose()
        }
        Task { await persistWatchProgress(snapshot: snapshot) }
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
    let session: any VLCPlaybackSession

    func makeNSView(context: Context) -> NSView {
        session.makeVideoView()
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
