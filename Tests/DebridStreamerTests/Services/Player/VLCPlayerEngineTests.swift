import Testing
import Foundation
import AppKit
@testable import DebridStreamer

@Suite("VLCPlayerEngine Tests")
@MainActor
struct VLCPlayerEngineTests {
    @Test("Prepare returns a VLC session when factory succeeds")
    func prepareReturnsSession() async throws {
        let stream = StreamInfo(
            streamURL: "https://cdn.example.com/movie.mkv",
            quality: .hd1080p,
            codec: .h265,
            audio: .ac3,
            source: .webDL,
            sizeBytes: 1_000_000_000,
            fileName: "Movie.1080p.mkv",
            debridService: "Real-Debrid"
        )
        let expectedSession = MockVLCSession()
        let engine = VLCPlayerEngine(sessionFactory: { _ in expectedSession })

        let prepared = try await engine.prepare(stream: stream)
        #expect(prepared.kind == .vlc)
        #expect(prepared.vlcSession != nil)
        #expect(prepared.avPlayer == nil)
    }

    @Test("Prepare surfaces factory failures")
    func preparePropagatesFactoryErrors() async {
        let stream = StreamInfo(
            streamURL: "https://cdn.example.com/movie.mkv",
            quality: .hd1080p,
            codec: .h265,
            audio: .ac3,
            source: .webDL,
            sizeBytes: 1_000_000_000,
            fileName: "Movie.1080p.mkv",
            debridService: "Real-Debrid"
        )
        let engine = VLCPlayerEngine(sessionFactory: { _ in
            throw PlayerEngineError.vlcKitUnavailable
        })

        do {
            _ = try await engine.prepare(stream: stream)
            Issue.record("Expected vlcKitUnavailable error")
        } catch let error as PlayerEngineError {
            #expect(error == .vlcKitUnavailable)
        } catch {
            Issue.record("Unexpected error: \(error)")
        }
    }

    @Test("Track option menu label includes rich metadata when available")
    func trackOptionMenuLabelWithMetadata() {
        let option = VLCTrackOption(
            id: 2,
            name: "English",
            languageCode: "en",
            codec: "eac3",
            channelCount: 6,
            isDisabledTrack: false,
            spatialAudioHint: true
        )

        #expect(option.hasRichMetadata == true)
        #expect(option.menuLabel.contains("EN"))
        #expect(option.menuLabel.contains("EAC3"))
        #expect(option.menuLabel.contains("6ch"))
        #expect(option.menuLabel.contains("Spatial"))
    }

    @Test("Track option infers disabled state from id and name")
    func trackOptionDisabledInference() {
        let byID = VLCTrackOption(id: -1, name: "Track")
        let byName = VLCTrackOption(id: 1, name: "Disabled")

        #expect(byID.isDisabledTrack == true)
        #expect(byName.isDisabledTrack == true)
    }
}

@MainActor
private final class MockVLCSession: VLCPlaybackSession {
    var isPlaying: Bool = false
    var position: Float = 0
    var playbackRate: Float = 1.0
    var currentTimeSeconds: Double = 0
    var durationSeconds: Double? = 0
    var availableAudioTracks: [VLCTrackOption] = []
    var availableSubtitleTracks: [VLCTrackOption] = []
    var selectedAudioTrackID: Int32?
    var selectedSubtitleTrackID: Int32?
    func makeVideoView() -> NSView { NSView(frame: .zero) }
    func seek(to seconds: Double) {
        currentTimeSeconds = max(0, seconds)
    }
    func refreshTrackOptions() {}
    func selectAudioTrack(id: Int32) { selectedAudioTrackID = id }
    func selectSubtitleTrack(id: Int32) { selectedSubtitleTrackID = id }
    func play() {}
    func pause() {}
    func stop() {}
}
