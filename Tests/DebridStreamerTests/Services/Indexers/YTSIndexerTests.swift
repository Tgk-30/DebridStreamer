import Testing
import Foundation
@testable import DebridStreamer

@Suite("YTSIndexer Tests")
struct YTSIndexerTests {
    @Test("search returns empty for non-movie media type")
    func searchRejectsNonMovieType() async throws {
        let sessionID = UUID().uuidString
        let session = makeMockSession(sessionID: sessionID)

        let indexer = YTSIndexer(session: session)
        let results = try await indexer.search(imdbId: "tt1234567", type: .series, season: nil, episode: nil)

        #expect(results.isEmpty)
    }

    @Test("search trims and rejects blank IMDb ids")
    func searchRejectsBlankIMDbId() async throws {
        let sessionID = UUID().uuidString
        let session = makeMockSession(sessionID: sessionID)

        let indexer = YTSIndexer(session: session)
        let blankResults = try await indexer.search(imdbId: "   ", type: .movie, season: nil, episode: nil)

        #expect(blankResults.isEmpty)
    }

    @Test("search returns empty when YTS movie list is missing")
    func searchReturnsEmptyWhenMoviesNil() async throws {
        let sessionID = UUID().uuidString
        let session = makeMockSession(sessionID: sessionID)

        MockURLProtocol.setHandler({ request in
            let body = """
            {
                "status": "ok",
                "data": {
                    "movie_count": 0,
                    "movies": null
                }
            }
            """.data(using: .utf8)!
            let url = try #require(request.url)
            let response = HTTPURLResponse(url: url, statusCode: 200, httpVersion: nil, headerFields: nil)!
            return (response, body)
        }, for: sessionID)
        defer { MockURLProtocol.removeHandler(for: sessionID) }

        let indexer = YTSIndexer(session: session)
        let results = try await indexer.search(imdbId: "tt1234567", type: .movie, season: nil, episode: nil)
        #expect(results.isEmpty)
    }

    @Test("search returns empty when YTS movie list is an empty array")
    func searchReturnsEmptyWhenMoviesEmpty() async throws {
        let sessionID = UUID().uuidString
        let session = makeMockSession(sessionID: sessionID)

        MockURLProtocol.setHandler({ request in
            let body = """
            {
                "status": "ok",
                "data": {
                    "movie_count": 0,
                    "movies": []
                }
            }
            """.data(using: .utf8)!
            let url = try #require(request.url)
            let response = HTTPURLResponse(url: url, statusCode: 200, httpVersion: nil, headerFields: nil)!
            return (response, body)
        }, for: sessionID)
        defer { MockURLProtocol.removeHandler(for: sessionID) }

        let indexer = YTSIndexer(session: session)
        let results = try await indexer.search(imdbId: "tt7654321", type: .movie, season: nil, episode: nil)
        #expect(results.isEmpty)
    }

