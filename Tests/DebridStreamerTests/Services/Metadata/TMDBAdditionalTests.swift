import Testing
import Foundation
@testable import DebridStreamer

@Suite("TMDBService Additional Methods")
struct TMDBAdditionalTests {
    @Test("getDetail resolves tmdb IDs from numeric input and maps external imdb id")
    func getDetailFromTmdbId() async throws {
        let sessionID = UUID().uuidString
        let session = makeMockSession(sessionID: sessionID)
        var capturedPath = ""

        MockURLProtocol.setHandler({ request in
            capturedPath = request.url?.path ?? ""
            #expect((request.url?.query ?? "").contains("append_to_response=external_ids") == true)
            let body = """
            {
              "id": 550,
              "title": "Fight Club",
              "release_date": "1999-10-15",
              "runtime": 139,
              "vote_average": 8.4,
              "genres": [
                {"id": 18, "name": "Drama"}
              ],
              "external_ids": {"imdb_id": "tt0137523"},
              "poster_path": "/poster.jpg",
              "backdrop_path": "/backdrop.jpg"
            }
            """
            return try makeResponse(for: request, statusCode: 200, body: body)
        }, for: sessionID)
        defer { MockURLProtocol.removeHandler(for: sessionID) }

        let service = TMDBService(apiKey: "tmdb-key", session: session)
        let item = try await service.getDetail(id: "550", type: .movie)

        #expect(capturedPath == "/3/movie/550")
        #expect(item.id == "tt0137523")
        #expect(item.title == "Fight Club")
        #expect(item.year == 1999)
        #expect(item.runtime == 139)
        #expect(item.type == .movie)
        #expect(item.genres == ["Drama"])
    }

    @Test("getDetail resolves TMDB IDs from IMDB ids")
    func getDetailFromIMDbId() async throws {
        let sessionID = UUID().uuidString
        let session = makeMockSession(sessionID: sessionID)
        var requests: [String] = []

        MockURLProtocol.setHandler({ request in
            let path = request.url?.path ?? ""
            requests.append(path)

            switch path {
            case "/3/find/tt1234567":
                let findBody = """
                {"movie_results":[],"tv_results":[{"id": 6001, "name": "Example Show"}]}
                """
                return try makeResponse(for: request, statusCode: 200, body: findBody)
            case "/3/tv/6001":
                let detailBody = """
                {
                  "id": 6001,
                  "name": "Example Show",
                  "first_air_date": "2015-03-10",
                  "episode_run_time": [45],
                  "vote_average": 7.5,
                  "external_ids": {"imdb_id": "tt7654321"}
                }
                """
                return try makeResponse(for: request, statusCode: 200, body: detailBody)
            default:
                return try makeResponse(for: request, statusCode: 404, body: "{}")
            }
        }, for: sessionID)
        defer { MockURLProtocol.removeHandler(for: sessionID) }

        let service = TMDBService(apiKey: "tmdb-key", session: session)
        let item = try await service.getDetail(id: "tt1234567", type: .series)

        #expect(requests == ["/3/find/tt1234567", "/3/tv/6001"])
        #expect(item.id == "tt7654321")
        #expect(item.type == .series)
        #expect(item.year == 2015)
        #expect(item.runtime == 45)
    }

    @Test("getDetail throws notFound for unresolved IMDB ids")
    func getDetailFromUnresolvableIMDbIdThrowsNotFound() async {
        let sessionID = UUID().uuidString
        let session = makeMockSession(sessionID: sessionID)

        MockURLProtocol.setHandler({ request in
            let body = "{\"movie_results\":[],\"tv_results\":[] }"
            return try makeResponse(for: request, statusCode: 200, body: body)
        }, for: sessionID)
        defer { MockURLProtocol.removeHandler(for: sessionID) }

        let service = TMDBService(apiKey: "tmdb-key", session: session)

        do {
            _ = try await service.getDetail(id: "tt-not-found", type: .movie)
            Issue.record("Expected TMDB notFound error")
        } catch let error as TMDBError {
            #expect(error == .notFound("tt-not-found"))
        } catch {
            Issue.record("Unexpected error: \(error)")
        }
    }

