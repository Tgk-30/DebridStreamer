import Testing
import Foundation
@testable import DebridStreamer

@Suite("IMDbCSVSyncService Tests")
struct IMDbCSVSyncServiceTests {
    @Test("Import is idempotent per destination folder")
    func importIdempotent() async throws {
        let db = try makeTestDatabase()
        let service = IMDbCSVSyncService()
        let root = try await db.fetchSystemLibraryFolderID(listType: .favorites)
        let folderA = try await db.createLibraryFolder(name: "Import A", listType: .favorites, parentId: root)
        let folderB = try await db.createLibraryFolder(name: "Import B", listType: .favorites, parentId: root)

        let csv = """
        Const,Title,Year
        tt1234567,Example Movie,2026
        tt1234567,Example Movie,2026
        """

        let first = try await service.importCSV(csv, listType: .favorites, folderId: folderA.id, database: db)
        #expect(first.added == 1)
        #expect(first.skippedDuplicates == 1)

        let second = try await service.importCSV(csv, listType: .favorites, folderId: folderA.id, database: db)
        #expect(second.added == 0)
        #expect(second.skippedDuplicates == 2)

        let third = try await service.importCSV(csv, listType: .favorites, folderId: folderB.id, database: db)
        #expect(third.added == 1)

        let all = try await db.fetchLibrary(listType: .favorites)
        #expect(all.count == 2)
    }

    @Test("Watchlist imports are flattened to watchlist root")
    func watchlistImportUsesRoot() async throws {
        let db = try makeTestDatabase()
        let service = IMDbCSVSyncService()
        let watchlistRoot = try await db.fetchSystemLibraryFolderID(listType: .watchlist)

        let csv = """
        Const,Title,Year
        tt7777777,Watchlist Movie,2026
        """

        _ = try await service.importCSV(
            csv,
            listType: .watchlist,
            folderId: "non-existent-folder",
            database: db
        )

        let entries = try await db.fetchLibrary(listType: .watchlist)
        #expect(entries.count == 1)
        #expect(entries[0].folderId == watchlistRoot)
    }

    @Test("Export supports folder-scope trees")
    func exportFolderTreeCSV() async throws {
        let db = try makeTestDatabase()
        let service = IMDbCSVSyncService()
        let root = try await db.fetchSystemLibraryFolderID(listType: .favorites)
        let child = try await db.createLibraryFolder(name: "Imported", listType: .favorites, parentId: root)

        try await db.saveMedia(MediaItem(id: "tt200", type: .movie, title: "Folder Movie", year: 2025))
        try await db.addToLibrary(UserLibraryEntry(
            id: "tt200-\(child.id)",
            mediaId: "tt200",
            folderId: child.id,
            listType: .favorites,
            addedAt: Date()
        ))

        let csv = try await service.exportCSV(database: db, folderId: root, includeDescendants: true)
        #expect(csv.contains("Const,Title,Year"))
        #expect(csv.contains("tt200,Folder Movie,2025"))
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
