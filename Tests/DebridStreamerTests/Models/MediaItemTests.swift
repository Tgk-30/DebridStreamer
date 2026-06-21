import Testing
import Foundation
@testable import DebridStreamer

@Suite("MediaItem Tests")
struct MediaItemTests {
    @Test("MediaItem poster URL generation")
    func posterURL() {
        let item = MediaItem(
            id: "tt1234567",
            type: .movie,
            title: "Test Movie",
            posterPath: "/abc123.jpg"
        )
        #expect(item.posterURL?.absoluteString == "https://image.tmdb.org/t/p/w500/abc123.jpg")
        #expect(item.posterThumbnailURL?.absoluteString == "https://image.tmdb.org/t/p/w342/abc123.jpg")
    }

    @Test("MediaItem backdrop URL generation")
    func backdropURL() {
        let item = MediaItem(
            id: "tt1234567",
            type: .movie,
            title: "Test Movie",
            backdropPath: "/back123.jpg"
        )
        #expect(item.backdropURL?.absoluteString == "https://image.tmdb.org/t/p/w1280/back123.jpg")
    }

    @Test("MediaItem nil poster path returns nil URL")
    func nilPosterURL() {
        let item = MediaItem(id: "tt1234567", type: .movie, title: "Test")
        #expect(item.posterURL == nil)
        #expect(item.backdropURL == nil)
    }

    @Test("MediaItem year string")
    func yearString() {
        let item = MediaItem(id: "tt1234567", type: .movie, title: "Test", year: 2024)
        #expect(item.yearString == "2024")

        let noYear = MediaItem(id: "tt1234567", type: .movie, title: "Test")
        #expect(noYear.yearString == "")
    }

    @Test("MediaItem rating string")
    func ratingString() {
        let item = MediaItem(id: "tt1234567", type: .movie, title: "Test", imdbRating: 8.5)
        #expect(item.ratingString == "8.5")

        let noRating = MediaItem(id: "tt1234567", type: .movie, title: "Test")
        #expect(noRating.ratingString == "N/A")
    }

    @Test("MediaItem runtime string with hours")
    func runtimeStringHours() {
        let item = MediaItem(id: "tt1234567", type: .movie, title: "Test", runtime: 142)
        #expect(item.runtimeString == "2h 22m")
    }

    @Test("MediaItem runtime string minutes only")
    func runtimeStringMinutes() {
        let item = MediaItem(id: "tt1234567", type: .movie, title: "Test", runtime: 45)
        #expect(item.runtimeString == "45m")
    }

    @Test("MediaItem runtime string empty when nil")
    func runtimeStringNil() {
        let item = MediaItem(id: "tt1234567", type: .movie, title: "Test")
        #expect(item.runtimeString == "")
    }

    @Test("MediaItem runtime string empty when zero")
    func runtimeStringZero() {
        let item = MediaItem(id: "tt1234567", type: .movie, title: "Test", runtime: 0)
        #expect(item.runtimeString == "")
    }

    @Test("MediaItem equality")
    func equality() {
        let now = Date()
        let a = MediaItem(id: "tt1234567", type: .movie, title: "Movie A", lastFetched: now)
        let b = MediaItem(id: "tt1234567", type: .movie, title: "Movie A", lastFetched: now)
        let c = MediaItem(id: "tt7654321", type: .movie, title: "Movie C", lastFetched: now)
        #expect(a == b)
        #expect(a != c)
    }

    @Test("MediaItem identifiable")
    func identifiable() {
        let item = MediaItem(id: "tt1234567", type: .movie, title: "Test")
        #expect(item.id == "tt1234567")
    }
}

@Suite("MediaPreview Tests")
struct MediaPreviewTests {
    @Test("MediaPreview poster URL")
    func posterURL() {
        let preview = MediaPreview(
            id: "tmdb-123",
            type: .movie,
            title: "Test",
            posterPath: "/poster.jpg"
        )
        #expect(preview.posterURL?.absoluteString == "https://image.tmdb.org/t/p/w342/poster.jpg")
    }

    @Test("MediaPreview rating string")
    func ratingString() {
        let withRating = MediaPreview(id: "1", type: .movie, title: "A", imdbRating: 7.3)
        #expect(withRating.ratingString == "7.3")

        let noRating = MediaPreview(id: "2", type: .movie, title: "B")
        #expect(noRating.ratingString == "")
    }

    @Test("MediaPreview equality")
    func equality() {
        let a = MediaPreview(id: "1", type: .movie, title: "A")
        let b = MediaPreview(id: "1", type: .movie, title: "A")
        #expect(a == b)
    }
}