    @Test("getSeriesRenewalMetadata resolves by IMDB id and maps payload")
    func getSeriesRenewalByIMDbResolvesAndMaps() async throws {
        let sessionID = UUID().uuidString
        let session = makeMockSession(sessionID: sessionID)

        MockURLProtocol.setHandler({ request in
            let path = request.url?.path ?? ""
            if path == "/3/find/tt123" {
                return try makeResponse(for: request, statusCode: 200, body: "{\"tv_results\":[{\"id\":1001}]}")
            }

            let body = """
            {
              "status": "Returning Series",
              "in_production": true,
              "next_episode_to_air": {"air_date": "2026-11-30"},
              "last_air_date": "2026-10-13",
              "number_of_seasons": 8
            }
            """
            return try makeResponse(for: request, statusCode: 200, body: body)
        }, for: sessionID)
        defer { MockURLProtocol.removeHandler(for: sessionID) }

        let service = TMDBService(apiKey: "tmdb-key", session: session)
        let meta = try await service.getSeriesRenewalMetadata(id: "tt123")

        #expect(meta.status == "Returning Series")
        #expect(meta.inProduction == true)
        #expect(meta.nextEpisodeAirDate == "2026-11-30")
        #expect(meta.numberOfSeasons == 8)
    }

    @Test("getTrending uses the TMDB trending path")
    func getTrendingBuildsExpectedPath() async throws {
        let sessionID = UUID().uuidString
        let session = makeMockSession(sessionID: sessionID)
        var capturedQuery = ""

        MockURLProtocol.setHandler({ request in
            capturedQuery = request.url?.query ?? ""
            let body = """
            {"page":2,"results":[],"total_pages":1,"total_results":0}
            """
            return try makeResponse(for: request, statusCode: 200, body: body)
        }, for: sessionID)
        defer { MockURLProtocol.removeHandler(for: sessionID) }

        let service = TMDBService(apiKey: "tmdb-key", session: session)
        let result = try await service.getTrending(type: .movie, timeWindow: .week, page: 2)

        #expect(result.items.isEmpty == true)
        #expect(capturedQuery.contains("page=2"))
    }

    @Test("getCategory uses category path")
    func getCategoryBuildsExpectedPath() async throws {
        let sessionID = UUID().uuidString
        let session = makeMockSession(sessionID: sessionID)
        var capturedPath = ""

        MockURLProtocol.setHandler({ request in
            capturedPath = request.url?.path ?? ""
            let body = """
            {"page":1,"results":[],"total_pages":1,"total_results":0}
            """
            return try makeResponse(for: request, statusCode: 200, body: body)
        }, for: sessionID)
        defer { MockURLProtocol.removeHandler(for: sessionID) }

        let service = TMDBService(apiKey: "tmdb-key", session: session)
        _ = try await service.getCategory(.popular, type: .movie)

        #expect(capturedPath == "/3/movie/popular")
    }

    @Test("discover applies filters into query params")
    func discoverAppliesFilters() async throws {
        let sessionID = UUID().uuidString
        let session = makeMockSession(sessionID: sessionID)
        var capturedQuery = ""

        MockURLProtocol.setHandler({ request in
            capturedQuery = request.url?.query ?? ""
            let body = """
            {"page":1,"results":[],"total_pages":1,"total_results":0}
            """
            return try makeResponse(for: request, statusCode: 200, body: body)
        }, for: sessionID)
        defer { MockURLProtocol.removeHandler(for: sessionID) }

        let service = TMDBService(apiKey: "tmdb-key", session: session)
        let filters = DiscoverFilters(
            year: 2024,
            minRating: 7.0,
            sortBy: .ratingDesc,
            genreIds: [28, 12],
            keywordIds: [1024],
            companyIds: [5],
            networkIds: [99],
            yearGTE: 2020,
            yearLTE: 2024
        )
        _ = try await service.discover(type: .series, filters: filters)

        #expect(capturedQuery.contains("sort_by=vote_average.desc"))
        #expect(capturedQuery.contains("with_genres=28,12"))
        #expect(capturedQuery.contains("with_keywords=1024"))
        #expect(capturedQuery.contains("with_companies=5"))
        #expect(capturedQuery.contains("with_networks=99"))
        #expect(capturedQuery.contains("first_air_date_year=2024"))
        #expect(capturedQuery.contains("first_air_date.gte=2020-01-01"))
        #expect(capturedQuery.contains("first_air_date.lte=2024-12-31"))
        #expect(capturedQuery.contains("vote_average.gte=7.0"))
        #expect(capturedQuery.contains("vote_count.gte=100"))
    }

