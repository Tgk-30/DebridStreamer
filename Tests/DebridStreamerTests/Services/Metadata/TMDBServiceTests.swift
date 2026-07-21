import Testing
import Foundation
@testable import DebridStreamer

@Suite("TMDBSearchResult Parsing Tests")
struct TMDBSearchResultTests {
    @Test("Parse movie search result")
    func parseMovie() {
        let result = TMDBSearchResult(
            id: 12345,
            title: "Test Movie",
            name: nil,
            mediaType: "movie",
            overview: "A test movie",
            posterPath: "/poster.jpg",
            backdropPath: "/backdrop.jpg",
            releaseDate: "2024-06-15",
            firstAirDate: nil,
            voteAverage: 8.5,
            genreIds: [28, 35]
        )

        let preview = result.toMediaPreview()
        #expect(preview != nil)
        #expect(preview?.title == "Test Movie")
        #expect(preview?.type == .movie)
        #expect(preview?.year == 2024)
        #expect(preview?.tmdbId == 12345)
        #expect(preview?.posterPath == "/poster.jpg")
        #expect(preview?.imdbRating == 8.5)
    }

    @Test("Parse TV search result")
    func parseTV() {
        let result = TMDBSearchResult(
            id: 67890,
            title: nil,
            name: "Test Show",
            mediaType: "tv",
            overview: "A test show",
            posterPath: "/show.jpg",
            backdropPath: nil,
            releaseDate: nil,
            firstAirDate: "2023-01-10",
            voteAverage: 9.0,
            genreIds: [18]
        )

        let preview = result.toMediaPreview()
        #expect(preview != nil)
        #expect(preview?.title == "Test Show")
        #expect(preview?.type == .series)
        #expect(preview?.year == 2023)
    }

    @Test("Parse multi search - person returns nil")
    func parsePersonReturnsNil() {
        let result = TMDBSearchResult(
            id: 11111,
            title: nil,
            name: "Actor Name",
            mediaType: "person",
            overview: nil,
            posterPath: nil,
            backdropPath: nil,
            releaseDate: nil,
            firstAirDate: nil,
            voteAverage: nil,
            genreIds: nil
        )

        let preview = result.toMediaPreview()
        #expect(preview == nil)
    }

    @Test("Parse result with no title returns nil")
    func noTitleReturnsNil() {
        let result = TMDBSearchResult(
            id: 22222,
            title: nil,
            name: nil,
            mediaType: "movie",
            overview: nil,
            posterPath: nil,
            backdropPath: nil,
            releaseDate: nil,
            firstAirDate: nil,
            voteAverage: nil,
            genreIds: nil
        )

        let preview = result.toMediaPreview()
        #expect(preview == nil)
    }

    @Test("Parse result with short date string")
    func shortDateString() {
        let result = TMDBSearchResult(
            id: 33333,
            title: "Movie",
            name: nil,
            mediaType: "movie",
            overview: nil,
            posterPath: nil,
            backdropPath: nil,
            releaseDate: "202", // Too short
            firstAirDate: nil,
            voteAverage: nil,
            genreIds: nil
        )

        let preview = result.toMediaPreview()
        #expect(preview?.year == nil)
    }

    @Test("Parse result without mediaType infers from title/name")
    func inferTypeFromFields() {
        let movieResult = TMDBSearchResult(
            id: 1, title: "Movie Title", name: nil, mediaType: nil,
            overview: nil, posterPath: nil, backdropPath: nil,
            releaseDate: "2024-01-01", firstAirDate: nil,
            voteAverage: nil, genreIds: nil
        )
        #expect(movieResult.toMediaPreview()?.type == .movie)

        let tvResult = TMDBSearchResult(
            id: 2, title: nil, name: "TV Show", mediaType: nil,
            overview: nil, posterPath: nil, backdropPath: nil,
            releaseDate: nil, firstAirDate: "2024-01-01",
            voteAverage: nil, genreIds: nil
        )
        #expect(tvResult.toMediaPreview()?.type == .series)
    }
}

@Suite("TMDBDetailResponse Parsing Tests")
struct TMDBDetailResponseTests {
    @Test("Parse movie detail with IMDB ID")
    func parseMovieDetailWithImdb() {
        let response = TMDBDetailResponse(
            id: 12345,
            title: "Test Movie",
            name: nil,
            overview: "Great movie",
            posterPath: "/poster.jpg",
            backdropPath: "/backdrop.jpg",
            releaseDate: "2024-06-15",
            firstAirDate: nil,
            voteAverage: 8.5,
            runtime: 142,
            episodeRunTime: nil,
            status: "Released",
            genres: [TMDBGenre(id: 28, name: "Action"), TMDBGenre(id: 35, name: "Comedy")],
            externalIds: ExternalIds(imdbId: "tt1234567", tvdbId: nil)
        )

        let item = response.toMediaItem(type: .movie)
        #expect(item.id == "tt1234567") // Uses IMDB ID
        #expect(item.title == "Test Movie")
        #expect(item.year == 2024)
        #expect(item.runtime == 142)
        #expect(item.genres == ["Action", "Comedy"])
        #expect(item.imdbRating == 8.5)
        #expect(item.tmdbId == 12345)
    }

