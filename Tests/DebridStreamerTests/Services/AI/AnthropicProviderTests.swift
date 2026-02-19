import Testing
import Foundation
@testable import DebridStreamer

@Suite("AnthropicProvider Tests")
struct AnthropicProviderTests {
    @Test("Parses text block response into recommendations")
    func parsesRecommendations() async throws {
        let sessionID = UUID().uuidString
        let session = makeMockSession(sessionID: sessionID)

        MockURLProtocol.setHandler({ request in
            let body = """
            {
              "content": [
                {
                  "type": "text",
                  "text": "{\\"recommendations\\":[{\\"title\\":\\"Arrival\\",\\"year\\":2016,\\"reason\\":\\"Smart sci-fi\\",\\"score\\":0.88}]}"
                }
              ]
            }
            """
            return try makeResponse(for: request, statusCode: 200, body: body)
        }, for: sessionID)
        defer { MockURLProtocol.removeHandler(for: sessionID) }

        let provider = AnthropicProvider(apiKey: "test-key", session: session)
        let recs = try await provider.recommend(prompt: "Sci-fi", candidateTitles: [], maxResults: 5)

        #expect(recs.count == 1)
        #expect(recs[0].title == "Arrival")
        #expect(recs[0].year == 2016)
    }

    private func makeResponse(for request: URLRequest, statusCode: Int, body: String) throws -> (HTTPURLResponse, Data) {
        guard let url = request.url else {
            throw NSError(domain: "AnthropicProviderTests", code: 1)
        }
        guard let response = HTTPURLResponse(url: url, statusCode: statusCode, httpVersion: nil, headerFields: nil) else {
            throw NSError(domain: "AnthropicProviderTests", code: 2)
        }
        return (response, Data(body.utf8))
    }
}
