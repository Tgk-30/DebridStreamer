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
        #expect(viewModel.folderTree.contains(where: { $0.folder.folderKind == .watched }))
        #expect(viewModel.folderTree.contains(where: { $0.folder.folderKind == .releaseWait }))
        #expect(viewModel.isLibraryRootSelected() == true)
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

    @Test("Library top-level folders appear as peers in the tree")
    func topLevelFoldersAsPeers() async throws {
        let db = try makeTestDatabase()
        let viewModel = LibraryViewModel(listType: .favorites)
        await viewModel.load(database: db)

        _ = try await db.createLibraryFolder(
            name: "Release Wait",
            listType: .favorites,
            parentId: viewModel.rootFolder?.id
        )
        _ = try await db.createLibraryFolder(
            name: "To Watch",
            listType: .favorites,
            parentId: viewModel.rootFolder?.id
        )

        await viewModel.refresh(database: db)
        let names = Set(viewModel.folderTree.map { $0.folder.name })
        #expect(viewModel.folderTree.count >= 4)
        #expect(names.contains("Release Wait"))
        #expect(names.contains("To Watch"))
    }

    @Test("Selecting library root acts as library home")
    func selectingRootAsLibraryHome() async throws {
        let db = try makeTestDatabase()
        let viewModel = LibraryViewModel(listType: .favorites)
        await viewModel.load(database: db)
        let root = try #require(viewModel.rootFolder)

        let folder = try await db.createLibraryFolder(
            name: "Sci-Fi",
            listType: .favorites,
            parentId: root.id
        )
        try await db.saveMedia(MediaItem(id: "tt-home-1", type: .movie, title: "Home Item", year: 2025))
        try await db.addToLibrary(UserLibraryEntry(
            id: "home-item",
            mediaId: "tt-home-1",
            folderId: folder.id,
            listType: .favorites
        ))

        await viewModel.selectFolder(root.id, database: db)
        #expect(viewModel.isLibraryRootSelected() == true)
        #expect(viewModel.items.contains(where: { $0.media.id == "tt-home-1" }))
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

    @Test("Missing poster artwork is enriched from metadata provider")
    func enrichesMissingArtworkFromMetadataProvider() async throws {
        let db = try makeTestDatabase()
        let viewModel = LibraryViewModel(listType: .favorites)
        await viewModel.load(database: db)
        let root = try #require(viewModel.rootFolder)

        try await db.saveMedia(
            MediaItem(
                id: "tt-art-1",
                type: .movie,
                title: "Posterless",
                year: 2024,
                posterPath: nil
            )
        )
        try await db.addToLibrary(
            UserLibraryEntry(
                id: "tt-art-1-\(root.id)",
                mediaId: "tt-art-1",
                folderId: root.id,
                listType: .favorites
            )
        )

        let provider = LibraryMetadataStub()
        await viewModel.load(database: db, metadataProvider: provider)

        let item = try #require(viewModel.items.first(where: { $0.media.id == "tt-art-1" }))
        #expect(item.media.posterPath == "/poster.jpg")
    }

    @Test("Artwork enrichment falls back to broad search when typed search has no poster")
    func enrichesArtworkWithBroadSearchFallback() async throws {
        let db = try makeTestDatabase()
        let viewModel = LibraryViewModel(listType: .favorites)
        await viewModel.load(database: db)
        let root = try #require(viewModel.rootFolder)

        try await db.saveMedia(
            MediaItem(
                id: "tt-art-2",
                type: .movie,
                title: "Needs Broad Search",
                year: 2023,
                posterPath: nil
            )
        )
        try await db.addToLibrary(
            UserLibraryEntry(
                id: "tt-art-2-\(root.id)",
                mediaId: "tt-art-2",
                folderId: root.id,
                listType: .favorites
            )
        )

        let provider = LibraryFallbackMetadataStub()
        await viewModel.load(database: db, metadataProvider: provider)

        let item = try #require(viewModel.items.first(where: { $0.media.id == "tt-art-2" }))
        #expect(item.media.posterPath == "/fallback.jpg")
        let calls = await provider.requestedTypes
        #expect(calls.contains(.movie))
        #expect(calls.contains(nil))
    }
}

