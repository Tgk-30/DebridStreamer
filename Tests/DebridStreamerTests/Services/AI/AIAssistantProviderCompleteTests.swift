import Testing
import Foundation
@testable import DebridStreamer

@Suite("AIAssistantProvider complete() coverage")
struct AIAssistantProviderCompletionTests {
    @Test("OpenAI complete returns content from choices")
    func openAIProviderCompleteReturnsContent() async throws {
        let sessionID = UUID().uuidString
        let session = makeMockSession(sessionID: sessionID)

        MockURLProtocol.setHandler({ request in
            let body = """
            {
              "model": "gpt-4.1-mini",
              "choices": [
                {"message": {"content": "recommendation payload"}}
              ]
            }
            """
            return try makeResponse(for: request, statusCode: 200, body: body)
        }, for: sessionID)
        defer { MockURLProtocol.removeHandler(for: sessionID) }

        let provider = OpenAIProvider(apiKey: "test-key", session: session)
        let content = try await provider.complete(prompt: "Give me 1 sci-fi pick")

        #expect(content == "recommendation payload")
    }

    @Test("OpenAI complete propagates missing API key")
    func openAIProviderCompleteRequiresApiKey() async {
        let provider = OpenAIProvider(apiKey: "  ")

        do {
            _ = try await provider.complete(prompt: "x")
            Issue.record("Expected missing API key")
        } catch let error as AIAssistantProviderError {
            #expect(error == .missingAPIKey)
        } catch {
            Issue.record("Unexpected error: \(error)")
        }
    }

    @Test("OpenAI complete maps non-2xx responses to apiError")
    func openAIProviderCompleteMapsHTTPError() async {
        let sessionID = UUID().uuidString
        let session = makeMockSession(sessionID: sessionID)

        MockURLProtocol.setHandler({ request in
            return try makeResponse(for: request, statusCode: 500, body: "service down")
        }, for: sessionID)
        defer { MockURLProtocol.removeHandler(for: sessionID) }

        let provider = OpenAIProvider(apiKey: "test-key", session: session)

        do {
            _ = try await provider.complete(prompt: "x")
            Issue.record("Expected API error")
        } catch let error as AIAssistantProviderError {
            #expect(error == .apiError("service down"))
        } catch {
            Issue.record("Unexpected error: \(error)")
        }
    }

    @Test("Anthropic complete returns first text block")
    func anthropicProviderCompleteReturnsText() async throws {
        let sessionID = UUID().uuidString
        let session = makeMockSession(sessionID: sessionID)

        MockURLProtocol.setHandler({ request in
            let body = """
            {
              "model": "claude-haiku",
              "content": [
                {"type": "text", "text": "ok"},
                {"type": "tool_use", "name": "ignored"}
              ]
            }
            """
            return try makeResponse(for: request, statusCode: 200, body: body)
        }, for: sessionID)
        defer { MockURLProtocol.removeHandler(for: sessionID) }

        let provider = AnthropicProvider(apiKey: "test-key", session: session)
        let content = try await provider.complete(prompt: "Genre filter")

        #expect(content == "ok")
    }

    @Test("Anthropic complete rejects responses with no text")
    func anthropicProviderCompleteRejectsInvalidPayload() async {
        let sessionID = UUID().uuidString
        let session = makeMockSession(sessionID: sessionID)

        MockURLProtocol.setHandler({ request in
            let body = "{\"content\": []}"
            return try makeResponse(for: request, statusCode: 200, body: body)
        }, for: sessionID)
        defer { MockURLProtocol.removeHandler(for: sessionID) }

        let provider = AnthropicProvider(apiKey: "test-key", session: session)

        do {
            _ = try await provider.complete(prompt: "x")
            Issue.record("Expected invalidResponse")
        } catch let error as AIAssistantProviderError {
            #expect(error == .invalidResponse)
        } catch {
            Issue.record("Unexpected error: \(error)")
        }
    }

    @Test("Ollama complete returns raw assistant text")
    func ollamaProviderCompleteReturnsContent() async throws {
        let sessionID = UUID().uuidString
        let session = makeMockSession(sessionID: sessionID)

        MockURLProtocol.setHandler({ request in
            let body = """
            {
              "message": {"role": "assistant", "content": "raw-result"}
            }
            """
            return try makeResponse(for: request, statusCode: 200, body: body)
        }, for: sessionID)
        defer { MockURLProtocol.removeHandler(for: sessionID) }

        let provider = OllamaProvider(endpoint: URL(string: "http://localhost:11434/api/chat")!, session: session)
        let content = try await provider.complete(prompt: "list top 1")

        #expect(content == "raw-result")
    }

    @Test("Ollama complete rejects missing message payload")
    func ollamaProviderCompleteRejectsMissingMessage() async {
        let sessionID = UUID().uuidString
        let session = makeMockSession(sessionID: sessionID)

        MockURLProtocol.setHandler({ request in
            return try makeResponse(for: request, statusCode: 200, body: "{}")
        }, for: sessionID)
        defer { MockURLProtocol.removeHandler(for: sessionID) }

        let provider = OllamaProvider(endpoint: URL(string: "http://localhost:11434/api/chat")!, session: session)

        do {
            _ = try await provider.complete(prompt: "x")
            Issue.record("Expected invalidResponse")
        } catch let error as AIAssistantProviderError {
            #expect(error == .invalidResponse)
        } catch {
            Issue.record("Unexpected error: \(error)")
        }
    }

    @Test("Protocol default complete returns rawText and empties missing values")
    func defaultImplementationFallsBackWhenRawTextMissing() async throws {
        let provider = StubDefaultProvider(rawText: "recommendation payload")
        let first = try await provider.complete(prompt: "x")
        #expect(first == "recommendation payload")

        let empty = try await StubDefaultProvider(rawText: nil).complete(prompt: "x")
        #expect(empty == "")
    }
}

private struct StubDefaultProvider: AIAssistantProvider {
    let kind: AIProviderKind = .openAI
    let rawText: String?

    func recommend(prompt: String, candidateTitles: [String], maxResults: Int) async throws -> AIProviderRecommendationResult {
        return AIProviderRecommendationResult(
            model: "stub",
            recommendations: [],
            rawText: rawText,
            usage: nil
        )
    }
}

private func makeResponse(for request: URLRequest, statusCode: Int, body: String) throws -> (HTTPURLResponse, Data) {
    guard let url = request.url else {
        throw NSError(domain: "AIAssistantProviderCompleteTests", code: 1)
    }
    guard let response = HTTPURLResponse(
        url: url,
        statusCode: statusCode,
        httpVersion: nil,
        headerFields: nil
    ) else {
        throw NSError(domain: "AIAssistantProviderCompleteTests", code: 2)
    }
    return (response, Data(body.utf8))
}
