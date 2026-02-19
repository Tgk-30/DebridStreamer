import Testing
import Foundation
@testable import DebridStreamer

@Suite("IMDbCSVSyncService Tests")
struct IMDbCSVSyncServiceTests {
    @Test("Import is idempotent and skips duplicates")
    func importIdempotent() async throws {
        let db = try makeTestDatabase()
        let service = IMDbCSVSyncService()

        let csv = """
        Const,Title,Year
        tt1234567,Example Movie,2026
        tt1234567,Example Movie,2026
        """

        let first = try await service.importCSV(csv, listType: .watchlist, database: db)
        #expect(first.added == 1)
        #expect(first.skippedDuplicates == 1)

        let second = try await service.importCSV(csv, listType: .watchlist, database: db)
        #expect(second.added == 0)
        #expect(second.skippedDuplicates == 2)

        let watchlist = try await db.fetchLibrary(listType: .watchlist)
        #expect(watchlist.count == 1)
    }

    @Test("Export emits CSV with header and rows")
    func exportCSV() {
        let service = IMDbCSVSyncService()
        let output = service.exportCSV(mediaItems: [
            MediaItem(id: "tt123", type: .movie, title: "Movie A", year: 2024),
            MediaItem(id: "tt456", type: .movie, title: "Movie B", year: 2025),
        ])

        #expect(output.contains("Const,Title,Year"))
        #expect(output.contains("tt123,Movie A,2024"))
        #expect(output.contains("tt456,Movie B,2025"))
    }
}
