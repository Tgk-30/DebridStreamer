import Testing
import Foundation
@testable import DebridStreamer

@Suite("OpenAIProvider Tests")
struct OpenAIProviderTests {
    @Test("Parses JSON recommendations from chat completion response")
    func parsesRecommendations() async throws {
        let sessionID = UUID().uuidString
        let session = makeMockSession(sessionID: sessionID)

        MockURLProtocol.setHandler({ request in
            let body = """
            {
              "model": "gpt-4.1-mini",
              "usage": {
                "prompt_tokens": 120,
                "completion_tokens": 80,
                "total_tokens": 200
              },
              "choices": [
                {
                  "message": {
                    "content": "{\\"recommendations\\":[{\\"title\\":\\"Dune\\",\\"year\\":2021,\\"reason\\":\\"Sci-fi epic\\",\\"score\\":0.9}]}"
                  }
                }
              ]
            }
            """
            return try makeResponse(for: request, statusCode: 200, body: body)
        }, for: sessionID)
        defer { MockURLProtocol.removeHandler(for: sessionID) }

        let provider = OpenAIProvider(apiKey: "test-key", session: session)
        let result = try await provider.recommend(prompt: "Sci-fi recommendations", candidateTitles: [], maxResults: 5)

        #expect(result.recommendations.count == 1)
        #expect(result.recommendations[0].title == "Dune")
        #expect(result.recommendations[0].year == 2021)
        #expect(result.usage?.totalTokens == 200)
        #expect(result.model == "gpt-4.1-mini")
    }

    @Test("Missing API key fails fast")
    func missingAPIKeyFails() async {
        let provider = OpenAIProvider(apiKey: "")
        do {
            _ = try await provider.recommend(prompt: "Anything", candidateTitles: [], maxResults: 3)
            Issue.record("Expected missingAPIKey")
        } catch let error as AIAssistantProviderError {
            #expect(error == .missingAPIKey)
        } catch {
            Issue.record("Unexpected error: \(error)")
        }
    }

    private func makeResponse(for request: URLRequest, statusCode: Int, body: String) throws -> (HTTPURLResponse, Data) {
        guard let url = request.url else {
            throw NSError(domain: "OpenAIProviderTests", code: 1)
        }
        guard let response = HTTPURLResponse(url: url, statusCode: statusCode, httpVersion: nil, headerFields: nil) else {
            throw NSError(domain: "OpenAIProviderTests", code: 2)
        }
        return (response, Data(body.utf8))
    }
}
