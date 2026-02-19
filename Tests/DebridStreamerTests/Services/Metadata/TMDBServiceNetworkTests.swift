import Testing
import Foundation
@testable import DebridStreamer

@Suite("TMDBService Network Tests")
struct TMDBServiceNetworkTests {
    @Test("Search builds correct query parameters and decodes results")
    func searchRequestShape() async throws {
        let sessionID = UUID().uuidString
        let session = makeMockSession(sessionID: sessionID)
        var capturedURL: URL?

        MockURLProtocol.setHandler({ request in
            capturedURL = request.url
            let body = """
            {
              "page": 1,
              "results": [
                {
                  "id": 550,
                  "title": "Fight Club",
                  "media_type": "movie",
                  "overview": "desc",
                  "release_date": "1999-10-15",
                  "vote_average": 8.4
                }
              ],
              "total_pages": 1,
              "total_results": 1
            }
            """
            guard let url = request.url else {
                throw NSError(domain: "TMDBServiceNetworkTests", code: 1)
            }
            guard let response = HTTPURLResponse(
                url: url,
                statusCode: 200,
                httpVersion: nil,
                headerFields: nil
            ) else {
                throw NSError(domain: "TMDBServiceNetworkTests", code: 2)
            }
            return (response, Data(body.utf8))
        }, for: sessionID)
        defer { MockURLProtocol.removeHandler(for: sessionID) }

        let service = TMDBService(apiKey: "tmdb-key", session: session)
        let result = try await service.search(query: "fight club", type: .movie, page: 1)

        #expect(result.items.count == 1)
        #expect(result.items.first?.title == "Fight Club")

        let finalURL = try #require(capturedURL)
        #expect(finalURL.path == "/3/search/movie")
        let query = finalURL.query ?? ""
        #expect(query.contains("query=fight%20club"))
        #expect(query.contains("api_key=tmdb-key"))
        #expect(query.contains("include_adult=false"))
        #expect(query.contains("page=1"))
    }

    @Test("HTTP 401 maps to unauthorized error")
    func unauthorizedMapping() async throws {
        let sessionID = UUID().uuidString
        let session = makeMockSession(sessionID: sessionID)

        MockURLProtocol.setHandler({ request in
            guard let url = request.url else {
                throw NSError(domain: "TMDBServiceNetworkTests", code: 3)
            }
            guard let response = HTTPURLResponse(
                url: url,
                statusCode: 401,
                httpVersion: nil,
                headerFields: nil
            ) else {
                throw NSError(domain: "TMDBServiceNetworkTests", code: 4)
            }
            return (response, Data("{}".utf8))
        }, for: sessionID)
        defer { MockURLProtocol.removeHandler(for: sessionID) }

        let service = TMDBService(apiKey: "bad-key", session: session)
        await #expect(throws: TMDBError.unauthorized) {
            _ = try await service.search(query: "test", type: .movie, page: 1)
        }
    }
}
