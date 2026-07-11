import Foundation
import AppKit

struct VLCTrackOption: Identifiable, Equatable, Sendable {
    let id: Int32
    let name: String
    let languageCode: String?
    let codec: String?
    let channelCount: Int?
    let isDisabledTrack: Bool
    let spatialAudioHint: Bool

    init(
        id: Int32,
        name: String,
        languageCode: String? = nil,
        codec: String? = nil,
        channelCount: Int? = nil,
        isDisabledTrack: Bool? = nil,
        spatialAudioHint: Bool? = nil
    ) {
        self.id = id
        self.name = name
        self.languageCode = languageCode?.trimmingCharacters(in: .whitespacesAndNewlines).nilIfEmpty
        self.codec = codec?.trimmingCharacters(in: .whitespacesAndNewlines).nilIfEmpty
        self.channelCount = channelCount
        self.isDisabledTrack = isDisabledTrack ?? Self.inferDisabledTrack(id: id, name: name)
        self.spatialAudioHint = spatialAudioHint ?? Self.inferSpatialAudioHint(in: "\(name) \(codec ?? "")")
    }

    var hasRichMetadata: Bool {
        languageCode != nil || codec != nil || channelCount != nil || spatialAudioHint
    }

    var menuLabel: String {
        if isDisabledTrack {
            return name
        }

        var details: [String] = []
        if let languageCode {
            details.append(languageCode.uppercased())
        }
        if let codec {
            details.append(codec.uppercased())
        }
        if let channelCount, channelCount > 0 {
            details.append("\(channelCount)ch")
        }
        if spatialAudioHint {
            details.append("Spatial")
        }

        guard !details.isEmpty else { return name }
        return "\(name) (\(details.joined(separator: " • ")))"
    }

    private static func inferDisabledTrack(id: Int32, name: String) -> Bool {
        if id < 0 {
            return true
        }
        let normalized = name.lowercased()
        return normalized.contains("disable")
            || normalized.contains("disabled")
            || normalized.contains("off")
            || normalized == "none"
    }

    private static func inferSpatialAudioHint(in text: String) -> Bool {
        let normalized = text.lowercased()
        return normalized.contains("atmos")
            || normalized.contains("truehd")
            || normalized.contains("dts:x")
            || normalized.contains("dtsx")
            || normalized.contains("dts-hd ma")
            || normalized.contains("eac3")
            || normalized.contains("ec-3")
    }
}

@MainActor
protocol VLCPlaybackSession: AnyObject {
    var isPlaying: Bool { get }
    var isSeekable: Bool { get }
    var position: Float { get set }
    var playbackRate: Float { get set }
    var currentTimeSeconds: Double { get }
    var durationSeconds: Double? { get }
    var availableAudioTracks: [VLCTrackOption] { get }
    var availableSubtitleTracks: [VLCTrackOption] { get }
    var selectedAudioTrackID: Int32? { get }
    var selectedSubtitleTrackID: Int32? { get }
    /// Intrinsic size of the decoded video in pixels, or `.zero` until the first
    /// frame is available (and for audio-only media). Used to align the controls
    /// overlay with the rendered picture rather than the window bounds.
    var videoSize: CGSize { get }
    func makeVideoView() -> NSView
    func seek(to seconds: Double)
    func refreshTrackOptions()
    func selectAudioTrack(id: Int32)
    func selectSubtitleTrack(id: Int32)
    func play()
    func pause()
    func stop()
}

extension VLCPlaybackSession {
    /// Sessions that cannot report an intrinsic size (audio-only media, the AVPlayer
    /// path, and test doubles) fall back to `.zero`, which keeps the full-window
    /// controls layout unchanged.
    var videoSize: CGSize { .zero }
}

#if canImport(VLCKit)
@preconcurrency import VLCKit

@MainActor
final class VLCKitPlaybackSession: NSObject, VLCPlaybackSession {
    private enum TrackKind {
        case audio
        case subtitle
    }

    private struct ParsedTrackMetadata {
        let languageCode: String?
        let codec: String?
        let channelCount: Int?
        let spatialAudioHint: Bool
    }

