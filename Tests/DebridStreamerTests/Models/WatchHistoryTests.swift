import Testing
import Foundation
@testable import DebridStreamer

@Suite("WatchHistory Tests")
struct WatchHistoryTests {
    @Test("Progress percent calculation")
    func progressPercent() {
        let entry = WatchHistory(
            id: "1",
            mediaId: "tt1234567",
            progressSeconds: 3600,
            durationSeconds: 7200,
            completed: false,
            lastWatched: Date()
        )
        #expect(entry.progressPercent == 0.5)
    }

    @Test("Progress percent with nil duration")
    func progressPercentNilDuration() {
        let entry = WatchHistory(
            id: "1",
            mediaId: "tt1234567",
            progressSeconds: 3600,
            durationSeconds: nil,
            completed: false,
            lastWatched: Date()
        )
        #expect(entry.progressPercent == 0.0)
    }

    @Test("Progress percent with zero duration")
    func progressPercentZeroDuration() {
        let entry = WatchHistory(
            id: "1",
            mediaId: "tt1234567",
            progressSeconds: 100,
            durationSeconds: 0,
            completed: false,
            lastWatched: Date()
        )
        #expect(entry.progressPercent == 0.0)
    }

    @Test("Progress percent capped at 1.0")
    func progressPercentCapped() {
        let entry = WatchHistory(
            id: "1",
            mediaId: "tt1234567",
            progressSeconds: 8000,
            durationSeconds: 7200,
            completed: false,
            lastWatched: Date()
        )
        #expect(entry.progressPercent == 1.0)
    }

    @Test("Progress string formatting with hours")
    func progressStringHours() {
        let entry = WatchHistory(
            id: "1",
            mediaId: "tt1234567",
            progressSeconds: 3723, // 1h 2m 3s
            durationSeconds: 7200,  // 2h 0m 0s
            completed: false,
            lastWatched: Date()
        )
        #expect(entry.progressString == "1:02:03 / 2:00:00")
    }

    @Test("Progress string formatting without hours")
    func progressStringMinutes() {
        let entry = WatchHistory(
            id: "1",
            mediaId: "tt1234567",
            progressSeconds: 123, // 2m 3s
            durationSeconds: 600,
            completed: false,
            lastWatched: Date()
        )
        #expect(entry.progressString == "2:03 / 10:00")
    }

    @Test("Progress string without duration")
    func progressStringNoDuration() {
        let entry = WatchHistory(
            id: "1",
            mediaId: "tt1234567",
            progressSeconds: 3600,
            completed: false,
            lastWatched: Date()
        )
        #expect(entry.progressString == "1:00:00")
    }

    @Test("Has resume point - meaningful progress")
    func hasResumePoint() {
        let entry = WatchHistory(
            id: "1",
            mediaId: "tt1234567",
            progressSeconds: 600,
            durationSeconds: 7200,
            completed: false,
            lastWatched: Date()
        )
        #expect(entry.hasResumePoint == true)
    }

    @Test("Has resume point - too early")
    func hasResumePointTooEarly() {
        let entry = WatchHistory(
            id: "1",
            mediaId: "tt1234567",
            progressSeconds: 10,
            durationSeconds: 7200,
            completed: false,
            lastWatched: Date()
        )
        #expect(entry.hasResumePoint == false) // < 2%
    }

    @Test("Has resume point - nearly done")
    func hasResumePointNearlyDone() {
        let entry = WatchHistory(
            id: "1",
            mediaId: "tt1234567",
            progressSeconds: 7000,
            durationSeconds: 7200,
            completed: false,
            lastWatched: Date()
        )
        #expect(entry.hasResumePoint == false) // > 95%
    }
}

@Suite("UserLibraryEntry Tests")
struct UserLibraryEntryTests {
    @Test("ListType cases")
    func listTypes() {
        #expect(UserLibraryEntry.ListType.allCases.count == 3)
        #expect(UserLibraryEntry.ListType.watchlist.rawValue == "watchlist")
        #expect(UserLibraryEntry.ListType.favorites.rawValue == "favorites")
        #expect(UserLibraryEntry.ListType.custom.rawValue == "custom")
    }
}