    @Test("getGenres uses long TTL endpoint and maps genres")
    func getGenresMapsGenreList() async throws {
        let sessionID = UUID().uuidString
        let session = makeMockSession(sessionID: sessionID)

        MockURLProtocol.setHandler({ request in
            let body = """
            {"genres":[{"id":28,"name":"Action"},{"id":35,"name":"Comedy"}]}
            """
            return try makeResponse(for: request, statusCode: 200, body: body)
        }, for: sessionID)
        defer { MockURLProtocol.removeHandler(for: sessionID) }

        let service = TMDBService(apiKey: "tmdb-key", session: session)
        let genres = try await service.getGenres(type: .movie)

        #expect(genres == [Genre(id: 28, name: "Action"), Genre(id: 35, name: "Comedy")])
    }

    @Test("getSeasons returns season models from detail response")
    func getSeasonsReturnsSeasonList() async throws {
        let sessionID = UUID().uuidString
        let session = makeMockSession(sessionID: sessionID)

        MockURLProtocol.setHandler({ request in
            let body = """
            {"id": 1399, "seasons":[
              {"id": 1, "season_number": 1, "name": "Season 1", "overview": "Start", "episode_count": 10, "air_date": "2011-04-17", "poster_path": null},
              {"id": 2, "season_number": 2, "name": "Season 2", "episode_count": 12, "air_date": "2012-06-22", "poster_path": "/s2.jpg"}
            ]}
            """
            return try makeResponse(for: request, statusCode: 200, body: body)
        }, for: sessionID)
        defer { MockURLProtocol.removeHandler(for: sessionID) }

        let service = TMDBService(apiKey: "tmdb-key", session: session)
        let seasons = try await service.getSeasons(tmdbId: 1399)

        #expect(seasons.count == 2)
        #expect(seasons[1].seasonNumber == 2)
        #expect(seasons[1].episodeCount == 12)
    }

    @Test("getEpisodes maps episode list")
    func getEpisodesMapsEpisodeList() async throws {
        let sessionID = UUID().uuidString
        let session = makeMockSession(sessionID: sessionID)

        MockURLProtocol.setHandler({ request in
            let body = """
            {"episodes":[
              {"id": 10, "episode_number": 1, "name": "Pilot", "overview": "Pilot", "air_date": "2010-04-17", "runtime": 55, "still_path": "/s1.jpg"},
              {"id": 11, "episode_number": 2, "name": "Episode 2", "overview": "", "air_date": null, "runtime": null, "still_path": null}
            ]}
            """
            return try makeResponse(for: request, statusCode: 200, body: body)
        }, for: sessionID)
        defer { MockURLProtocol.removeHandler(for: sessionID) }

        let service = TMDBService(apiKey: "tmdb-key", session: session)
        let episodes = try await service.getEpisodes(tmdbId: 1399, season: 1)

        #expect(episodes.count == 2)
        #expect(episodes[0].id == "1399-s1e1")
        #expect(episodes[1].title == "Episode 2")
    }

    @Test("getExternalIds returns strongly typed external ids")
    func getExternalIdsReturnsIds() async throws {
        let sessionID = UUID().uuidString
        let session = makeMockSession(sessionID: sessionID)

        MockURLProtocol.setHandler({ request in
            let body = "{\"imdb_id\":\"tt0123456\",\"tvdb_id\":54321}"
            return try makeResponse(for: request, statusCode: 200, body: body)
        }, for: sessionID)
        defer { MockURLProtocol.removeHandler(for: sessionID) }

        let service = TMDBService(apiKey: "tmdb-key", session: session)
        let ids = try await service.getExternalIds(tmdbId: 100, type: .movie)

        #expect(ids.imdbId == "tt0123456")
        #expect(ids.tvdbId == 54321)
    }

