import Testing
import Foundation
@testable import DebridStreamer

@Suite("TorBox Service Tests")
struct TorBoxServiceTests {
    @Test("checkCache lowercases requests and normalizes response keys")
    func checkCacheNormalizesHashes() async throws {
        let sessionID = UUID().uuidString
        let session = makeMockSession(sessionID: sessionID)

        MockURLProtocol.setHandler({ request in
            #expect(request.url?.query?.contains("hash=abcdef%2C123456") == true
                || request.url?.query?.contains("hash=abcdef,123456") == true)
            #expect(request.url?.query?.contains("format=object") == true)
            return try makeResponse(
                for: request,
                body: #"{"success":true,"data":{"ABCDEF":{"name":"Movie"}}}"#
            )
        }, for: sessionID)
        defer { MockURLProtocol.removeHandler(for: sessionID) }

        let service = TorBoxService(apiToken: "tb-token", session: session)
        let result = try await service.checkCache(hashes: ["ABCDEF", "123456"])

        #expect(result["abcdef"] == .cached(fileId: nil, fileName: nil, fileSize: nil))
        #expect(result["123456"] == .notCached)
    }

    @Test("checkCache treats null and array data as definitive misses", arguments: ["null", "[]"])
    func checkCacheDefinitiveMisses(dataShape: String) async throws {
        let sessionID = UUID().uuidString
        let session = makeMockSession(sessionID: sessionID)

        MockURLProtocol.setHandler({ request in
            try makeResponse(
                for: request,
                body: "{\"success\":true,\"data\":\(dataShape)}"
            )
        }, for: sessionID)
        defer { MockURLProtocol.removeHandler(for: sessionID) }

        let service = TorBoxService(apiToken: "tb-token", session: session)
        let result = try await service.checkCache(hashes: ["AAA", "BBB"])

        #expect(result["aaa"] == .notCached)
        #expect(result["bbb"] == .notCached)
    }

    @Test("checkCache leaves a failed envelope unavailable")
    func checkCacheFailureIsUnavailable() async throws {
        let sessionID = UUID().uuidString
        let session = makeMockSession(sessionID: sessionID)

        MockURLProtocol.setHandler({ request in
            try makeResponse(
                for: request,
                body: #"{"success":false,"error":"RATE_LIMIT","data":null}"#
            )
        }, for: sessionID)
        defer { MockURLProtocol.removeHandler(for: sessionID) }

        let service = TorBoxService(apiToken: "tb-token", session: session)
        let result = try await service.checkCache(hashes: ["AAA"])

        #expect(result.isEmpty)
    }
}

private func makeResponse(
    for request: URLRequest,
    body: String
) throws -> (HTTPURLResponse, Data) {
    let response = try #require(HTTPURLResponse(
        url: request.url ?? URL(string: "https://api.torbox.app")!,
        statusCode: 200,
        httpVersion: nil,
        headerFields: ["Content-Type": "application/json"]
    ))
    return (response, Data(body.utf8))
}