private actor LibraryMetadataStub: MetadataProvider {
    func search(query: String, type: MediaType?, page: Int) async throws -> MetadataSearchResult {
        MetadataSearchResult(
            items: [
                MediaPreview(
                    id: "tmdb-123",
                    type: .movie,
                    title: "Posterless",
                    year: 2024,
                    posterPath: "/poster.jpg",
                    imdbRating: 7.4,
                    tmdbId: 123
                )
            ],
            page: 1,
            totalPages: 1,
            totalResults: 1
        )
    }

    func getDetail(id: String, type: MediaType) async throws -> MediaItem { throw TMDBError.notFound(id) }
    func getTrending(type: MediaType, timeWindow: TrendingWindow, page: Int) async throws -> MetadataSearchResult {
        MetadataSearchResult(items: [], page: 1, totalPages: 1, totalResults: 0)
    }
    func getCategory(_ category: MediaCategory, type: MediaType, page: Int) async throws -> MetadataSearchResult {
        MetadataSearchResult(items: [], page: 1, totalPages: 1, totalResults: 0)
    }
    func discover(type: MediaType, filters: DiscoverFilters) async throws -> MetadataSearchResult {
        MetadataSearchResult(items: [], page: 1, totalPages: 1, totalResults: 0)
    }
    func getGenres(type: MediaType) async throws -> [Genre] { [] }
    func getSeasons(tmdbId: Int) async throws -> [Season] { [] }
    func getEpisodes(tmdbId: Int, season: Int) async throws -> [Episode] { [] }
    func getExternalIds(tmdbId: Int, type: MediaType) async throws -> ExternalIds { ExternalIds(imdbId: nil, tvdbId: nil) }
    func getCast(tmdbId: Int, type: MediaType) async throws -> [CastMember] { [] }
    func getRecommendations(tmdbId: Int, type: MediaType) async throws -> [MediaPreview] { [] }
}

private actor LibraryFallbackMetadataStub: MetadataProvider {
    private(set) var requestedTypes: [MediaType?] = []

    func search(query: String, type: MediaType?, page: Int) async throws -> MetadataSearchResult {
        requestedTypes.append(type)
        if type == .movie {
            return MetadataSearchResult(
                items: [
                    MediaPreview(
                        id: "tmdb-typed",
                        type: .movie,
                        title: "Needs Broad Search",
                        year: 2023,
                        posterPath: nil,
                        imdbRating: 6.8,
                        tmdbId: 882
                    )
                ],
                page: 1,
                totalPages: 1,
                totalResults: 1
            )
        }

        return MetadataSearchResult(
            items: [
                MediaPreview(
                    id: "tmdb-broad",
                    type: .movie,
                    title: "Needs Broad Search",
                    year: 2023,
                    posterPath: "/fallback.jpg",
                    imdbRating: 7.0,
                    tmdbId: 883
                )
            ],
            page: 1,
            totalPages: 1,
            totalResults: 1
        )
    }

    func getDetail(id: String, type: MediaType) async throws -> MediaItem { throw TMDBError.notFound(id) }
    func getTrending(type: MediaType, timeWindow: TrendingWindow, page: Int) async throws -> MetadataSearchResult {
        MetadataSearchResult(items: [], page: 1, totalPages: 1, totalResults: 0)
    }
    func getCategory(_ category: MediaCategory, type: MediaType, page: Int) async throws -> MetadataSearchResult {
        MetadataSearchResult(items: [], page: 1, totalPages: 1, totalResults: 0)
    }
    func discover(type: MediaType, filters: DiscoverFilters) async throws -> MetadataSearchResult {
        MetadataSearchResult(items: [], page: 1, totalPages: 1, totalResults: 0)
    }
    func getGenres(type: MediaType) async throws -> [Genre] { [] }
    func getSeasons(tmdbId: Int) async throws -> [Season] { [] }
    func getEpisodes(tmdbId: Int, season: Int) async throws -> [Episode] { [] }
    func getExternalIds(tmdbId: Int, type: MediaType) async throws -> ExternalIds { ExternalIds(imdbId: nil, tvdbId: nil) }
    func getCast(tmdbId: Int, type: MediaType) async throws -> [CastMember] { [] }
    func getRecommendations(tmdbId: Int, type: MediaType) async throws -> [MediaPreview] { [] }
}
