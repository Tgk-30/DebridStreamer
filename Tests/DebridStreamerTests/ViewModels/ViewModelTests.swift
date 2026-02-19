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
}

@Suite("DiscoverViewModel Tests")
@MainActor
struct DiscoverViewModelTests {
    @Test("loadContent populates sections")
    func loadContentSuccess() async {
        let movie = MediaPreview(
            id: "tmdb-10",
            type: .movie,
            title: "Movie",
            year: 2024,
            posterPath: nil,
            imdbRating: nil,
            tmdbId: 10
        )
        let show = MediaPreview(
            id: "tmdb-20",
            type: .series,
            title: "Show",
            year: 2025,
            posterPath: nil,
            imdbRating: nil,
            tmdbId: 20
        )
        let provider = StubMetadataProvider(
            trendingMovieResponse: MetadataSearchResult(items: [movie], page: 1, totalPages: 1, totalResults: 1),
            trendingSeriesResponse: MetadataSearchResult(items: [show], page: 1, totalPages: 1, totalResults: 1),
            categoryResponses: [
                .popular: MetadataSearchResult(items: [movie], page: 1, totalPages: 1, totalResults: 1),
                .topRated: MetadataSearchResult(items: [movie], page: 1, totalPages: 1, totalResults: 1)
            ]
        )
        let model = DiscoverViewModel()

        await model.loadContent(provider: provider) { _ in
            Issue.record("Error callback should not run for success")
        }

        #expect(model.trendingMovies == [movie])
        #expect(model.trendingShows == [show])
        #expect(model.popularMovies == [movie])
        #expect(model.topRatedMovies == [movie])
        #expect(model.lastErrorMessage == nil)
        #expect(model.isLoading == false)
    }

    @Test("loadContent reports partial failures")
    func loadContentPartialFailure() async {
        enum DiscoverError: Error { case failed }
        let provider = StubMetadataProvider(
            trendingMovieError: DiscoverError.failed,
            categoryErrors: [.popular: DiscoverError.failed]
        )
        let model = DiscoverViewModel()
        var capturedError: String?

        await model.loadContent(provider: provider) { message in
            capturedError = message
        }

        #expect(model.trendingMovies.isEmpty)
        #expect(model.popularMovies.isEmpty)
        #expect(model.lastErrorMessage?.contains("failed") == true)
        #expect(capturedError?.contains("failed") == true)
    }
}
