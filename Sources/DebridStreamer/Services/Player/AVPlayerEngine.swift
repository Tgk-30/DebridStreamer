import Foundation
import AVFoundation

protocol AVPlayerReadinessMonitoring {
    @MainActor func waitUntilReady(
        player: AVPlayer,
        timeout: TimeInterval,
        onStateChange: (_ state: PlayerRuntimeState, _ diagnostics: String?) -> Void
    ) async throws
}

struct AVPlayerEngine: PlayerEngine {
    let kind: PlayerEngineKind = .avPlayer
    private let session: URLSession
    private let validateReachability: Bool

    init(session: URLSession = .shared, validateReachability: Bool = true) {
        self.session = session
        self.validateReachability = validateReachability
    }

    func canHandle(_ stream: StreamInfo) -> Bool {
        guard let url = stream.url else { return false }
        let ext = url.pathExtension.lowercased()
        let knownVideoExts = Set(["mp4", "mov", "m4v", "m3u8", "mpd", "ts", "mkv", "webm", "avi"])
        return ext.isEmpty || knownVideoExts.contains(ext)
    }

    @MainActor
    func prepare(stream: StreamInfo) async throws -> PreparedPlayback {
        guard let url = stream.url else {
            throw PlayerEngineError.invalidStreamURL(stream.streamURL)
        }

        if validateReachability {
            var request = URLRequest(url: url)
            request.httpMethod = "HEAD"
            request.timeoutInterval = 15
            do {
                let (_, response) = try await session.data(for: request)
                if let http = response as? HTTPURLResponse, !(200...399).contains(http.statusCode) {
                    throw PlayerEngineError.streamHTTPStatus(http.statusCode)
                }
            } catch let error as PlayerEngineError {
                throw error
            } catch {
                // Some hosts block HEAD. Continue with playback.
            }
        }

        let player = AVPlayer(url: url)
        return PreparedPlayback(
            kind: .avPlayer,
            streamURL: url,
            avPlayer: player,
            vlcSession: nil
        )
    }
}

struct AVPlayerReadinessMonitor: AVPlayerReadinessMonitoring {
    private let pollInterval: Duration

    init(pollInterval: Duration = .milliseconds(200)) {
        self.pollInterval = pollInterval
    }

    @MainActor
    func waitUntilReady(
        player: AVPlayer,
        timeout: TimeInterval,
        onStateChange: (_ state: PlayerRuntimeState, _ diagnostics: String?) -> Void
    ) async throws {
        guard timeout > 0 else {
            throw PlayerEngineError.unsupported("AVPlayer readiness timeout must be greater than zero.")
        }
        guard let item = player.currentItem else {
            throw PlayerEngineError.unsupported("AVPlayer did not provide a media item.")
        }

        let deadline = Date().addingTimeInterval(timeout)
        while true {
            if let itemError = item.error {
                throw PlayerEngineError.unsupported("AVPlayer item failed: \(itemError.localizedDescription)")
            }

            switch item.status {
            case .failed:
                throw PlayerEngineError.unsupported(
                    "AVPlayer item failed: \(item.error?.localizedDescription ?? "Unknown AVPlayer item error.")"
                )

            case .readyToPlay:
                if player.timeControlStatus == .playing || player.rate > 0 {
                    onStateChange(.playing, "First playable frame became ready.")
                    return
                }
                if player.timeControlStatus == .waitingToPlayAtSpecifiedRate {
                    if item.isPlaybackBufferEmpty {
                        onStateChange(.stalled, "Waiting for first frame with an empty buffer.")
                    } else {
                        onStateChange(.buffering, "Waiting for first playable frame.")
                    }
                } else {
                    onStateChange(.buffering, "AV stream ready; awaiting playback start.")
                }

            case .unknown:
                onStateChange(.preparing, "Loading AV stream metadata.")

            @unknown default:
                onStateChange(.buffering, "Waiting for AVPlayer readiness.")
            }

            if Date() >= deadline {
                throw PlayerEngineError.unsupported(
                    "AVPlayer startup timed out before the first playable frame."
                )
            }

            try await Task.sleep(for: pollInterval)
        }
    }
}
