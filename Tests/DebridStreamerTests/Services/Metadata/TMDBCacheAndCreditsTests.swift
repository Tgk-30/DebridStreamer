import Testing
import Foundation
@testable import DebridStreamer

// MARK: - Test helpers (fileprivate to avoid symbol collisions across test files)

/// Thread-safe counter for how many times the mock HTTP handler is invoked, so a
/// memoized read can be proven to issue exactly one network request.
private final class TMDBHitCounter: @unchecked Sendable {
    private let lock = NSLock()
    private var value = 0

    func increment() {
        lock.lock()
        value += 1
        lock.unlock()
    }

    var count: Int {
        lock.lock()
        defer { lock.unlock() }
        return value
    }
}

/// Builds a 200 `HTTPURLResponse` for the request URL, throwing if construction fails.
private func tmdbOK(_ request: URLRequest) throws -> HTTPURLResponse {
    guard let url = request.url else {
        throw NSError(domain: "TMDBCacheAndCreditsTests", code: 1)
    }
    guard let response = HTTPURLResponse(
        url: url,
        statusCode: 200,
        httpVersion: nil,
        headerFields: nil
    ) else {
        throw NSError(domain: "TMDBCacheAndCreditsTests", code: 2)
    }
    return response
}

/// Builds a 500 `HTTPURLResponse` for the request URL (used to prove the second
/// read is served from cache and never decodes a fresh - failing - response).
private func tmdbServerError(_ request: URLRequest) throws -> HTTPURLResponse {
    guard let url = request.url else {
        throw NSError(domain: "TMDBCacheAndCreditsTests", code: 3)
    }
    guard let response = HTTPURLResponse(
        url: url,
        statusCode: 500,
        httpVersion: nil,
        headerFields: nil
    ) else {
        throw NSError(domain: "TMDBCacheAndCreditsTests", code: 4)
    }
    return response
}

private let tmdbCreditsBody = """
{
  "id": 550,
  "cast": [
    { "id": 819, "name": "Edward Norton", "character": "The Narrator", "profile_path": "/norton.jpg" },
    { "id": 287, "name": "Brad Pitt", "character": "Tyler Durden", "profile_path": "/pitt.jpg" }
  ]
}
"""

private let tmdbRecommendationsBody = """
{
  "page": 1,
  "results": [
    {
      "id": 807,
      "title": "Se7en",
      "media_type": "movie",
      "overview": "Two detectives hunt a serial killer.",
      "poster_path": "/se7en.jpg",
      "release_date": "1995-09-22",
      "vote_average": 8.4
    },
    {
      "id": 1422,
      "title": "The Departed",
      "media_type": "movie",
      "overview": "An undercover cop and a mole.",
      "poster_path": "/departed.jpg",
      "release_date": "2006-10-06",
      "vote_average": 8.2
    }
  ],
  "total_pages": 1,
  "total_results": 2
}
"""

@Suite("TMDBService getCast decoding")
struct TMDBServiceGetCastTests {
    @Test("getCast decodes cast name/character and builds w185 profile URL")
    func getCastDecodesCast() async throws {
        let sessionID = UUID().uuidString
        let session = makeMockSession(sessionID: sessionID)
        var capturedURL: URL?

        MockURLProtocol.setHandler({ request in
            capturedURL = request.url
            return (try tmdbOK(request), Data(tmdbCreditsBody.utf8))
        }, for: sessionID)
        defer { MockURLProtocol.removeHandler(for: sessionID) }

        let service = TMDBService(apiKey: "tmdb-key", session: session)
        let cast = try await service.getCast(tmdbId: 550, type: .movie)

        #expect(cast.count == 2)

        let narrator = try #require(cast.first)
        #expect(narrator.id == 819)
        #expect(narrator.name == "Edward Norton")
        #expect(narrator.character == "The Narrator")
        #expect(narrator.profileURL?.absoluteString == "https://image.tmdb.org/t/p/w185/norton.jpg")

        #expect(cast[1].name == "Brad Pitt")
        #expect(cast[1].character == "Tyler Durden")
        #expect(cast[1].profileURL?.absoluteString == "https://image.tmdb.org/t/p/w185/pitt.jpg")

        // The dedicated /credits endpoint is hit on the movie path.
        let url = try #require(capturedURL)
        #expect(url.path == "/3/movie/550/credits")
    }

    @Test("getCast maps a missing character to an empty string and nil profile to nil URL")
    func getCastHandlesMissingFields() async throws {
        let sessionID = UUID().uuidString
        let session = makeMockSession(sessionID: sessionID)

        let body = """
        {
          "id": 1399,
          "cast": [
            { "id": 12, "name": "No Character Actor", "profile_path": null }
          ]
        }
        """
        MockURLProtocol.setHandler({ request in
            (try tmdbOK(request), Data(body.utf8))
        }, for: sessionID)
        defer { MockURLProtocol.removeHandler(for: sessionID) }

        let service = TMDBService(apiKey: "tmdb-key", session: session)
        let cast = try await service.getCast(tmdbId: 1399, type: .series)

        let member = try #require(cast.first)
        #expect(member.character == "")     // character ?? ""
        #expect(member.profileURL == nil)   // empty/nil profile_path -> nil URL
    }