    @Test("Parse movie detail without IMDB ID falls back to TMDB ID")
    func parseMovieDetailWithoutImdb() {
        let response = TMDBDetailResponse(
            id: 99999,
            title: "New Movie",
            name: nil,
            overview: nil,
            posterPath: nil,
            backdropPath: nil,
            releaseDate: nil,
            firstAirDate: nil,
            voteAverage: nil,
            runtime: nil,
            episodeRunTime: nil,
            status: nil,
            genres: nil,
            externalIds: nil
        )

        let item = response.toMediaItem(type: .movie)
        #expect(item.id == "tmdb-99999")
    }

    @Test("Parse TV detail uses episode runtime")
    func parseTVDetailEpisodeRuntime() {
        let response = TMDBDetailResponse(
            id: 54321,
            title: nil,
            name: "Test Show",
            overview: "Good show",
            posterPath: nil,
            backdropPath: nil,
            releaseDate: nil,
            firstAirDate: "2023-03-20",
            voteAverage: 9.1,
            runtime: nil,
            episodeRunTime: [45],
            status: "Returning Series",
            genres: [TMDBGenre(id: 18, name: "Drama")],
            externalIds: ExternalIds(imdbId: "tt7654321", tvdbId: nil)
        )

        let item = response.toMediaItem(type: .series)
        #expect(item.title == "Test Show")
        #expect(item.runtime == 45) // Uses episodeRunTime
        #expect(item.year == 2023)
        #expect(item.status == "Returning Series")
    }

    @Test("Parse detail with zero runtime returns nil runtime")
    func zeroRuntimeReturnsNil() {
        let response = TMDBDetailResponse(
            id: 1, title: "Movie", name: nil, overview: nil,
            posterPath: nil, backdropPath: nil, releaseDate: nil,
            firstAirDate: nil, voteAverage: nil, runtime: 0,
            episodeRunTime: nil, status: nil, genres: nil,
            externalIds: nil
        )

        let item = response.toMediaItem(type: .movie)
        #expect(item.runtime == nil)
    }

    @Test("Decode series renewal metadata fields")
    func decodeSeriesRenewalMetadataFields() throws {
        let json = """
        {
          "status": "Returning Series",
          "in_production": true,
          "next_episode_to_air": { "air_date": "2026-11-14" },
          "last_air_date": "2025-11-14",
          "number_of_seasons": 4
        }
        """.data(using: .utf8)!

        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        let response = try decoder.decode(TMDBSeriesRenewalResponse.self, from: json)
        #expect(response.status == "Returning Series")
        #expect(response.inProduction == true)
        #expect(response.nextEpisodeToAir?.airDate == "2026-11-14")
        #expect(response.lastAirDate == "2025-11-14")
        #expect(response.numberOfSeasons == 4)
    }
}

@Suite("TMDBError Tests")
struct TMDBErrorTests {
    @Test("Error descriptions are descriptive")
    func errorDescriptions() {
        #expect(TMDBError.invalidURL("/test").errorDescription?.contains("/test") == true)
        #expect(TMDBError.invalidResponse.errorDescription?.contains("Invalid") == true)
        #expect(TMDBError.unauthorized.errorDescription?.contains("API key") == true)
        #expect(TMDBError.notFound("tt123").errorDescription?.contains("tt123") == true)
        #expect(TMDBError.rateLimited.errorDescription?.contains("rate limit") == true)
        #expect(TMDBError.httpError(500, "error").errorDescription?.contains("500") == true)
    }

    @Test("Error equality")
    func errorEquality() {
        #expect(TMDBError.unauthorized == TMDBError.unauthorized)
        #expect(TMDBError.httpError(404, "not found") == TMDBError.httpError(404, "not found"))
        #expect(TMDBError.httpError(404, "not found") != TMDBError.httpError(500, "server error"))
    }
}

@Suite("MetadataProvider Types Tests")
struct MetadataProviderTypesTests {
    @Test("DiscoverFilters defaults")
    func discoverFilterDefaults() {
        let filters = DiscoverFilters()
        #expect(filters.genreId == nil)
        #expect(filters.year == nil)
        #expect(filters.minRating == nil)
        #expect(filters.sortBy == .popularityDesc)
        #expect(filters.page == 1)
    }

