import Foundation
@testable import DebridStreamer

struct StubMetadataProvider: MetadataProvider {
    var searchResponse: MetadataSearchResult = MetadataSearchResult(items: [], page: 1, totalPages: 1, totalResults: 0)
    var searchError: Error?

    var trendingMovieResponse: MetadataSearchResult = MetadataSearchResult(items: [], page: 1, totalPages: 1, totalResults: 0)
    var trendingSeriesResponse: MetadataSearchResult = MetadataSearchResult(items: [], page: 1, totalPages: 1, totalResults: 0)
    var trendingMovieError: Error?
    var trendingSeriesError: Error?

    var categoryResponses: [MediaCategory: MetadataSearchResult] = [:]
    var categoryErrors: [MediaCategory: Error] = [:]

    func search(query: String, type: MediaType?, page: Int) async throws -> MetadataSearchResult {
        if let searchError {
            throw searchError
        }
        return searchResponse
    }

    func getDetail(id: String, type: MediaType) async throws -> MediaItem {
        MediaItem(id: id, type: type, title: "Detail")
    }

    func getTrending(type: MediaType, timeWindow: TrendingWindow, page: Int) async throws -> MetadataSearchResult {
        switch type {
        case .movie:
            if let trendingMovieError {
                throw trendingMovieError
            }
            return trendingMovieResponse
        case .series:
            if let trendingSeriesError {
                throw trendingSeriesError
            }
            return trendingSeriesResponse
        }
    }

    func getCategory(_ category: MediaCategory, type: MediaType, page: Int) async throws -> MetadataSearchResult {
        if let error = categoryErrors[category] {
            throw error
        }
        return categoryResponses[category] ?? MetadataSearchResult(items: [], page: 1, totalPages: 1, totalResults: 0)
    }

    func discover(type: MediaType, filters: DiscoverFilters) async throws -> MetadataSearchResult {
        MetadataSearchResult(items: [], page: 1, totalPages: 1, totalResults: 0)
    }

    func getGenres(type: MediaType) async throws -> [Genre] {
        []
    }

    func getSeasons(tmdbId: Int) async throws -> [Season] {
        []
    }

    func getEpisodes(tmdbId: Int, season: Int) async throws -> [Episode] {
        []
    }

    func getExternalIds(tmdbId: Int, type: MediaType) async throws -> ExternalIds {
        ExternalIds(imdbId: nil, tvdbId: nil)
    }

    var castResponse: [CastMember] = []
    var recommendationsResponse: [MediaPreview] = []

    func getCast(tmdbId: Int, type: MediaType) async throws -> [CastMember] {
        castResponse
    }

    func getRecommendations(tmdbId: Int, type: MediaType) async throws -> [MediaPreview] {
        recommendationsResponse
    }

    var personResponse: Person = Person(id: 0, name: "Stub Person")
    var personCreditsResponse: [MediaPreview] = []
    var keywordsResponse: [TMDBKeyword] = []

    func getPerson(personId: Int) async throws -> Person {
        personResponse
    }

    func getPersonCredits(personId: Int) async throws -> [MediaPreview] {
        personCreditsResponse
    }

    func searchKeywords(query: String) async throws -> [TMDBKeyword] {
        keywordsResponse
    }
}
