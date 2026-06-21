import Testing
import Foundation
@testable import DebridStreamer

@Suite("OllamaProvider Tests")
struct OllamaProviderTests {
    @Test("Parses Ollama chat response")
    func parsesResponse() async throws {
        let sessionID = UUID().uuidString
        let session = makeMockSession(sessionID: sessionID)

        MockURLProtocol.setHandler({ request in
            let body = """
            {
              "message": {
                "role": "assistant",
                "content": "{\\"recommendations\\":[{\\"title\\":\\"Blade Runner 2049\\",\\"year\\":2017,\\"reason\\":\\"Atmospheric sci-fi\\",\\"score\\":0.93}]}"
              }
            }
            """
            return try makeResponse(for: request, statusCode: 200, body: body)
        }, for: sessionID)
        defer { MockURLProtocol.removeHandler(for: sessionID) }

        let provider = OllamaProvider(endpoint: URL(string: "http://localhost:11434/api/chat")!, session: session)
        let result = try await provider.recommend(prompt: "Recommend me sci-fi", candidateTitles: [], maxResults: 5)

        #expect(result.recommendations.count == 1)
        #expect(result.recommendations[0].title == "Blade Runner 2049")
        #expect(result.recommendations[0].year == 2017)
        #expect(result.model == "llama3.1:8b")
        #expect((result.usage?.safeTotalTokens ?? 0) > 0)
    }

    private func makeResponse(for request: URLRequest, statusCode: Int, body: String) throws -> (HTTPURLResponse, Data) {
        guard let url = request.url else {
            throw NSError(domain: "OllamaProviderTests", code: 1)
        }
        guard let response = HTTPURLResponse(url: url, statusCode: statusCode, httpVersion: nil, headerFields: nil) else {
            throw NSError(domain: "OllamaProviderTests", code: 2)
        }
        return (response, Data(body.utf8))
    }
}
