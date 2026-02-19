import Foundation
import AppKit

struct VLCTrackOption: Identifiable, Equatable, Sendable {
    let id: Int32
    let name: String
}

@MainActor
protocol VLCPlaybackSession: AnyObject {
    var isPlaying: Bool { get }
    var position: Float { get set }
    var playbackRate: Float { get set }
    var currentTimeSeconds: Double { get }
    var durationSeconds: Double? { get }
    var availableAudioTracks: [VLCTrackOption] { get }
    var availableSubtitleTracks: [VLCTrackOption] { get }
    var selectedAudioTrackID: Int32? { get }
    var selectedSubtitleTrackID: Int32? { get }
    func makeVideoView() -> NSView
    func seek(to seconds: Double)
    func refreshTrackOptions()
    func selectAudioTrack(id: Int32)
    func selectSubtitleTrack(id: Int32)
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
    private var cachedAudioTracks: [VLCTrackOption] = []
    private var cachedSubtitleTracks: [VLCTrackOption] = []

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

    var playbackRate: Float {
        get { mediaPlayer.rate }
        set { mediaPlayer.rate = max(0.25, min(newValue, 2.0)) }
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

    var availableAudioTracks: [VLCTrackOption] {
        cachedAudioTracks
    }

    var availableSubtitleTracks: [VLCTrackOption] {
        cachedSubtitleTracks
    }

    var selectedAudioTrackID: Int32? {
        mediaPlayer.currentAudioTrackIndex
    }

    var selectedSubtitleTrackID: Int32? {
        mediaPlayer.currentVideoSubTitleIndex
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

    func refreshTrackOptions() {
        cachedAudioTracks = mapTrackOptions(
            names: mediaPlayer.audioTrackNames,
            indexes: mediaPlayer.audioTrackIndexes
        )
        cachedSubtitleTracks = mapTrackOptions(
            names: mediaPlayer.videoSubTitlesNames,
            indexes: mediaPlayer.videoSubTitlesIndexes
        )
    }

    func selectAudioTrack(id: Int32) {
        mediaPlayer.currentAudioTrackIndex = id
    }

    func selectSubtitleTrack(id: Int32) {
        mediaPlayer.currentVideoSubTitleIndex = id
    }

    func play() {
        mediaPlayer.play()
        refreshTrackOptions()
    }

    func pause() {
        mediaPlayer.pause()
    }

    func stop() {
        mediaPlayer.stop()
    }

    private func mapTrackOptions(names: [Any], indexes: [Any]) -> [VLCTrackOption] {
        let count = min(names.count, indexes.count)
        guard count > 0 else { return [] }
        return (0..<count).map { index in
            let name = String(describing: names[index])
            let id: Int32
            if let number = indexes[index] as? NSNumber {
                id = number.int32Value
            } else if let intValue = indexes[index] as? Int {
                id = Int32(intValue)
            } else {
                id = Int32(index)
            }
            return VLCTrackOption(
                id: id,
                name: name
            )
        }
    }
}
#endif
