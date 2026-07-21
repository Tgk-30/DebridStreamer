import Testing
import Foundation
@testable import DebridStreamer

@Suite("AIModelCatalogService Tests")
struct AIModelCatalogServiceTests {
    @Test("Fetches OpenAI model IDs from data array")
    func fetchOpenAIModels() async throws {
        let sessionID = UUID().uuidString
        let session = makeMockSession(sessionID: sessionID)

        MockURLProtocol.setHandler({ request in
            #expect(request.url?.absoluteString == "https://api.openai.com/v1/models")
            #expect(request.value(forHTTPHeaderField: "Authorization")?.hasPrefix("Bearer ") == true)

            let body = """
            {
              "data": [
                {"id":"gpt-4o-mini"},
                {"id":"gpt-4.1"},
                {"id":"text-embedding-3-large"},
                {"id":"o3-mini"}
              ]
            }
            """
            return try makeResponse(for: request, statusCode: 200, body: body)
        }, for: sessionID)
        defer { MockURLProtocol.removeHandler(for: sessionID) }

        let service = AIModelCatalogService(session: session)
        let models = try await service.fetchOpenAIModelIDs(apiKey: "test-openai")

        #expect(models.contains("gpt-4o-mini"))
        #expect(models.contains("gpt-4.1"))
        #expect(models.contains("o3-mini"))
        #expect(models.contains("text-embedding-3-large") == false)
    }

    @Test("Caches OpenAI catalog and deduplicates sorted results")
    func openAICachesDeduplicatedResults() async throws {
        let sessionID = UUID().uuidString
        let session = makeMockSession(sessionID: sessionID)
        var callCount = 0

        MockURLProtocol.setHandler({ request in
            callCount += 1
            let body = """
            {
              "data": {
                "models": [
                  {"id":"gpt-4o-mini"},
                  {"id":"gpt-4o-mini"},
                  {"id":" gpt-4.1 "},
                  {"id":"text-embedding-3-large"}
                ]
              }
            }
            """
            return try makeResponse(for: request, statusCode: 200, body: body)
        }, for: sessionID)
        defer { MockURLProtocol.removeHandler(for: sessionID) }

        let service = AIModelCatalogService(session: session)

        let first = try await service.fetchOpenAIModelIDs(apiKey: "test-openai")
        #expect(callCount == 1)
        #expect(first == ["gpt-4o-mini", "gpt-4.1"])

        let second = try await service.fetchOpenAIModelIDs(apiKey: "test-openai")
        #expect(callCount == 1)
        #expect(second == first)
    }

    @Test("Fetches Anthropic model IDs from models array")
    func fetchAnthropicModels() async throws {
        let sessionID = UUID().uuidString
        let session = makeMockSession(sessionID: sessionID)

        MockURLProtocol.setHandler({ request in
            #expect(request.url?.absoluteString == "https://api.anthropic.com/v1/models")
            #expect(request.value(forHTTPHeaderField: "x-api-key") == "test-anthropic")

            let body = """
            {
              "models": [
                {"id":"claude-3-5-haiku-latest"},
                {"id":"claude-sonnet-4-0"},
                {"id":"some-other-model"}
              ]
            }
            """
            return try makeResponse(for: request, statusCode: 200, body: body)
        }, for: sessionID)
        defer { MockURLProtocol.removeHandler(for: sessionID) }

        let service = AIModelCatalogService(session: session)
        let models = try await service.fetchAnthropicModelIDs(apiKey: "test-anthropic")

        #expect(models.contains("claude-3-5-haiku-latest"))
        #expect(models.contains("claude-sonnet-4-0"))
        #expect(models.contains("some-other-model") == false)
    }

