import Testing
import Foundation
@testable import DebridStreamer

@Suite("Episode Tests")
struct EpisodeTests {
    @Test("Display title with name")
    func displayTitleWithName() {
        let ep = Episode(
            id: "123-s1e5",
            mediaId: "tt1234567",
            seasonNumber: 1,
            episodeNumber: 5,
            title: "The One Where They Build an App"
        )
        #expect(ep.displayTitle == "S01E05 - The One Where They Build an App")
    }

    @Test("Display title without name")
    func displayTitleWithoutName() {
        let ep = Episode(
            id: "123-s2e10",
            mediaId: "tt1234567",
            seasonNumber: 2,
            episodeNumber: 10
        )
        #expect(ep.displayTitle == "S02E10")
    }

    @Test("Display title with empty name")
    func displayTitleEmptyName() {
        let ep = Episode(
            id: "123-s1e1",
            mediaId: "tt1234567",
            seasonNumber: 1,
            episodeNumber: 1,
            title: ""
        )
        #expect(ep.displayTitle == "S01E01")
    }

    @Test("Short label format")
    func shortLabel() {
        let ep = Episode(
            id: "123-s3e15",
            mediaId: "tt1234567",
            seasonNumber: 3,
            episodeNumber: 15
        )
        #expect(ep.shortLabel == "S03E15")
    }

    @Test("Still URL generation")
    func stillURL() {
        let ep = Episode(
            id: "1",
            mediaId: "tt1234567",
            seasonNumber: 1,
            episodeNumber: 1,
            stillPath: "/still123.jpg"
        )
        #expect(ep.stillURL?.absoluteString == "https://image.tmdb.org/t/p/w300/still123.jpg")
    }

    @Test("Still URL nil when no path")
    func stillURLNil() {
        let ep = Episode(
            id: "1",
            mediaId: "tt1234567",
            seasonNumber: 1,
            episodeNumber: 1
        )
        #expect(ep.stillURL == nil)
    }
}

@Suite("Season Tests")
struct SeasonTests {
    @Test("Season poster URL")
    func posterURL() {
        let season = Season(
            id: 1,
            seasonNumber: 1,
            name: "Season 1",
            posterPath: "/season1.jpg",
            episodeCount: 10
        )
        #expect(season.posterURL?.absoluteString == "https://image.tmdb.org/t/p/w342/season1.jpg")
    }

    @Test("Season poster URL nil when no path")
    func posterURLNil() {
        let season = Season(id: 1, seasonNumber: 0, name: "Specials", episodeCount: 3)
        #expect(season.posterURL == nil)
    }
}
