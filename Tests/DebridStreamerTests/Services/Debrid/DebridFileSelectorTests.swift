import Testing
@testable import DebridStreamer

@Suite("DebridFileSelector Tests")
struct DebridFileSelectorTests {
    @Test("Returns nil for empty input")
    func emptyInput() {
        let selected = DebridFileSelector.selectBest(from: [])
        #expect(selected == nil)
    }

    @Test("Prefers video files over non-video files")
    func prefersVideoFiles() {
        let candidates = [
            DebridFileCandidate(link: "a", fileName: "movie.nfo", sizeBytes: 100_000),
            DebridFileCandidate(link: "b", fileName: "movie.mkv", sizeBytes: 50_000)
        ]

        let selected = DebridFileSelector.selectBest(from: candidates)
        #expect(selected?.link == "b")
    }

    @Test("Prefers non-sample files when both are video")
    func avoidsSamples() {
        let candidates = [
            DebridFileCandidate(link: "sample", fileName: "Movie.2026.sample.mkv", sizeBytes: 5_000_000_000),
            DebridFileCandidate(link: "main", fileName: "Movie.2026.1080p.mkv", sizeBytes: 2_000_000_000)
        ]

        let selected = DebridFileSelector.selectBest(from: candidates)
        #expect(selected?.link == "main")
    }

    @Test("Prefers larger size when both are valid video files")
    func prefersLargerVideo() {
        let candidates = [
            DebridFileCandidate(link: "small", fileName: "Movie.720p.mp4", sizeBytes: 1_000_000_000),
            DebridFileCandidate(link: "large", fileName: "Movie.1080p.mp4", sizeBytes: 2_000_000_000)
        ]

        let selected = DebridFileSelector.selectBest(from: candidates)
        #expect(selected?.link == "large")
    }

    @Test("Prefers player-compatible container over larger less-compatible file")
    func prefersCompatibleContainer() {
        let candidates = [
            DebridFileCandidate(link: "mkv", fileName: "Movie.2026.2160p.mkv", sizeBytes: 7_000_000_000),
            DebridFileCandidate(link: "mp4", fileName: "Movie.2026.1080p.mp4", sizeBytes: 3_000_000_000)
        ]

        let selected = DebridFileSelector.selectBest(from: candidates)
        #expect(selected?.link == "mp4")
    }

    @Test("Prefers H264 over AV1 when both have video containers")
    func prefersH264CodecHint() {
        let candidates = [
            DebridFileCandidate(link: "av1", fileName: "Movie.2026.1080p.AV1.mkv", sizeBytes: 2_000_000_000),
            DebridFileCandidate(link: "h264", fileName: "Movie.2026.1080p.x264.mkv", sizeBytes: 2_000_000_000)
        ]

        let selected = DebridFileSelector.selectBest(from: candidates)
        #expect(selected?.link == "h264")
    }

    @Test("Falls back to link filename when response filename is unknown")
    func fallsBackToLinkName() {
        let candidates = [
            DebridFileCandidate(link: "https://cdn.example.com/file-01.nfo", fileName: "Unknown", sizeBytes: 100),
            DebridFileCandidate(link: "https://cdn.example.com/file-02.mp4", fileName: "Unknown", sizeBytes: 100)
        ]

        let selected = DebridFileSelector.selectBest(from: candidates)
        #expect(selected?.link == "https://cdn.example.com/file-02.mp4")
    }
}