    @Test("Anthropic catalog non-2xx response throws requestFailed")
    func fetchAnthropicNon2xxThrows() async {
        let sessionID = UUID().uuidString
        let session = makeMockSession(sessionID: sessionID)

        MockURLProtocol.setHandler({ request in
            #expect(request.url?.absoluteString == "https://api.anthropic.com/v1/models")
            return try makeResponse(for: request, statusCode: 503, body: "unavailable")
        }, for: sessionID)
        defer { MockURLProtocol.removeHandler(for: sessionID) }

        let service = AIModelCatalogService(session: session)

        do {
            _ = try await service.fetchAnthropicModelIDs(apiKey: "test-anthropic")
            Issue.record("Expected requestFailed")
        } catch let error as AIModelCatalogServiceError {
            #expect(error == .requestFailed(provider: "Anthropic", statusCode: 503))
        } catch {
            Issue.record("Unexpected error: \(error)")
        }
    }

    @Test("Invalid catalog payload throws decodingFailed")
    func decodingFailureThrows() async {
        let sessionID = UUID().uuidString
        let session = makeMockSession(sessionID: sessionID)

        MockURLProtocol.setHandler({ request in
            let body = """
            {
              "status": "ok"
            }
            """
            return try makeResponse(for: request, statusCode: 200, body: body)
        }, for: sessionID)
        defer { MockURLProtocol.removeHandler(for: sessionID) }

        let service = AIModelCatalogService(session: session)

        do {
            _ = try await service.fetchOpenAIModelIDs(apiKey: "test-openai")
            Issue.record("Expected decodingFailed")
        } catch let error as AIModelCatalogServiceError {
            #expect(error == .decodingFailed(provider: "AI"))
        } catch {
            Issue.record("Unexpected error: \(error)")
        }
    }

    @Test("Error descriptions are descriptive")
    func errorDescriptionsAreInformative() {
        #expect((AIModelCatalogServiceError.missingAPIKey(provider: "OpenAI").errorDescription ?? "").contains("API key is required"))
        #expect((AIModelCatalogServiceError.invalidResponse(provider: "OpenAI").errorDescription ?? "").contains("Invalid OpenAI response"))
        #expect((AIModelCatalogServiceError.requestFailed(provider: "Anthropic", statusCode: 401).errorDescription ?? "").contains("request failed with status 401"))
        #expect((AIModelCatalogServiceError.decodingFailed(provider: "AI").errorDescription ?? "").contains("Unable to decode"))
    }

    @Test("Non-2xx responses surface request failure")
    func nonSuccessStatusThrows() async {
        let sessionID = UUID().uuidString
        let session = makeMockSession(sessionID: sessionID)

        MockURLProtocol.setHandler({ request in
            try makeResponse(for: request, statusCode: 401, body: "{\"error\":\"unauthorized\"}")
        }, for: sessionID)
        defer { MockURLProtocol.removeHandler(for: sessionID) }

        let service = AIModelCatalogService(session: session)

        do {
            _ = try await service.fetchOpenAIModelIDs(apiKey: "bad-key")
            Issue.record("Expected requestFailed error")
        } catch let error as AIModelCatalogServiceError {
            #expect(error == .requestFailed(provider: "OpenAI", statusCode: 401))
        } catch {
            Issue.record("Unexpected error: \(error)")
        }
    }

    @Test("Missing API key throws missingAPIKey")
    func missingKeyThrows() async {
        let service = AIModelCatalogService()
        do {
            _ = try await service.fetchAnthropicModelIDs(apiKey: "   ")
            Issue.record("Expected missingAPIKey")
        } catch let error as AIModelCatalogServiceError {
            #expect(error == .missingAPIKey(provider: "Anthropic"))
        } catch {
            Issue.record("Unexpected error: \(error)")
        }
    }

    private func makeResponse(for request: URLRequest, statusCode: Int, body: String) throws -> (HTTPURLResponse, Data) {
        guard let url = request.url else {
            throw NSError(domain: "AIModelCatalogServiceTests", code: 1)
        }
        guard let response = HTTPURLResponse(url: url, statusCode: statusCode, httpVersion: nil, headerFields: nil) else {
            throw NSError(domain: "AIModelCatalogServiceTests", code: 2)
        }
        return (response, Data(body.utf8))
    }
}
