import Foundation
import AppKit

@MainActor
protocol VLCPlaybackSession: AnyObject {
    var isPlaying: Bool { get }
    var position: Float { get set }
    var currentTimeSeconds: Double { get }
    var durationSeconds: Double? { get }
    func makeVideoView() -> NSView
    func seek(to seconds: Double)
    func play()
    func pause()
    func stop()
}

#if canImport(VLCKit)
import VLCKit

@MainActor
final class VLCKitPlaybackSession: NSObject, VLCPlaybackSession {
    private let mediaPlayer = VLCMediaPlayer()
    private var videoView: VLCVideoView?

    init(url: URL) {
        super.init()
        mediaPlayer.drawable = nil
        mediaPlayer.media = VLCMedia(url: url)
    }

    var isPlaying: Bool {
        mediaPlayer.isPlaying
    }

    var position: Float {
        get { mediaPlayer.position }
        set { mediaPlayer.position = min(max(newValue, 0), 1) }
    }

    var currentTimeSeconds: Double {
        let milliseconds = mediaPlayer.time.intValue
        return max(Double(milliseconds) / 1_000, 0)
    }

    var durationSeconds: Double? {
        guard let media = mediaPlayer.media else { return nil }
        let milliseconds = media.length.intValue
        guard milliseconds > 0 else { return nil }
        return Double(milliseconds) / 1_000
    }

    func makeVideoView() -> NSView {
        if let view = videoView {
            return view
        }
        let view = VLCVideoView(frame: .zero)
        view.autoresizingMask = [.width, .height]
        mediaPlayer.drawable = view
        videoView = view
        return view
    }

    func seek(to seconds: Double) {
        let clamped = max(seconds, 0)
        mediaPlayer.time = VLCTime(int: Int32(clamped * 1_000))
    }

    func play() {
        mediaPlayer.play()
    }

    func pause() {
        mediaPlayer.pause()
    }

    func stop() {
        mediaPlayer.stop()
    }
}
#endif