    @Test("search throws when YTS response is not a 2xx")
    func searchThrowsOnHTTPError() async throws {
        let sessionID = UUID().uuidString
        let session = makeMockSession(sessionID: sessionID)
        MockURLProtocol.setHandler({ request in
            let url = try #require(request.url)
            guard let response = HTTPURLResponse(url: url, statusCode: 500, httpVersion: nil, headerFields: nil) else {
                throw NSError(domain: "YTSIndexerTests", code: 1)
            }
            return (response, Data("server error".utf8))
        }, for: sessionID)
        defer { MockURLProtocol.removeHandler(for: sessionID) }

        let indexer = YTSIndexer(session: session)

        await #expect(throws: (any Error).self) {
            _ = try await indexer.search(imdbId: "Inception", type: .movie, season: nil, episode: nil)
        }
    }

    @Test("search parses movie and torrent fields and skips torrents with empty hashes")
    func searchParsesValidResultsAndFiltersHashes() async throws {
        let sessionID = UUID().uuidString
        let session = makeMockSession(sessionID: sessionID)
        var observedQuery: String = ""

        MockURLProtocol.setHandler({ request in
            observedQuery = request.url?.query() ?? ""
            let body = """
            {
                "status": "ok",
                "data": {
                    "movie_count": 2,
                    "movies": [
                        {
                            "title_long": "Inception 2010",
                            "title": "Inception",
                            "torrents": [
                                {"hash": "", "quality": "1080p", "type": "bluray", "seeds": 20, "peers": 5, "size_bytes": 1000000},
                                {"hash": "abcdef1234567890abcdef1234567890abcdef12", "quality": "2160p", "type": "web", "seeds": 10, "peers": 2, "size_bytes": 2000000}
                            ]
                        },
                        {
                            "title_long": "No Torrents",
                            "title": "Orphan",
                            "torrents": null
                        }
                    ]
                }
            }
            """.data(using: .utf8)!
            let url = try #require(request.url)
            let response = HTTPURLResponse(url: url, statusCode: 200, httpVersion: nil, headerFields: nil)!
            return (response, body)
        }, for: sessionID)
        defer { MockURLProtocol.removeHandler(for: sessionID) }

        let indexer = YTSIndexer(session: session)
        let results = try await indexer.search(imdbId: "Inception", type: .movie, season: nil, episode: nil)
        let firstResult = results[0]

        #expect(results.count == 1)
        #expect(firstResult.indexerName == "YTS")
        #expect(firstResult.infoHash == "abcdef1234567890abcdef1234567890abcdef12")
        #expect(firstResult.seeders == 10)
        #expect(firstResult.leechers == 2)
        #expect(firstResult.title.contains("2160p"))
        #expect(observedQuery.contains("query_term=Inception"))
    }

    @Test("searchByQuery trims whitespace and ignores non-movie media")
    func searchByQueryHandlesTrimAndTypeGuard() async throws {
        let sessionID = UUID().uuidString
        let session = makeMockSession(sessionID: sessionID)

        let indexer = YTSIndexer(session: session)
        let tvResults = try await indexer.searchByQuery(query: "  any show  ", type: .series)
        #expect(tvResults.isEmpty)
        let emptyQueryResults = try await indexer.searchByQuery(query: "   ", type: .movie)
        #expect(emptyQueryResults.isEmpty)
    }

    @Test("searchByQuery returns empty when YTS movie list is nil")
    func searchByQueryReturnsEmptyWhenMoviesNil() async throws {
        let sessionID = UUID().uuidString
        let session = makeMockSession(sessionID: sessionID)

        MockURLProtocol.setHandler({ request in
            let body = """
            {
                "status": "ok",
                "data": {
                    "movies": null
                }
            }
            """.data(using: .utf8)!
            let url = try #require(request.url)
            let response = HTTPURLResponse(url: url, statusCode: 200, httpVersion: nil, headerFields: nil)!
            return (response, body)
        }, for: sessionID)
        defer { MockURLProtocol.removeHandler(for: sessionID) }

        let indexer = YTSIndexer(session: session)
        let results = try await indexer.searchByQuery(query: "matrix", type: .movie)
        #expect(results.isEmpty)
    }

    @Test("searchByQuery throws on bad status and parses multiple results")
    func searchByQueryParsesResultsAndThrowsOnErrors() async throws {
        let sessionID = UUID().uuidString
        let session = makeMockSession(sessionID: sessionID)

        var requestPath = ""
        MockURLProtocol.setHandler({ request in
            requestPath = request.url?.path ?? ""
            let body = """
            {
                "status": "ok",
                "data": {
                    "movies": [
                        {
                            "title_long": "Matrix Reloaded",
                            "title": "Matrix",
                            "torrents": [
                                {"hash": "hash-one", "quality": "720p", "type": "web", "seeds": 3, "peers": 1, "size_bytes": 333}
                            ]
                        },
                        {
                            "title_long": "No Hash",
                            "title": "Missing",
                            "torrents": [
                                {"hash": null, "quality": "1080p", "type": "web", "seeds": 3, "peers": 1, "size_bytes": 444}
                            ]
                        }
                    ]
                }
            }
            """.data(using: .utf8)!
            let url = try #require(request.url)
            let response = HTTPURLResponse(url: url, statusCode: 200, httpVersion: nil, headerFields: nil)!
            return (response, body)
        }, for: sessionID)
        defer { MockURLProtocol.removeHandler(for: sessionID) }

        let indexer = YTSIndexer(session: session)
        let results = try await indexer.searchByQuery(query: "matrix", type: .movie)
        #expect(results.count == 1)
        #expect(results.first?.infoHash == "hash-one")
        #expect(requestPath.contains("/list_movies.json"))

        let badSessionID = "bad-" + sessionID
        let badSession = makeMockSession(sessionID: badSessionID)
        MockURLProtocol.setHandler({ request in
            let url = try #require(request.url)
            let response = HTTPURLResponse(url: url, statusCode: 404, httpVersion: nil, headerFields: nil)!
            return (response, Data("not found".utf8))
        }, for: badSessionID)
        defer { MockURLProtocol.removeHandler(for: badSessionID) }

        let badIndexer = YTSIndexer(session: badSession)
        await #expect(throws: (any Error).self) {
            _ = try await badIndexer.searchByQuery(query: "matrix", type: .movie)
        }
    }

}