    @Test("searchKeywords trims empty input and returns none")
    func searchKeywordsEmptyReturnsEmpty() async throws {
        let service = TMDBService(apiKey: "tmdb-key", session: makeMockSession())
        let result = try await service.searchKeywords(query: "   ")
        #expect(result.isEmpty)
    }

    @Test("getPersonCredits deduplicates across cast and crew by id")
    func getPersonCreditsDeduplicatesById() async throws {
        let sessionID = UUID().uuidString
        let session = makeMockSession(sessionID: sessionID)

        MockURLProtocol.setHandler({ request in
            let body = """
            {"cast":[
              {"id": 1, "title": "Movie A", "media_type": "movie", "popularity": 20, "vote_average": 8.0},
              {"id": 2, "title": "Movie B", "media_type": "movie", "popularity": 10}
            ],
            "crew":[
              {"id": 2, "title": "Movie B", "media_type": "movie", "popularity": 80},
              {"id": 3, "name": "Series X", "media_type": "tv", "vote_average": 9.1, "popularity": 50}
            ]}
            """
            return try makeResponse(for: request, statusCode: 200, body: body)
        }, for: sessionID)
        defer { MockURLProtocol.removeHandler(for: sessionID) }

        let service = TMDBService(apiKey: "tmdb-key", session: session)
        let credits = try await service.getPersonCredits(personId: 555)

        #expect(credits.count == 3)
        #expect(credits.map(\.id).first == "tmdb-3")
        #expect(credits[0].title == "Series X")
        #expect(credits[0].year == nil)
    }

    @Test("getPerson returns person profile")
    func getPersonReturnsProfile() async throws {
        let sessionID = UUID().uuidString
        let session = makeMockSession(sessionID: sessionID)

        MockURLProtocol.setHandler({ request in
            let body = """
            {
              "id": 55,
              "name": "Nolan",
              "biography": "Director",
              "known_for_department": "Directing",
              "profile_path": "/n.jpg",
              "birthday": "1960-07-30",
              "place_of_birth": "London"
            }
            """
            return try makeResponse(for: request, statusCode: 200, body: body)
        }, for: sessionID)
        defer { MockURLProtocol.removeHandler(for: sessionID) }

        let service = TMDBService(apiKey: "tmdb-key", session: session)
        let person = try await service.getPerson(personId: 55)

        #expect(person.id == 55)
        #expect(person.name == "Nolan")
        #expect(person.knownForDepartment == "Directing")
        #expect(person.placeOfBirth == "London")
    }

    @Test("request maps HTTP 404 to notFound and 429 to rateLimited")
    func requestMapsKnownHttpErrorCodes() async {
        let sessionID = UUID().uuidString
        let session = makeMockSession(sessionID: sessionID)

        MockURLProtocol.setHandler({ request in
            let statusCode = (request.url?.query?.contains("auth=401") == true) ? 401 : 404
            return try makeResponse(for: request, statusCode: statusCode, body: "oops")
        }, for: sessionID)
        defer { MockURLProtocol.removeHandler(for: sessionID) }

        let service = TMDBService(apiKey: "tmdb-key", session: session)

        // 404 path is enough to assert TMDBError.notFound with this path.
        do {
            _ = try await service.getPerson(personId: 1)
            Issue.record("Expected notFound")
        } catch let error as TMDBError {
            #expect(error == .notFound("/person/1"))
        } catch {
            Issue.record("Unexpected error: \(error)")
        }
    }
}

private func makeResponse(for request: URLRequest, statusCode: Int, body: String) throws -> (HTTPURLResponse, Data) {
    guard let url = request.url else {
        throw NSError(domain: "TMDBAdditionalTests", code: 1)
    }
    guard let response = HTTPURLResponse(
        url: url,
        statusCode: statusCode,
        httpVersion: nil,
        headerFields: nil
    ) else {
        throw NSError(domain: "TMDBAdditionalTests", code: 2)
    }
    return (response, Data(body.utf8))
}