    @Test("getCast uses the tv path segment for series")
    func getCastUsesSeriesPath() async throws {
        let sessionID = UUID().uuidString
        let session = makeMockSession(sessionID: sessionID)
        var capturedURL: URL?

        MockURLProtocol.setHandler({ request in
            capturedURL = request.url
            let body = """
            { "id": 1399, "cast": [] }
            """
            return (try tmdbOK(request), Data(body.utf8))
        }, for: sessionID)
        defer { MockURLProtocol.removeHandler(for: sessionID) }

        let service = TMDBService(apiKey: "tmdb-key", session: session)
        let cast = try await service.getCast(tmdbId: 1399, type: .series)

        #expect(cast.isEmpty)
        let url = try #require(capturedURL)
        #expect(url.path == "/3/tv/1399/credits")
    }
}

@Suite("TMDBService getRecommendations decoding")
struct TMDBServiceGetRecommendationsTests {
    @Test("getRecommendations decodes paged results into MediaPreview list")
    func getRecommendationsDecodes() async throws {
        let sessionID = UUID().uuidString
        let session = makeMockSession(sessionID: sessionID)
        var capturedURL: URL?

        MockURLProtocol.setHandler({ request in
            capturedURL = request.url
            return (try tmdbOK(request), Data(tmdbRecommendationsBody.utf8))
        }, for: sessionID)
        defer { MockURLProtocol.removeHandler(for: sessionID) }

        let service = TMDBService(apiKey: "tmdb-key", session: session)
        let previews = try await service.getRecommendations(tmdbId: 550, type: .movie)

        #expect(previews.count == 2)

        let first = try #require(previews.first)
        #expect(first.id == "tmdb-807")
        #expect(first.tmdbId == 807)
        #expect(first.title == "Se7en")
        #expect(first.type == .movie)
        #expect(first.year == 1995)
        #expect(first.posterPath == "/se7en.jpg")
        #expect(first.imdbRating == 8.4)

        #expect(previews[1].title == "The Departed")
        #expect(previews[1].year == 2006)

        let url = try #require(capturedURL)
        #expect(url.path == "/3/movie/550/recommendations")
        #expect((url.query ?? "").contains("page=1"))
    }
}

@Suite("TMDBService TTL response cache")
struct TMDBServiceResponseCacheTests {
    @Test("getCast memoizes within TTL - second read served from cache, no extra network hit")
    func getCastMemoizes() async throws {
        let sessionID = UUID().uuidString
        let session = makeMockSession(sessionID: sessionID)
        let hits = TMDBHitCounter()

        // First hit returns valid credits; any subsequent hit returns a 500 that
        // would throw .httpError if a second network read/decode actually occurred.
        MockURLProtocol.setHandler({ request in
            hits.increment()
            if hits.count == 1 {
                return (try tmdbOK(request), Data(tmdbCreditsBody.utf8))
            }
            return (try tmdbServerError(request), Data("{\"error\":\"boom\"}".utf8))
        }, for: sessionID)
        defer { MockURLProtocol.removeHandler(for: sessionID) }

        let service = TMDBService(apiKey: "tmdb-key", session: session)

        let first = try await service.getCast(tmdbId: 550, type: .movie)
        #expect(first.count == 2)
        #expect(hits.count == 1)

        // Same logical request within TTL: returns the cached value, and the
        // handler is NOT hit a second time (which would have produced a 500).
        let second = try await service.getCast(tmdbId: 550, type: .movie)
        #expect(second == first)
        #expect(hits.count == 1)
        #expect(second.first?.name == "Edward Norton")
    }

    @Test("getRecommendations memoizes within TTL - cached value persists when stub later errors")
    func getRecommendationsMemoizes() async throws {
        let sessionID = UUID().uuidString
        let session = makeMockSession(sessionID: sessionID)
        let hits = TMDBHitCounter()

        MockURLProtocol.setHandler({ request in
            hits.increment()
            if hits.count == 1 {
                return (try tmdbOK(request), Data(tmdbRecommendationsBody.utf8))
            }
            return (try tmdbServerError(request), Data("{}".utf8))
        }, for: sessionID)
        defer { MockURLProtocol.removeHandler(for: sessionID) }

        let service = TMDBService(apiKey: "tmdb-key", session: session)

        let first = try await service.getRecommendations(tmdbId: 550, type: .movie)
        #expect(first.count == 2)
        #expect(hits.count == 1)

        let second = try await service.getRecommendations(tmdbId: 550, type: .movie)
        #expect(second == first)
        #expect(hits.count == 1)
        #expect(second.first?.title == "Se7en")
    }

    @Test("Cache is keyed per request - distinct tmdbIds each hit the network")
    func cacheKeyDistinguishesRequests() async throws {
        let sessionID = UUID().uuidString
        let session = makeMockSession(sessionID: sessionID)
        let hits = TMDBHitCounter()

        // Always serve valid (empty) credits so both distinct ids decode fine.
        MockURLProtocol.setHandler({ request in
            hits.increment()
            let body = """
            { "id": 0, "cast": [] }
            """
            return (try tmdbOK(request), Data(body.utf8))
        }, for: sessionID)
        defer { MockURLProtocol.removeHandler(for: sessionID) }

        let service = TMDBService(apiKey: "tmdb-key", session: session)

        _ = try await service.getCast(tmdbId: 1, type: .movie)
        _ = try await service.getCast(tmdbId: 2, type: .movie)
        // Two different cache keys -> two network hits.
        #expect(hits.count == 2)

        // Repeating the first id is served from cache -> still two hits.
        _ = try await service.getCast(tmdbId: 1, type: .movie)
        #expect(hits.count == 2)
    }
}
