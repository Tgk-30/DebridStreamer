import Testing
import Foundation
@testable import DebridStreamer

@Suite("SearchViewModel Tests")
@MainActor
struct SearchViewModelTests {
    @Test("performSearch sets results on success")
    func performSearchSuccess() async {
        let preview = MediaPreview(
            id: "tmdb-1",
            type: .movie,
            title: "A Movie",
            year: 2024,
            posterPath: nil,
            imdbRating: nil,
            tmdbId: 1
        )
        let provider = StubMetadataProvider(
            searchResponse: MetadataSearchResult(items: [preview], page: 1, totalPages: 1, totalResults: 1)
        )
        let model = SearchViewModel()

        await model.performSearch(query: "movie", type: .movie, provider: provider) { _ in
            Issue.record("Error callback should not be called for success")
        }

        #expect(model.results == [preview])
        #expect(model.isSearching == false)
        #expect(model.lastErrorMessage == nil)
    }

    @Test("performSearch reports errors")
    func performSearchFailure() async {
        enum SearchError: Error { case failed }
        let provider = StubMetadataProvider(searchError: SearchError.failed)
        let model = SearchViewModel()
        var capturedError: String?

        await model.performSearch(query: "movie", type: .movie, provider: provider) { message in
            capturedError = message
        }

        #expect(model.results.isEmpty)
        #expect(model.lastErrorMessage?.contains("Search failed") == true)
        #expect(capturedError?.contains("Search failed") == true)
    }

    @Test("scheduleDebouncedSearch ignores empty queries")
    func debounceIgnoresEmptyQuery() async throws {
        let model = SearchViewModel()
        model.results = [
            MediaPreview(
                id: "tmdb-2",
                type: .movie,
                title: "Existing",
                year: nil,
                posterPath: nil,
                imdbRating: nil,
                tmdbId: 2
            )
        ]

        model.scheduleDebouncedSearch(query: "   ", type: .movie, provider: nil) { _ in
            Issue.record("Error callback should not run for empty query")
        }
        try await Task.sleep(for: .milliseconds(20))
        #expect(model.results.isEmpty)
    }

    @Test("cancelSearch stops pending debounced work")
    func cancelSearchStopsPendingWork() async throws {
        let provider = StubMetadataProvider(
            searchResponse: MetadataSearchResult(
                items: [MediaPreview(id: "tmdb-9", type: .movie, title: "Delayed", year: nil, posterPath: nil, imdbRating: nil, tmdbId: 9)],
                page: 1,
                totalPages: 1,
                totalResults: 1
            )
        )
        let model = SearchViewModel()

        model.scheduleDebouncedSearch(
            query: "delayed",
            type: .movie,
            provider: provider,
            delay: .milliseconds(300)
        ) { _ in
            Issue.record("Error callback should not run")
        }

        model.cancelSearch()
        try await Task.sleep(for: .milliseconds(350))

        #expect(model.isSearching == false)
        #expect(model.results.isEmpty)
    }

    @Test("Folder scope filters to selected folder tree")
    func folderScopeFiltering() async throws {
        let db = try makeTestDatabase()
        let model = SearchViewModel()

        let root = try await db.fetchSystemLibraryFolderID(listType: .favorites)
        let folder = try await db.createLibraryFolder(
            name: "Sci-Fi",
            listType: .favorites,
            parentId: root
        )

        try await db.saveMedia(MediaItem(id: "tt100", type: .movie, title: "Movie In Folder", year: 2024))
        try await db.saveMedia(MediaItem(id: "tt101", type: .movie, title: "Movie Outside Folder", year: 2024))

        try await db.addToLibrary(UserLibraryEntry(
            id: "tt100-\(folder.id)",
            mediaId: "tt100",
            folderId: folder.id,
            listType: .favorites,
            addedAt: Date()
        ))
        try await db.addToLibrary(UserLibraryEntry(
            id: "tt101-\(root)",
            mediaId: "tt101",
            folderId: root,
            listType: .favorites,
            addedAt: Date()
        ))

        await model.performSearch(
            query: "Movie",
            type: nil,
            provider: nil,
            scope: .folder,
            folderId: folder.id,
            database: db
        ) { _ in
            Issue.record("Error callback should not run")
        }

        #expect(model.results.count == 1)
        #expect(model.results.first?.id == "tt100")
    }

