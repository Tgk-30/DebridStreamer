import SwiftUI
import AVKit
import AppKit

struct PlayerView: View {
    @Environment(AppState.self) private var appState
    @Environment(\.dismiss) private var dismiss

    let stream: StreamInfo
    let mediaTitle: String
    let mediaId: String
    let episodeId: String?

    @State private var viewModel = PlayerViewModel()
    @State private var vlcPosition: Double = 0
    @State private var isVLCPlaying = false
    @State private var isDraggingVLCPosition = false

    var body: some View {
        ZStack(alignment: .topTrailing) {
            Color.black.ignoresSafeArea()

            if viewModel.selectedEngine == .vlc, let session = viewModel.vlcSession {
                ZStack(alignment: .bottom) {
                    VLCPlayerSurfaceView(session: session)
                        .frame(maxWidth: .infinity, maxHeight: .infinity)

                    VStack(spacing: 10) {
                        HStack(spacing: 16) {
                            Button {
                                toggleVLCPlayback(session: session)
                            } label: {
                                Image(systemName: isVLCPlaying ? "pause.fill" : "play.fill")
                                    .font(.title3)
                                    .foregroundStyle(.white)
                            }
                            .buttonStyle(.plain)

                            Slider(value: $vlcPosition, in: 0...1, onEditingChanged: { editing in
                                isDraggingVLCPosition = editing
                                if !editing {
                                    session.position = Float(vlcPosition)
                                }
                            })
                            .tint(.white)
                        }
                    }
                    .padding(.horizontal, 18)
                    .padding(.vertical, 12)
                    .frame(maxWidth: 760)
                    .glassSurface()
                    .padding(.bottom, 20)
                }
            } else if let player = viewModel.avPlayer {
                NativeAVPlayerView(player: player)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            }

            if viewModel.isLoading {
                loadingView
            } else if viewModel.launchedExternal {
                externalLaunchView
            } else if let errorMessage = viewModel.errorMessage {
                errorView(errorMessage)
            }

            Button {
                dismiss()
            } label: {
                Image(systemName: "xmark.circle.fill")
                    .font(.title2)
                    .foregroundStyle(.white.opacity(0.85))
                    .padding(10)
            }
            .buttonStyle(.plain)
        }
        .navigationTitle(mediaTitle)
        .task {
            await startPlayback()
        }
        .task(id: viewModel.selectedEngine == .vlc) {
            await syncVLCStateLoop()
        }
        .onDisappear {
            Task {
                await persistWatchProgress()
            }
            viewModel.stop()
        }
    }

    private var loadingView: some View {
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
            Text(stream.qualityLabel)
                .font(.caption2)
                .foregroundStyle(.white.opacity(0.55))
        }
        .padding(20)
    }

    private var externalLaunchView: some View {
        VStack(spacing: 10) {
            Image(systemName: "arrow.up.right.square")
                .font(.system(size: 40))
                .foregroundStyle(.white)
            Text("Opened in External Player")
                .font(.title3)
                .fontWeight(.semibold)
                .foregroundStyle(.white)
            Text(viewModel.externalLaunchMessage ?? "Internal playback could not start.")
                .font(.caption)
                .foregroundStyle(.white.opacity(0.75))
                .multilineTextAlignment(.center)
                .padding(.horizontal, 24)
            Button("Close") {
                dismiss()
            }
            .buttonStyle(.borderedProminent)
            .padding(.top, 6)
        }
        .padding(18)
    }

    private func errorView(_ errorMessage: String) -> some View {
        VStack(spacing: 10) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 42))
                .foregroundStyle(.orange)
            Text("Playback Error")
                .font(.title3)
                .fontWeight(.semibold)
                .foregroundStyle(.white)
            Text(errorMessage)
                .font(.caption)
                .foregroundStyle(.white.opacity(0.75))
                .multilineTextAlignment(.center)
                .padding(.horizontal, 24)
            if let url = stream.url {
                Button("Copy Stream URL") {
                    NSPasteboard.general.clearContents()
                    NSPasteboard.general.setString(url.absoluteString, forType: .string)
                }
                .buttonStyle(.bordered)
            }
        }
        .padding(18)
    }

    private func startPlayback() async {
        let settings = appState.settingsManager
        let backend = (try? await settings?.getInternalPlayerBackend()) ?? .automatic
        let externalPreference = (try? await settings?.getPreferredPlayer()) ?? .auto

        await viewModel.preparePlayback(
            stream: stream,
            backendPreference: backend,
            externalPlayerPreference: externalPreference
        )
    }

    private func toggleVLCPlayback(session: any VLCPlaybackSession) {
        if session.isPlaying {
            session.pause()
            isVLCPlaying = false
        } else {
            session.play()
            isVLCPlaying = true
        }
    }

    private func syncVLCStateLoop() async {
        guard viewModel.selectedEngine == .vlc else { return }

        while !Task.isCancelled && viewModel.selectedEngine == .vlc {
            if let session = viewModel.vlcSession {
                isVLCPlaying = session.isPlaying
                if !isDraggingVLCPosition {
                    vlcPosition = Double(session.position)
                }
            }
            try? await Task.sleep(for: .milliseconds(250))
        }
    }

    private func persistWatchProgress() async {
        guard let database = appState.databaseManager else { return }
        guard let player = viewModel.avPlayer else { return }

        let current = player.currentTime().seconds
        if !current.isFinite || current <= 0 {
            return
        }

        let durationRaw = player.currentItem?.duration.seconds ?? 0
        let duration = durationRaw.isFinite && durationRaw > 0 ? durationRaw : nil
        let completed = if let duration {
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
            streamQuality: stream.quality.rawValue
        )

        try? await database.saveWatchHistory(entry)
    }
}

private struct NativeAVPlayerView: NSViewRepresentable {
    let player: AVPlayer

    func makeNSView(context: Context) -> AVPlayerView {
        let view = AVPlayerView()
        view.controlsStyle = .floating
        view.player = player
        return view
    }

    func updateNSView(_ nsView: AVPlayerView, context: Context) {
        if nsView.player !== player {
            nsView.player = player
        }
    }
}

private struct VLCPlayerSurfaceView: NSViewRepresentable {
    let session: any VLCPlaybackSession

    func makeNSView(context: Context) -> NSView {
        session.makeVideoView()
    }

    func updateNSView(_ nsView: NSView, context: Context) {
        // Session owns its drawable view lifecycle.
    }
}
