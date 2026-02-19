import Testing
import Foundation
@testable import DebridStreamer

@Suite("PlayerEngineSelector Tests")
struct PlayerEngineSelectorTests {
    private let selector = PlayerEngineSelector()

    @Test("Automatic mode is VLC-only")
    func automaticIsVLCOnly() {
        let stream = StreamInfo(
            streamURL: "https://cdn.example.com/movie.mp4",
            quality: .hd1080p,
            codec: .h264,
            audio: .aac,
            source: .webDL,
            sizeBytes: 1_000_000_000,
            fileName: "Movie.1080p.mp4",
            debridService: "Real-Debrid"
        )

        let order = selector.engineOrder(for: stream, backendPreference: .automatic)
        #expect(order == [.vlc])
    }

    @Test("Explicit VLC backend remains VLC-only")
    func explicitVLCIsVLCOnly() {
        let stream = StreamInfo(
            streamURL: "https://cdn.example.com/movie.mkv",
            quality: .uhd4k,
            codec: .av1,
            audio: .aac,
            source: .webRip,
            sizeBytes: 2_000_000_000,
            fileName: "Movie.2160p.AV1.mkv",
            debridService: "Real-Debrid"
        )

        let order = selector.engineOrder(for: stream, backendPreference: .vlc)
        #expect(order == [.vlc])
    }
}