    private let mediaPlayer = VLCMediaPlayer()
    private var videoView: VLCVideoView?
    private var cachedAudioTracks: [VLCTrackOption] = []
    private var cachedSubtitleTracks: [VLCTrackOption] = []
    private var didRequestMetadataParse = false

    init(url: URL) {
        super.init()
        mediaPlayer.drawable = nil
        mediaPlayer.media = VLCMedia(url: url)
    }

    deinit {
        // VLCMediaPlayer is not thread-safe and must be torn down on the main
        // thread. `deinit` is non-isolated and can run on whatever thread releases
        // the last reference, so hop to main (capturing the player so it stays
        // alive until cleanup runs) instead of touching it inline.
        let player = mediaPlayer
        if Thread.isMainThread {
            player.stop()
            player.drawable = nil
        } else {
            DispatchQueue.main.async {
                player.stop()
                player.drawable = nil
            }
        }
    }

    var isPlaying: Bool {
        mediaPlayer.isPlaying
    }

    var isSeekable: Bool {
        mediaPlayer.isSeekable
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

    var videoSize: CGSize {
        // VLCMediaPlayer only reports a non-zero size once the first frame has been
        // decoded; before that (and for audio-only media) it is `.zero`, which the
        // player treats as "unknown" and falls back to the full-window layout.
        mediaPlayer.videoSize
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
        let parsedMetadata = parseTrackMetadata()
        cachedAudioTracks = mapTrackOptions(
            names: mediaPlayer.audioTrackNames,
            indexes: mediaPlayer.audioTrackIndexes,
            metadataByID: parsedMetadata.audioMetadata
        )
        cachedSubtitleTracks = mapTrackOptions(
            names: mediaPlayer.videoSubTitlesNames,
            indexes: mediaPlayer.videoSubTitlesIndexes,
            metadataByID: parsedMetadata.subtitleMetadata
        )
    }

    func selectAudioTrack(id: Int32) {
        mediaPlayer.currentAudioTrackIndex = id
    }

    func selectSubtitleTrack(id: Int32) {
        // A negative id means "turn subtitles off". Prefer the disable index VLCKit
        // actually reports (usually -1) so we match the engine's own sentinel; fall
        // back to -1 when no explicit disable entry is exposed.
        if id < 0 {
            let disableIndex = cachedSubtitleTracks.first(where: { $0.isDisabledTrack })?.id ?? -1
            mediaPlayer.currentVideoSubTitleIndex = disableIndex
            return
        }
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
        mediaPlayer.drawable = nil
    }

    private func mapTrackOptions(
        names: [Any],
        indexes: [Any],
        metadataByID: [Int32: ParsedTrackMetadata]
    ) -> [VLCTrackOption] {
        let count = min(names.count, indexes.count)
        guard count > 0 else { return [] }
        return (0..<count).map { index in
            let name = String(describing: names[index])
            let id = int32(from: indexes[index]) ?? Int32(index)
            let metadata = metadataByID[id]
            return VLCTrackOption(
                id: id,
                name: name,
                languageCode: metadata?.languageCode,
                codec: metadata?.codec,
                channelCount: metadata?.channelCount,
                spatialAudioHint: metadata?.spatialAudioHint
            )
        }
    }

    private func parseTrackMetadata() -> (audioMetadata: [Int32: ParsedTrackMetadata], subtitleMetadata: [Int32: ParsedTrackMetadata]) {
        guard let media = mediaPlayer.media else {
            return ([:], [:])
        }

        // Ask VLCKit to parse metadata opportunistically, but only ONCE — the
        // legacy `parse()` is synchronous-ish and runs on the main actor, so
        // calling it on every track refresh repeatedly blocks the UI. If parse
        // hasn't completed yet we fall back to track name/index mapping below.
        if !didRequestMetadataParse {
            didRequestMetadataParse = true
            _ = media.parse(options: VLCMediaParsingOptions(rawValue: 1))
        }

        guard let tracks = media.tracksInformation as? [[AnyHashable: Any]], !tracks.isEmpty else {
            return ([:], [:])
        }

        var audio: [Int32: ParsedTrackMetadata] = [:]
        var subtitles: [Int32: ParsedTrackMetadata] = [:]

        for track in tracks {
            guard let id = int32(from: track[VLCMediaTracksInformationId]) else { continue }
            guard let kind = trackKind(from: track[VLCMediaTracksInformationType]) else { continue }

            let languageCode = (track[VLCMediaTracksInformationLanguage] as? String)?
                .trimmingCharacters(in: .whitespacesAndNewlines)
                .nilIfEmpty
            let codec = decodeCodec(from: track[VLCMediaTracksInformationCodec])
            let channelCount = int(from: track[VLCMediaTracksInformationAudioChannelsNumber])
            let description = (track[VLCMediaTracksInformationDescription] as? String) ?? ""
            let hintPayload = [description, codec ?? "", languageCode ?? ""].joined(separator: " ")
            let metadata = ParsedTrackMetadata(
                languageCode: languageCode,
                codec: codec,
                channelCount: kind == .audio ? channelCount : nil,
                spatialAudioHint: inferSpatialAudioHint(in: hintPayload)
            )

            switch kind {
            case .audio:
                audio[id] = metadata
            case .subtitle:
                subtitles[id] = metadata
            }
        }

        return (audio, subtitles)
    }

    private func trackKind(from rawType: Any?) -> TrackKind? {
        guard let type = rawType as? String else { return nil }
        if type == VLCMediaTracksInformationTypeAudio {
            return .audio
        }
        if type == VLCMediaTracksInformationTypeText {
            return .subtitle
        }
        return nil
    }

    private func decodeCodec(from rawCodec: Any?) -> String? {
        if let codecString = rawCodec as? String {
            return codecString.trimmingCharacters(in: .whitespacesAndNewlines).nilIfEmpty
        }

        guard let number = rawCodec as? NSNumber else { return nil }
        let value = number.uint32Value
        let bigEndian = String(bytes: [
            UInt8((value >> 24) & 0xFF),
            UInt8((value >> 16) & 0xFF),
            UInt8((value >> 8) & 0xFF),
            UInt8(value & 0xFF)
        ], encoding: .ascii)?
        .trimmingCharacters(in: .controlCharacters.union(.whitespacesAndNewlines))

        if let bigEndian, isLikelyCodecTag(bigEndian) {
            return bigEndian
        }

        let littleEndian = String(bytes: [
            UInt8(value & 0xFF),
            UInt8((value >> 8) & 0xFF),
            UInt8((value >> 16) & 0xFF),
            UInt8((value >> 24) & 0xFF)
        ], encoding: .ascii)?
        .trimmingCharacters(in: .controlCharacters.union(.whitespacesAndNewlines))

        if let littleEndian, isLikelyCodecTag(littleEndian) {
            return littleEndian
        }

        return String(format: "0x%08X", value)
    }

    private func isLikelyCodecTag(_ value: String) -> Bool {
        guard !value.isEmpty else { return false }
        return value.unicodeScalars.allSatisfy { scalar in
            scalar.value >= 32 && scalar.value <= 126
        }
    }

    private func int32(from value: Any?) -> Int32? {
        if let number = value as? NSNumber {
            return number.int32Value
        }
        if let intValue = value as? Int {
            return Int32(intValue)
        }
        if let string = value as? String, let parsed = Int32(string) {
            return parsed
        }
        return nil
    }

    private func int(from value: Any?) -> Int? {
        if let number = value as? NSNumber {
            return number.intValue
        }
        if let intValue = value as? Int {
            return intValue
        }
        if let string = value as? String, let parsed = Int(string) {
            return parsed
        }
        return nil
    }

    private func inferSpatialAudioHint(in text: String) -> Bool {
        let normalized = text.lowercased()
        return normalized.contains("atmos")
            || normalized.contains("truehd")
            || normalized.contains("dts:x")
            || normalized.contains("dtsx")
            || normalized.contains("dts-hd ma")
            || normalized.contains("eac3")
            || normalized.contains("ec-3")
    }
}
#endif

private extension String {
    var nilIfEmpty: String? {
        isEmpty ? nil : self
    }
}
