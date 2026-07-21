import Testing
import Foundation
@testable import DebridStreamer

/// Tests for the built-in scrapers (APIBay / YTS / EZTV): non-2xx must throw
/// (so IndexerManager records the failure rather than silently swallowing it),
/// genuine empty-but-200 bodies must still return [], and APIBay's TV
/// season/episode filter must use an anchored SxxEyy match.
@Suite("Built-in indexer tests")
struct BuiltInIndexerTests {

    private func response(for request: URLRequest, statusCode: Int, body: String) throws -> (HTTPURLResponse, Data) {
        guard let url = request.url,
              let resp = HTTPURLResponse(url: url, statusCode: statusCode, httpVersion: nil, headerFields: nil) else {
            throw NSError(domain: "BuiltInIndexerTests", code: 1)
        }
        return (resp, Data(body.utf8))
    }

    // MARK: - APIBay

    @Test("APIBay throws on non-2xx response")
    func apiBayThrowsOnHTTPError() async {
        let sessionID = UUID().uuidString
        let session = makeMockSession(sessionID: sessionID)
        MockURLProtocol.setHandler({ request in
            try self.response(for: request, statusCode: 503, body: "[]")
        }, for: sessionID)
        defer { MockURLProtocol.removeHandler(for: sessionID) }

        let indexer = APIBayIndexer(session: session)
        await #expect(throws: (any Error).self) {
            _ = try await indexer.searchByQuery(query: "anything", type: .movie)
        }
    }

    @Test("APIBay searchByQuery avoids network call for whitespace input")
    func apiBaySearchByQueryWhitespaceNoNetwork() async throws {
        let sessionID = UUID().uuidString
        let session = makeMockSession(sessionID: sessionID)
        var didCall = false

        MockURLProtocol.setHandler({ request in
            didCall = true
            return try self.response(for: request, statusCode: 200, body: "[]")
        }, for: sessionID)
        defer { MockURLProtocol.removeHandler(for: sessionID) }

        let indexer = APIBayIndexer(session: session)
        let results = try await indexer.searchByQuery(query: "   ", type: .movie)
        #expect(results.isEmpty)
        #expect(didCall == false)
    }

    @Test("APIBay search(imdbId:) returns [] for blank imdbId without network")
    func apiBaySearchImdbBlankNoNetwork() async throws {
        let sessionID = UUID().uuidString
        let session = makeMockSession(sessionID: sessionID)
        var didCall = false

        MockURLProtocol.setHandler({ request in
            didCall = true
            return try self.response(for: request, statusCode: 200, body: "[]")
        }, for: sessionID)
        defer { MockURLProtocol.removeHandler(for: sessionID) }

        let indexer = APIBayIndexer(session: session)
        let results = try await indexer.search(imdbId: "   ", type: .movie, season: nil, episode: nil)

        #expect(results.isEmpty)
        #expect(didCall == false)
    }

    @Test("APIBay returns [] for the no-results sentinel with HTTP 200")
    func apiBayEmptySentinelReturnsEmpty() async throws {
        let sessionID = UUID().uuidString
        let session = makeMockSession(sessionID: sessionID)
        let body = """
        [{"id":"0","name":"No results returned","info_hash":"0000000000000000000000000000000000000000","leechers":"0","seeders":"0","num_files":"0","size":"0","username":"","added":"0","status":"","category":"0","imdb":""}]
        """
        MockURLProtocol.setHandler({ request in
            try self.response(for: request, statusCode: 200, body: body)
        }, for: sessionID)
        defer { MockURLProtocol.removeHandler(for: sessionID) }

        let indexer = APIBayIndexer(session: session)
        let results = try await indexer.searchByQuery(query: "nothing", type: .movie)
        #expect(results.isEmpty)
    }

    @Test("APIBay anchored SxxEyy filter rejects non-contiguous matches and accepts dot-separated forms")
    func apiBaySeasonEpisodeFilter() async throws {
        let sessionID = UUID().uuidString
        let session = makeMockSession(sessionID: sessionID)
        // Two items: a false-positive ("S01E05" episode that also contains a stray
        // "E01" token) and a legitimate dot-separated S01.E01.
        let body = """
        [
          {"id":"1","name":"Show.S01E05.x264-E01TUREL","info_hash":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA","leechers":"1","seeders":"10","size":"100","category":"208","imdb":"tt1"},
          {"id":"2","name":"Show.S01.E01.1080p.WEB","info_hash":"BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB","leechers":"1","seeders":"20","size":"200","category":"208","imdb":"tt1"}
        ]
        """
        MockURLProtocol.setHandler({ request in
            try self.response(for: request, statusCode: 200, body: body)
        }, for: sessionID)
        defer { MockURLProtocol.removeHandler(for: sessionID) }

        let indexer = APIBayIndexer(session: session)
        let results = try await indexer.search(imdbId: "tt1", type: .series, season: 1, episode: 1)

        #expect(results.count == 1)
        #expect(results.first?.title == "Show.S01.E01.1080p.WEB")
    }

    @Test("APIBay search falls back from tt-prefixed IMDb IDs to numeric IDs")
    func apiBaySearchFallsBackFromTTToNumeric() async throws {
        let sessionID = UUID().uuidString
        let session = makeMockSession(sessionID: sessionID)
        var sawTT = false
        var sawNumeric = false

        MockURLProtocol.setHandler({ request in
            guard let url = request.url,
                  let queryItems = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems,
                  let q = queryItems.first(where: { $0.name == "q" })?.value else {
                return try self.response(for: request, statusCode: 500, body: "{}")
            }

            if q == "tt987" {
                sawTT = true
                let body = """
                [{"id":"0","name":"No results returned","info_hash":"0000000000000000000000000000000000000000","seeders":"0","leechers":"0","size":"0","category":"0","imdb":""}]
                """
                return try self.response(for: request, statusCode: 200, body: body)
            }

            if q == "987" {
                sawNumeric = true
                let body = """
                [{"id":"1","name":"Fallback Movie","info_hash":"ABCDEF1234567890ABCDEF1234567890ABCDEF12","seeders":"9","leechers":"0","size":"0"}]
                """
                return try self.response(for: request, statusCode: 200, body: body)
            }

            let body = "[]"
            return try self.response(for: request, statusCode: 200, body: body)
        }, for: sessionID)
        defer { MockURLProtocol.removeHandler(for: sessionID) }

        let indexer = APIBayIndexer(session: session)
        let results = try await indexer.search(imdbId: "tt987", type: .movie, season: nil, episode: nil)

        #expect(sawTT)
        #expect(sawNumeric)
        #expect(results.count == 1)
        #expect(results.first?.infoHash == "abcdef1234567890abcdef1234567890abcdef12")
    }

    // MARK: - YTS

    @Test("YTS throws on non-2xx response")
    func ytsThrowsOnHTTPError() async {
        let sessionID = UUID().uuidString
        let session = makeMockSession(sessionID: sessionID)
        MockURLProtocol.setHandler({ request in
            try self.response(for: request, statusCode: 500, body: "{}")
        }, for: sessionID)
        defer { MockURLProtocol.removeHandler(for: sessionID) }

        let indexer = YTSIndexer(session: session)
        await #expect(throws: (any Error).self) {
            _ = try await indexer.searchByQuery(query: "anything", type: .movie)
        }
    }

    @Test("YTS returns [] for an empty movies list with HTTP 200")
    func ytsEmptyReturnsEmpty() async throws {
        let sessionID = UUID().uuidString
        let session = makeMockSession(sessionID: sessionID)
        let body = """
        {"status":"ok","data":{"movie_count":0,"movies":[]}}
        """
        MockURLProtocol.setHandler({ request in
            try self.response(for: request, statusCode: 200, body: body)
        }, for: sessionID)
        defer { MockURLProtocol.removeHandler(for: sessionID) }

        let indexer = YTSIndexer(session: session)
        let results = try await indexer.searchByQuery(query: "nothing", type: .movie)
        #expect(results.isEmpty)
    }

    @Test("YTS search ignores non-movie lookups and avoids network")
    func ytsIgnoresNonMovieLookup() async throws {
        let sessionID = UUID().uuidString
        let session = makeMockSession(sessionID: sessionID)
        var requestHit = false

        MockURLProtocol.setHandler({ _ in
            requestHit = true
            return try self.response(for: URLRequest(url: URL(string: "https://example.com")!), statusCode: 200, body: "{}")
        }, for: sessionID)
        defer { MockURLProtocol.removeHandler(for: sessionID) }

        let indexer = YTSIndexer(session: session)
        let noResults = try await indexer.search(imdbId: "tt999", type: .series, season: nil, episode: nil)
        let noResultsByQuery = try await indexer.searchByQuery(query: "tv", type: .series)

        #expect(noResults.isEmpty)
        #expect(noResultsByQuery.isEmpty)
        #expect(requestHit == false)
    }

    @Test("YTS search requires valid hashes and filters by torrent metadata")
    func ytsFiltersMissingHashesAndBuildsTitles() async throws {
        let sessionID = UUID().uuidString
        let session = makeMockSession(sessionID: sessionID)
        let body = """
        {
          "status":"ok",
          "data":{"movie_count":2,"movies":[
            {
              "title_long":"Some Movie",
              "torrents":[
                {"hash":null,"quality":"1080p","type":"bluray","size_bytes":1234,"seeds":1,"peers":2},
                {"hash":"GOODHASH","quality":"720p","type":"web","size_bytes":54321,"seeds":3,"peers":4}
              ]
            }
          ]}
        }
        """

        MockURLProtocol.setHandler({ request in
            try self.response(for: request, statusCode: 200, body: body)
        }, for: sessionID)
        defer { MockURLProtocol.removeHandler(for: sessionID) }

        let indexer = YTSIndexer(session: session)
        let results = try await indexer.search(imdbId: "tt888", type: .movie, season: nil, episode: nil)
        let resultsByQuery = try await indexer.searchByQuery(query: "movie", type: .movie)

        #expect(results.count == 1)
        #expect(results.first?.infoHash == "goodhash")
        #expect(results.first?.title == "Some Movie [720p] [web]")
        #expect(resultsByQuery.count == 1)
        #expect(resultsByQuery.first?.seeders == 3)
    }

    // MARK: - EZTV

    @Test("EZTV throws on non-2xx response")
    func eztvThrowsOnHTTPError() async {
        let sessionID = UUID().uuidString
        let session = makeMockSession(sessionID: sessionID)
        MockURLProtocol.setHandler({ request in
            try self.response(for: request, statusCode: 502, body: "{}")
        }, for: sessionID)
        defer { MockURLProtocol.removeHandler(for: sessionID) }

        let indexer = EZTVIndexer(session: session)
        await #expect(throws: (any Error).self) {
            _ = try await indexer.searchByQuery(query: "anything", type: .series)
        }
    }

    @Test("EZTV returns [] for an empty torrents list with HTTP 200")
    func eztvEmptyReturnsEmpty() async throws {
        let sessionID = UUID().uuidString
        let session = makeMockSession(sessionID: sessionID)
        let body = """
        {"torrents_count":0,"page":1,"torrents":[]}
        """
        MockURLProtocol.setHandler({ request in
            try self.response(for: request, statusCode: 200, body: body)
        }, for: sessionID)
        defer { MockURLProtocol.removeHandler(for: sessionID) }

        let indexer = EZTVIndexer(session: session)
        let results = try await indexer.searchByQuery(query: "nothing", type: .series)
        #expect(results.isEmpty)
    }

    @Test("EZTV search ignores non-series lookups and avoids network")
    func eztvIgnoresNonSeriesLookup() async throws {
        let sessionID = UUID().uuidString
        let session = makeMockSession(sessionID: sessionID)
        var requestHit = false

        MockURLProtocol.setHandler({ request in
            requestHit = true
            return try self.response(for: request, statusCode: 200, body: "{}")
        }, for: sessionID)
        defer { MockURLProtocol.removeHandler(for: sessionID) }

        let indexer = EZTVIndexer(session: session)
        let noSeries = try await indexer.search(imdbId: "tt888", type: .movie, season: nil, episode: nil)
        let noByQuery = try await indexer.searchByQuery(query: "movie", type: .movie)
        #expect(noSeries.isEmpty)
        #expect(noByQuery.isEmpty)
        #expect(requestHit == false)
    }

    @Test("EZTV searchByQuery trims whitespace and returns [] when blank")
    func eztvSearchByQueryIgnoresBlankInput() async throws {
        let sessionID = UUID().uuidString
        let session = makeMockSession(sessionID: sessionID)
        var requestHit = false

        MockURLProtocol.setHandler({ request in
            requestHit = true
            return try self.response(for: request, statusCode: 200, body: "{}")
        }, for: sessionID)
        defer { MockURLProtocol.removeHandler(for: sessionID) }

        let indexer = EZTVIndexer(session: session)
        #expect(try await indexer.searchByQuery(query: "  \t\n", type: .series).isEmpty)
        #expect(requestHit == false)
    }

    @Test("EZTV can filter by season and episode and paginates until short page")
    func eztvFiltersAndPaginates() async throws {
        let sessionID = UUID().uuidString
        let session = makeMockSession(sessionID: sessionID)

        var callCount = 0
        let onePage: [[String: Any]] = (0..<100).map { index in
            [
                "hash": "page1-\(index)",
                "filename": "show s01e\(String(format: "%02d", index + 1))",
                "season": "1",
                "episode": "\(index + 1)",
                "seeds": 1,
                "peers": 1,
                "size_bytes": "1024"
            ]
        }
        let finalPage: [[String: Any]] = [[
            "hash": "page2-101",
            "filename": "show s01e101",
            "season": "1",
            "episode": "101",
            "seeds": 9,
            "peers": 2,
            "size_bytes": "2048"
        ]]

        MockURLProtocol.setHandler({ request in
            callCount += 1
            let pageOne = URLComponents(url: request.url!, resolvingAgainstBaseURL: false)?
                .queryItems?
                .first(where: { $0.name == "page" })?
                .value == "1"

            let payload: [String: Any] = if pageOne {
                ["torrents_count": 100, "page": 1, "torrents": onePage]
            } else {
                ["torrents_count": 1, "page": 2, "torrents": finalPage]
            }
            let data = try JSONSerialization.data(withJSONObject: payload)
            guard let url = request.url else {
                throw NSError(domain: "BuiltInIndexerTests", code: 1)
            }
            guard let response = HTTPURLResponse(url: url, statusCode: 200, httpVersion: nil, headerFields: nil) else {
                throw NSError(domain: "BuiltInIndexerTests", code: 2)
            }
            return (response, data)
        }, for: sessionID)
        defer { MockURLProtocol.removeHandler(for: sessionID) }

        let indexer = EZTVIndexer(session: session)
        let results = try await indexer.search(imdbId: "tt123", type: .series, season: 1, episode: 101)
        #expect(callCount == 2)
        #expect(results.count == 1)
        #expect(results.first?.infoHash == "page2-101")
    }
}
