import Testing
import Foundation
@testable import DebridStreamer

@Suite("StremioAddonIndexer Tests")
struct StremioAddonIndexerTests {
    @Test("Parses Torrentio-style streams (infoHash + seeders + size from title)")
    func parsesTorrentioStreams() async throws {
        let sessionID = UUID().uuidString
        let session = makeMockSession(sessionID: sessionID)

        MockURLProtocol.setHandler({ request in
            let json = """
            {
              "streams": [
                {
                  "name": "Torrentio\\n1080p",
                  "title": "Example.Movie.2026.1080p.WEB-DL.x264\\n👤 123 💾 2.1 GB ⚙️ ThePirateBay",
                  "infoHash": "ABCDEF1234567890ABCDEF1234567890ABCDEF12",
                  "fileIdx": 0
                },
                {
                  "name": "Torrentio\\n720p",
                  "title": "Example.Movie.2026.720p.BluRay\\n👤 7 💾 900 MB",
                  "url": "magnet:?xt=urn:btih:1111111111111111111111111111111111111111&dn=Example"
                }
              ]
            }
            """
            return try makeResponse(for: request, statusCode: 200, body: json)
        }, for: sessionID)
        defer { MockURLProtocol.removeHandler(for: sessionID) }

        let indexer = StremioAddonIndexer(
            name: "Torrentio",
            baseURL: "https://torrentio.strem.fun",
            session: session
        )

        let results = try await indexer.search(imdbId: "tt1234567", type: .movie, season: nil, episode: nil)

        #expect(results.count == 2)

        let first = try #require(results.first(where: { $0.infoHash == "abcdef1234567890abcdef1234567890abcdef12" }))
        #expect(first.seeders == 123)
        #expect(first.sizeBytes == 2_100_000_000)
        #expect(first.quality == .hd1080p)
        #expect(first.indexerName == "Torrentio")

        let second = try #require(results.first(where: { $0.infoHash == "1111111111111111111111111111111111111111" }))
        #expect(second.seeders == 7)
        #expect(second.sizeBytes == 900_000_000)
        #expect(second.quality == .hd720p)
        #expect(second.magnetURI?.hasPrefix("magnet:?") == true)
    }

    @Test("Series search builds tt:season:episode stream id")
    func seriesStreamIdFormatting() async throws {
        let sessionID = UUID().uuidString
        let session = makeMockSession(sessionID: sessionID)
        var requestedPath: String?

        MockURLProtocol.setHandler({ request in
            requestedPath = request.url?.path
            return try makeResponse(for: request, statusCode: 200, body: #"{"streams": []}"#)
        }, for: sessionID)
        defer { MockURLProtocol.removeHandler(for: sessionID) }

        let indexer = StremioAddonIndexer(
            name: "Torrentio",
            baseURL: "https://torrentio.strem.fun/",
            session: session
        )

        _ = try await indexer.search(imdbId: "tt9999999", type: .series, season: 2, episode: 5)
        // Path is percent-decoded by URL; the encoded colons resolve back to ':'.
        #expect(requestedPath == "/stream/series/tt9999999:2:5.json")
    }

    @Test("Non-IMDb media ids resolve to no streams without a network call")
    func nonImdbIdReturnsEmpty() async throws {
        let sessionID = UUID().uuidString
        let session = makeMockSession(sessionID: sessionID)
        var didCallNetwork = false

        MockURLProtocol.setHandler({ request in
            didCallNetwork = true
            return try makeResponse(for: request, statusCode: 200, body: #"{"streams": []}"#)
        }, for: sessionID)
        defer { MockURLProtocol.removeHandler(for: sessionID) }

        let indexer = StremioAddonIndexer(
            name: "Torrentio",
            baseURL: "https://torrentio.strem.fun",
            session: session
        )

        let results = try await indexer.search(imdbId: "tmdb-550", type: .movie, season: nil, episode: nil)
        #expect(results.isEmpty)
        #expect(didCallNetwork == false)
    }

    @Test("Streams without a resolvable info hash are dropped")
    func dropsStreamsWithoutInfoHash() async throws {
        let sessionID = UUID().uuidString
        let session = makeMockSession(sessionID: sessionID)

        MockURLProtocol.setHandler({ request in
            let json = """
            {
              "streams": [
                { "title": "No hash here", "url": "https://example.com/playlist.m3u8" }
              ]
            }
            """
            return try makeResponse(for: request, statusCode: 200, body: json)
        }, for: sessionID)
        defer { MockURLProtocol.removeHandler(for: sessionID) }

        let indexer = StremioAddonIndexer(
            name: "Torrentio",
            baseURL: "https://torrentio.strem.fun",
            session: session
        )

        let results = try await indexer.search(imdbId: "tt1234567", type: .movie, season: nil, episode: nil)
        #expect(results.isEmpty)
    }

    private func makeResponse(for request: URLRequest, statusCode: Int, body: String) throws -> (HTTPURLResponse, Data) {
        guard let url = request.url else {
            throw NSError(domain: "StremioAddonIndexerTests", code: 1)
        }
        guard let response = HTTPURLResponse(
            url: url,
            statusCode: statusCode,
            httpVersion: nil,
            headerFields: nil
        ) else {
            throw NSError(domain: "StremioAddonIndexerTests", code: 2)
        }
        return (response, Data(body.utf8))
    }
}
