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
}

@MainActor
private final class MockVLCSession: VLCPlaybackSession {
    var isPlaying: Bool = false
    var position: Float = 0
    func makeVideoView() -> NSView { NSView(frame: .zero) }
    func play() {}
    func pause() {}
    func stop() {}
}
