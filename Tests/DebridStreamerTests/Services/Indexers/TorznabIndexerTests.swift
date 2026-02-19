import Testing
import Foundation
@testable import DebridStreamer

@Suite("TorznabIndexer Tests")
struct TorznabIndexerTests {
    @Test("Search parses Torznab XML feed into torrent results")
    func parsesTorznabFeed() async throws {
        let sessionID = UUID().uuidString
        let session = makeMockSession(sessionID: sessionID)

        MockURLProtocol.setHandler({ request in
            let xml = """
            <?xml version="1.0" encoding="UTF-8"?>
            <rss version="2.0" xmlns:torznab="http://torznab.com/schemas/2015/feed">
              <channel>
                <item>
                  <title>Example.Movie.2026.1080p.WEB-DL</title>
                  <guid isPermaLink="true">magnet:?xt=urn:btih:ABCDEF1234567890ABCDEF1234567890ABCDEF12</guid>
                  <size>1500000000</size>
                  <torznab:attr name="seeders" value="123"/>
                  <torznab:attr name="peers" value="4"/>
                  <torznab:attr name="infohash" value="ABCDEF1234567890ABCDEF1234567890ABCDEF12"/>
                </item>
              </channel>
            </rss>
            """
            return try makeResponse(for: request, statusCode: 200, body: xml)
        }, for: sessionID)
        defer { MockURLProtocol.removeHandler(for: sessionID) }

        let indexer = TorznabIndexer(
            name: "Jackett",
            baseURL: "http://localhost:9117",
            endpointPath: "/api/v2.0/indexers/all/results/torznab/api",
            apiKey: "abc123",
            categoryFilter: nil,
            sendAPIKeyAsHeader: false,
            session: session
        )

        let results = try await indexer.searchByQuery(query: "Example Movie", type: .movie)

        #expect(results.count == 1)
        #expect(results[0].infoHash == "abcdef1234567890abcdef1234567890abcdef12")
        #expect(results[0].seeders == 123)
        #expect(results[0].sizeBytes == 1_500_000_000)
        #expect(results[0].indexerName == "Jackett")
    }

    @Test("API key can be sent in header mode for Prowlarr-style endpoints")
    func sendsHeaderAPIKey() async throws {
        let sessionID = UUID().uuidString
        let session = makeMockSession(sessionID: sessionID)
        var seenHeader: String?

        MockURLProtocol.setHandler({ request in
            seenHeader = request.value(forHTTPHeaderField: "X-Api-Key")
            return try makeResponse(for: request, statusCode: 200, body: "<rss><channel></channel></rss>")
        }, for: sessionID)
        defer { MockURLProtocol.removeHandler(for: sessionID) }

        let indexer = TorznabIndexer(
            name: "Prowlarr",
            baseURL: "http://localhost:9696",
            endpointPath: "/api/v1/search",
            apiKey: "header-token",
            categoryFilter: nil,
            sendAPIKeyAsHeader: true,
            session: session
        )

        _ = try await indexer.searchByQuery(query: "test", type: .movie)
        #expect(seenHeader == "header-token")
    }

    private func makeResponse(for request: URLRequest, statusCode: Int, body: String) throws -> (HTTPURLResponse, Data) {
        guard let url = request.url else {
            throw NSError(domain: "TorznabIndexerTests", code: 1)
        }
        guard let response = HTTPURLResponse(
            url: url,
            statusCode: statusCode,
            httpVersion: nil,
            headerFields: nil
        ) else {
            throw NSError(domain: "TorznabIndexerTests", code: 2)
        }
        return (response, Data(body.utf8))
    }
}