    @Test("AI prompt helpers include context scope")
    func promptHelpers() {
        let model = SearchViewModel()
        let refine = model.buildRefinePrompt(query: "cyberpunk thriller", scope: .library)
        let mood = model.buildMoodPrompt(mood: "brooding", scope: .watchlist)
        let profile = model.buildProfileMatchPrompt(query: "slow-burn noir")

        #expect(refine.contains("Scope: Library"))
        #expect(mood.contains("watchlist"))
        #expect(profile.contains("slow-burn noir"))
    }

    @Test("Local scopes respect selected media type")
    func localScopeRespectsMediaType() async throws {
        let db = try makeTestDatabase()
        let model = SearchViewModel()
        let root = try await db.fetchSystemLibraryFolderID(listType: .favorites)

        try await db.saveMedia(MediaItem(id: "tt-movie", type: .movie, title: "Signal", year: 2023))
        try await db.saveMedia(MediaItem(id: "tt-series", type: .series, title: "Signal Files", year: 2024))
        try await db.addToLibrary(UserLibraryEntry(
            id: "entry-movie",
            mediaId: "tt-movie",
            folderId: root,
            listType: .favorites,
            addedAt: Date()
        ))
        try await db.addToLibrary(UserLibraryEntry(
            id: "entry-series",
            mediaId: "tt-series",
            folderId: root,
            listType: .favorites,
            addedAt: Date()
        ))

        await model.performSearch(
            query: "Signal",
            type: .movie,
            provider: nil,
            scope: .library,
            folderId: nil,
            database: db
        ) { _ in
            Issue.record("Error callback should not run")
        }

        #expect(model.results.count == 1)
        #expect(model.results.first?.id == "tt-movie")
    }

    @Test("Cancel stops manual in-flight search task")
    func cancelStopsManualSearchTask() async throws {
        let model = SearchViewModel()
        let provider = SlowSearchProvider(delay: .milliseconds(250))
        let expected = MediaPreview(
            id: "tmdb-delayed",
            type: .movie,
            title: "Delayed",
            year: 2026,
            posterPath: nil,
            imdbRating: nil,
            tmdbId: 999
        )
        await provider.setResponse(
            MetadataSearchResult(items: [expected], page: 1, totalPages: 1, totalResults: 1)
        )

        model.startSearch(
            query: "Delayed",
            type: .movie,
            provider: provider,
            scope: .all
        ) { _ in
            Issue.record("Error callback should not run")
        }

        try await Task.sleep(for: .milliseconds(60))
        model.cancelSearch()
        try await Task.sleep(for: .milliseconds(280))

        #expect(model.isSearching == false)
        #expect(model.results.isEmpty)
    }
}

private actor SlowSearchProvider: MetadataProvider {
    private let delay: Duration
    private var response = MetadataSearchResult(items: [], page: 1, totalPages: 1, totalResults: 0)

    init(delay: Duration) {
        self.delay = delay
    }

    func setResponse(_ response: MetadataSearchResult) {
        self.response = response
    }

    func search(query: String, type: MediaType?, page: Int) async throws -> MetadataSearchResult {
        try await Task.sleep(for: delay)
        return response
    }

    func getDetail(id: String, type: MediaType) async throws -> MediaItem {
        MediaItem(id: id, type: type, title: id)
    }

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
    func getExternalIds(tmdbId: Int, type: MediaType) async throws -> ExternalIds {
        ExternalIds(imdbId: nil, tvdbId: nil)
    }
    func getCast(tmdbId: Int, type: MediaType) async throws -> [CastMember] { [] }
    func getRecommendations(tmdbId: Int, type: MediaType) async throws -> [MediaPreview] { [] }
    func getPerson(personId: Int) async throws -> Person { Person(id: personId, name: "Stub") }
    func getPersonCredits(personId: Int) async throws -> [MediaPreview] { [] }
    func searchKeywords(query: String) async throws -> [TMDBKeyword] { [] }
}
