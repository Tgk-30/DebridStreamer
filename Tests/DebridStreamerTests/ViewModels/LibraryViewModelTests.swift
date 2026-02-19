import Testing
import Foundation
@testable import DebridStreamer

@Suite("LibraryViewModel Tests")
@MainActor
struct LibraryViewModelTests {
    @Test("Loads system root and folder tree")
    func loadsFolderTree() async throws {
        let db = try makeTestDatabase()
        let viewModel = LibraryViewModel(listType: .favorites)

        await viewModel.load(database: db)

        #expect(viewModel.rootFolder != nil)
        #expect(viewModel.selectedFolderId == viewModel.rootFolder?.id)
        #expect(viewModel.folderTree.isEmpty == false)
    }

    @Test("Create folder selects new folder")
    func createFolderSelectsFolder() async throws {
        let db = try makeTestDatabase()
        let viewModel = LibraryViewModel(listType: .favorites)
        await viewModel.load(database: db)

        await viewModel.createFolder(name: "Sci-Fi", parentId: viewModel.rootFolder?.id, database: db)

        let created = try await db.fetchAllLibraryFolders(listType: .favorites)
            .first(where: { $0.name == "Sci-Fi" })
        #expect(created != nil)
        #expect(viewModel.selectedFolderId == created?.id)
    }

    @Test("Watchlist is flat and folder create is blocked")
    func watchlistFlatMode() async throws {
        let db = try makeTestDatabase()
        let viewModel = LibraryViewModel(listType: .watchlist)
        await viewModel.load(database: db)

        #expect(viewModel.supportsFolders == false)
        await viewModel.createFolder(name: "ShouldNotCreate", parentId: viewModel.rootFolder?.id, database: db)
        #expect(viewModel.statusMessage?.contains("does not support folders") == true)

        let folders = try await db.fetchAllLibraryFolders(listType: .watchlist)
        #expect(folders.count == 1)
        #expect(folders.first?.isSystem == true)
    }

    @Test("Folder-scoped items are loaded and removable")
    func folderItemsAndRemoval() async throws {
        let db = try makeTestDatabase()
        let viewModel = LibraryViewModel(listType: .favorites)
        await viewModel.load(database: db)

        let folder = try await db.createLibraryFolder(
            name: "Imported",
            listType: .favorites,
            parentId: viewModel.rootFolder?.id
        )

        try await db.saveMedia(MediaItem(id: "tt301", type: .movie, title: "Imported Title", year: 2026))
        try await db.addToLibrary(UserLibraryEntry(
            id: "tt301-\(folder.id)",
            mediaId: "tt301",
            folderId: folder.id,
            listType: .favorites,
            addedAt: Date()
        ))

        await viewModel.selectFolder(folder.id, database: db)
        #expect(viewModel.items.count == 1)

        if let first = viewModel.items.first {
            await viewModel.remove(first, database: db)
        }
        #expect(viewModel.items.isEmpty)
    }

    @Test("Load honors preferred folder selection when valid")
    func loadUsesPreferredFolderId() async throws {
        let db = try makeTestDatabase()
        let viewModel = LibraryViewModel(listType: .favorites)

        await viewModel.load(database: db)
        let folder = try await db.createLibraryFolder(
            name: "Preferred",
            listType: .favorites,
            parentId: viewModel.rootFolder?.id
        )

        await viewModel.load(database: db, preferredFolderId: folder.id)

        #expect(viewModel.selectedFolderId == folder.id)
    }
}