    @Test("SortOption display names")
    func sortOptionDisplayNames() {
        #expect(DiscoverFilters.SortOption.popularityDesc.displayName == "Most Popular")
        #expect(DiscoverFilters.SortOption.ratingDesc.displayName == "Highest Rated")
        #expect(DiscoverFilters.SortOption.releaseDateDesc.displayName == "Newest")
    }

    @Test("MediaCategory display names")
    func categoryDisplayNames() {
        #expect(MediaCategory.popular.displayName == "Popular")
        #expect(MediaCategory.topRated.displayName == "Top Rated")
        #expect(MediaCategory.nowPlaying.displayName == "Now Playing")
        #expect(MediaCategory.upcoming.displayName == "Upcoming")
        #expect(MediaCategory.airingToday.displayName == "Airing Today")
        #expect(MediaCategory.onTheAir.displayName == "On The Air")
    }

    @Test("Categories for movie vs series")
    func categoriesForType() {
        let movieCats = MediaCategory.categories(for: .movie)
        #expect(movieCats.contains(.nowPlaying))
        #expect(movieCats.contains(.upcoming))
        #expect(!movieCats.contains(.airingToday))

        let tvCats = MediaCategory.categories(for: .series)
        #expect(tvCats.contains(.airingToday))
        #expect(tvCats.contains(.onTheAir))
        #expect(!tvCats.contains(.nowPlaying))
    }

    @Test("Genre model")
    func genreModel() {
        let genre = Genre(id: 28, name: "Action")
        #expect(genre.id == 28)
        #expect(genre.name == "Action")
    }

    @Test("ExternalIds decoding")
    func externalIdsCodable() throws {
        let json = """
        {"imdb_id": "tt1234567", "tvdb_id": 54321}
        """.data(using: .utf8)!

        let ids = try JSONDecoder().decode(ExternalIds.self, from: json)
        #expect(ids.imdbId == "tt1234567")
        #expect(ids.tvdbId == 54321)
    }

    @Test("ExternalIds decoding supports camelCase keys")
    func externalIdsCodableFromCamelCase() throws {
        let json = """
        {"imdbId": "tt7654321", "tvdbId": 98765}
        """.data(using: .utf8)!

        let ids = try JSONDecoder().decode(ExternalIds.self, from: json)
        #expect(ids.imdbId == "tt7654321")
        #expect(ids.tvdbId == 98765)
    }

    @Test("ExternalIds encodes snake_case keys")
    func externalIdsEncodesSnakeCaseKeys() throws {
        let ids = ExternalIds(imdbId: "tt24680", tvdbId: 11111)
        let data = try JSONEncoder().encode(ids)
        let payload = try JSONSerialization.jsonObject(with: data) as? [String: Any]

        #expect(payload?["imdb_id"] as? String == "tt24680")
        #expect(payload?["tvdb_id"] as? Int == 11111)
        #expect(payload?["imdbId"] == nil)
        #expect(payload?["tvdbId"] == nil)
    }

    @Test("ExternalIds omits nil values when encoding")
    func externalIdsOmitsNilValuesWhenEncoding() throws {
        let ids = ExternalIds(imdbId: nil, tvdbId: nil)
        let data = try JSONEncoder().encode(ids)
        let payload = try JSONSerialization.jsonObject(with: data) as? [String: Any]

        #expect(payload?["imdb_id"] == nil)
        #expect(payload?["tvdb_id"] == nil)
    }
}

@Suite("Array Chunking Tests")
struct ArrayChunkingTests {
    @Test("Chunk array into equal parts")
    func equalChunks() {
        let array = [1, 2, 3, 4, 5, 6]
        let chunks = array.chunked(into: 3)
        #expect(chunks.count == 2)
        #expect(chunks[0] == [1, 2, 3])
        #expect(chunks[1] == [4, 5, 6])
    }

    @Test("Chunk array with remainder")
    func chunkWithRemainder() {
        let array = [1, 2, 3, 4, 5]
        let chunks = array.chunked(into: 2)
        #expect(chunks.count == 3)
        #expect(chunks[0] == [1, 2])
        #expect(chunks[1] == [3, 4])
        #expect(chunks[2] == [5])
    }

    @Test("Chunk empty array")
    func chunkEmpty() {
        let array: [Int] = []
        let chunks = array.chunked(into: 5)
        #expect(chunks.isEmpty)
    }

    @Test("Chunk size larger than array")
    func chunkLargerThanArray() {
        let array = [1, 2, 3]
        let chunks = array.chunked(into: 10)
        #expect(chunks.count == 1)
        #expect(chunks[0] == [1, 2, 3])
    }
}
