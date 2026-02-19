import Foundation
import AVKit
import Observation

@MainActor
@Observable
final class PlayerViewModel {
    var isLoading = false
    var errorMessage: String?
    var avPlayer: AVPlayer?
    var vlcSession: (any VLCPlaybackSession)?
    var launchedExternal = false
    var externalLaunchMessage: String?
    var selectedEngine: PlayerEngineKind?

    private let selector: PlayerEngineSelector
    private let avEngine: any PlayerEngine
    private let vlcEngine: any PlayerEngine
    private let externalLauncher: ExternalPlayerLauncher

    init(
        selector: PlayerEngineSelector = PlayerEngineSelector(),
        avEngine: any PlayerEngine = AVPlayerEngine(),
        vlcEngine: any PlayerEngine = VLCPlayerEngine(),
        externalLauncher: ExternalPlayerLauncher = .live
    ) {
        self.selector = selector
        self.avEngine = avEngine
        self.vlcEngine = vlcEngine
        self.externalLauncher = externalLauncher
    }

    func preparePlayback(
        stream: StreamInfo,
        backendPreference: InternalPlayerBackend,
        externalPlayerPreference: PreferredPlayer
    ) async {
        isLoading = true
        errorMessage = nil
        launchedExternal = false
        externalLaunchMessage = nil
        avPlayer?.pause()
        avPlayer = nil
        vlcSession?.stop()
        vlcSession = nil
        selectedEngine = nil

        let order = selector.engineOrder(for: stream, backendPreference: backendPreference)
        var errors: [String] = []

        for kind in order {
            let engine = engine(for: kind)
            guard engine.canHandle(stream) else { continue }

            do {
                let prepared = try await engine.prepare(stream: stream)
                selectedEngine = prepared.kind
                if prepared.kind == .avPlayer, let player = prepared.avPlayer {
                    avPlayer = player
                    isLoading = false
                    player.play()
                    return
                }
                if prepared.kind == .vlc, let session = prepared.vlcSession {
                    vlcSession = session
                    isLoading = false
                    session.play()
                    return
                }
            } catch {
                errors.append(error.localizedDescription)
            }
        }

        guard let url = stream.url else {
            errorMessage = PlayerEngineError.invalidStreamURL(stream.streamURL).localizedDescription
            isLoading = false
            return
        }

        let fallbackPreference = externalPlayerPreference == .builtIn ? .auto : externalPlayerPreference
        let launched = await externalLauncher.launch(url: url, preference: fallbackPreference)
        if launched {
            launchedExternal = true
            externalLaunchMessage = "Opened stream in external player after internal engines failed."
            isLoading = false
            return
        }

        errorMessage = errors.isEmpty
            ? "Unable to initialize playback."
            : errors.joined(separator: "\n")
        isLoading = false
    }

    func stop() {
        avPlayer?.pause()
        avPlayer = nil
        vlcSession?.stop()
        vlcSession = nil
    }

    private func engine(for kind: PlayerEngineKind) -> any PlayerEngine {
        switch kind {
        case .avPlayer:
            return avEngine
        case .vlc:
            return vlcEngine
        }
    }
}
