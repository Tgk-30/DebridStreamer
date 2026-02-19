import Testing
import Foundation
@testable import DebridStreamer

@Suite("StreamInfo Tests")
struct StreamInfoTests {
    @Test("StreamInfo URL parsing")
    func urlParsing() {
        let stream = StreamInfo(
            streamURL: "https://download.example.com/movie.mkv",
            quality: .hd1080p,
            codec: .h265,
            audio: .dtsHDMA,
            source: .bluray,
            sizeBytes: 5_000_000_000,
            fileName: "Movie.1080p.BluRay.x265.DTS-HD.MA.mkv",
            debridService: "RD"
        )
        #expect(stream.url?.host == "download.example.com")
    }

    @Test("StreamInfo quality label includes debrid service")
    func qualityLabel() {
        let stream = StreamInfo(
            streamURL: "https://example.com/movie.mkv",
            quality: .uhd4k,
            codec: .h265,
            audio: .atmos,
            source: .webDL,
            sizeBytes: 15_000_000_000,
            fileName: "test.mkv",
            debridService: "RD"
        )
        let label = stream.qualityLabel
        #expect(label.contains("[RD]"))
        #expect(label.contains("4K"))
        #expect(label.contains("H.265"))
        #expect(label.contains("WEB-DL"))
    }

    @Test("StreamInfo size string")
    func sizeString() {
        let stream = StreamInfo(
            streamURL: "https://example.com/movie.mkv",
            quality: .hd1080p,
            codec: .h264,
            audio: .aac,
            source: .webDL,
            sizeBytes: 2_500_000_000,
            fileName: "test.mkv",
            debridService: "AD"
        )
        let size = stream.sizeString
        #expect(size.contains("GB") || size.contains("2"))
    }

    @Test("StreamInfo id is streamURL")
    func idIsURL() {
        let stream = StreamInfo(
            streamURL: "https://example.com/unique-path/movie.mkv",
            quality: .hd1080p,
            codec: .h264,
            audio: .aac,
            source: .webDL,
            sizeBytes: 0,
            fileName: "test.mkv",
            debridService: "PM"
        )
        #expect(stream.id == "https://example.com/unique-path/movie.mkv")
    }
}
