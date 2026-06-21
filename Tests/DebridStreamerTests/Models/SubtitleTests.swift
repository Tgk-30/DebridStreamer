import Testing
import Foundation
@testable import DebridStreamer

@Suite("Subtitle Tests")
struct SubtitleTests {
    @Test("Subtitle format parsing from filename")
    func formatParsing() {
        #expect(Subtitle.SubtitleFormat.parse(from: "movie.srt") == .srt)
        #expect(Subtitle.SubtitleFormat.parse(from: "movie.vtt") == .vtt)
        #expect(Subtitle.SubtitleFormat.parse(from: "movie.webvtt") == .vtt)
        #expect(Subtitle.SubtitleFormat.parse(from: "movie.ass") == .ass)
        #expect(Subtitle.SubtitleFormat.parse(from: "movie.ssa") == .ssa)
        #expect(Subtitle.SubtitleFormat.parse(from: "movie.xyz") == .unknown)
        #expect(Subtitle.SubtitleFormat.parse(from: "noextension") == .unknown)
    }

    @Test("Subtitle download URL")
    func downloadURL() {
        let sub = Subtitle(
            id: "sub-1",
            language: "en",
            languageName: "English",
            url: "https://subs.example.com/movie.srt",
            format: .srt,
            source: "OpenSubtitles"
        )
        #expect(sub.downloadURL?.absoluteString == "https://subs.example.com/movie.srt")
    }

    @Test("Subtitle equality")
    func equality() {
        let a = Subtitle(id: "1", language: "en", languageName: "English", url: "https://a.com/1.srt", format: .srt, source: "test")
        let b = Subtitle(id: "1", language: "en", languageName: "English", url: "https://a.com/1.srt", format: .srt, source: "test")
        #expect(a == b)
    }
}
