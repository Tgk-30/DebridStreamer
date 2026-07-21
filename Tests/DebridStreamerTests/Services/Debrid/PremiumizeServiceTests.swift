import Testing
import Foundation
@testable import DebridStreamer

@Suite("Premiumize Service Tests")
struct PremiumizeServiceTests {

    // MARK: - getStreamURL

    @Test("getStreamURL parses metadata and uses the direct link as the stream URL")
    func getStreamURLParsesStreamInfo() async throws {
        let sessionID = UUID().uuidString
        let session = makeMockSession(sessionID: sessionID)

        MockURLProtocol.setHandler({ request in
            switch request.url?.path ?? "" {
            case "/api/transfer/directdl":
                // Non-empty content[] on the first read, so the poll loop breaks
                // immediately and never sleeps.
                let body = """
                {"content":[
                  {"link":"https://pm.example/sample.mkv","path":"Movie/sample.mkv","size":500000},
                  {"link":"https://pm.example/movie.mkv","path":"Movie/Movie.2026.1080p.BluRay.x264.mkv","size":4000000000}
                ]}
                """
                return try pmMakeResponse(for: request, statusCode: 200, body: body)
            default:
                return try pmMakeResponse(for: request, statusCode: 404, body: "{}")
            }
        }, for: sessionID)
        defer { MockURLProtocol.removeHandler(for: sessionID) }

        let service = PremiumizeService(apiToken: "pm-token", session: session)
        let stream = try await service.getStreamURL(torrentId: "transfer123")

        // Premiumize streams the directdl link verbatim (no separate unrestrict).
        #expect(stream.streamURL == "https://pm.example/movie.mkv")
        // fileName is the lastPathComponent of the selected path.
        #expect(stream.fileName == "Movie.2026.1080p.BluRay.x264.mkv")
        #expect(stream.quality == .hd1080p)
        #expect(stream.codec == .h264)
        #expect(stream.source == .bluray)
        #expect(stream.sizeBytes == 4_000_000_000)
        #expect(stream.debridService == "PM")
    }

    @Test("getStreamURL throws noFilesAvailable when content has no playable link")
    func getStreamURLThrowsWhenNoUsableLink() async throws {
        let sessionID = UUID().uuidString
        let session = makeMockSession(sessionID: sessionID)

        MockURLProtocol.setHandler({ request in
            // Content is non-empty (loop breaks immediately, no sleep) but no item
            // carries a "link", so no candidate can be built.
            let body = #"{"content":[{"path":"file.mkv","size":1234}]}"#
            return try pmMakeResponse(for: request, statusCode: 200, body: body)
        }, for: sessionID)
        defer { MockURLProtocol.removeHandler(for: sessionID) }

        let service = PremiumizeService(apiToken: "pm-token", session: session)

        await #expect(throws: DebridError.noFilesAvailable) {
            _ = try await service.getStreamURL(torrentId: "nolink")
        }
    }

    @Test("getStreamURL sends src_id without leaking credentials in the query")
    func getStreamURLSendsSrcID() async throws {
        let sessionID = UUID().uuidString
        let session = makeMockSession(sessionID: sessionID)
        var directBody = ""
        var directQuery: String?

        MockURLProtocol.setHandler({ request in
            directBody = pmRequestBody(from: request)
            directQuery = request.url?.query
            let body = #"{"content":[{"link":"https://pm.example/f.mkv","path":"f.mkv","size":10}]}"#
            return try pmMakeResponse(for: request, statusCode: 200, body: body)
        }, for: sessionID)
        defer { MockURLProtocol.removeHandler(for: sessionID) }

        let service = PremiumizeService(apiToken: "pm-token", session: session)
        _ = try await service.getStreamURL(torrentId: "transfer123")

        #expect(directBody.contains("src_id=transfer123"))
        #expect(directQuery?.contains("apikey=") != true)
    }

    @Test("addMagnet posts body and returns transfer id")
    func addMagnetPostsAndReturnsId() async throws {
        let sessionID = UUID().uuidString
        let session = makeMockSession(sessionID: sessionID)
        var seenMethod = ""
        var seenAuth = ""
        var seenApiKey = ""
        var seenBody = ""

        MockURLProtocol.setHandler({ request in
            seenMethod = request.httpMethod ?? ""
            seenAuth = request.value(forHTTPHeaderField: "Authorization") ?? ""
            seenApiKey = request.value(forHTTPHeaderField: "X-API-Key") ?? ""
            seenBody = pmRequestBody(from: request)

            let body = #"{"id":"pm-transfer-123"}"#
            return try pmMakeResponse(for: request, statusCode: 200, body: body)
        }, for: sessionID)
        defer { MockURLProtocol.removeHandler(for: sessionID) }

        let service = PremiumizeService(apiToken: "pm-token", session: session)
        let transferId = try await service.addMagnet(hash: "ABCDEF")

        #expect(seenMethod == "POST")
        #expect(seenAuth == "Bearer pm-token")
        #expect(seenApiKey == "pm-token")
        #expect(seenBody.contains("src=magnet:?xt=urn:btih:ABCDEF"))
        #expect(seenBody.contains("apikey=pm-token"))
        #expect(transferId == "pm-transfer-123")
    }

    @Test("addMagnet throws downloadFailed when response is malformed")
    func addMagnetThrowsOnMalformedResponse() async {
        let sessionID = UUID().uuidString
        let session = makeMockSession(sessionID: sessionID)

        MockURLProtocol.setHandler({ request in
            let body = #"{"data":{"id":"pm-transfer-123"}}"#
            return try pmMakeResponse(for: request, statusCode: 200, body: body)
        }, for: sessionID)
        defer { MockURLProtocol.removeHandler(for: sessionID) }

        let service = PremiumizeService(apiToken: "pm-token", session: session)

        do {
            _ = try await service.addMagnet(hash: "ABCDEF")
            Issue.record("Expected addMagnet malformed response failure")
        } catch let error as DebridError {
            guard case .downloadFailed = error else {
                Issue.record("Expected .downloadFailed, got \(error)")
                return
            }
        } catch {
            Issue.record("Expected DebridError, got \(error)")
        }
    }

    // MARK: - checkCache

    @Test("checkCache maps response flags to cached/notCached with filename and size")
    func checkCacheMapsResponseArrays() async throws {
        let sessionID = UUID().uuidString
        let session = makeMockSession(sessionID: sessionID)
        var capturedMethod: String?
        var capturedBody = ""
        var capturedQuery: String?

        MockURLProtocol.setHandler({ request in
            capturedMethod = request.httpMethod
            capturedBody = pmRequestBody(from: request)
            capturedQuery = request.url?.query
            let body = """
            {"response":[true,false],
             "filename":["Cached.Movie.mkv",null],
             "filesize":[123456789,null]}
            """
            return try pmMakeResponse(for: request, statusCode: 200, body: body)
        }, for: sessionID)
        defer { MockURLProtocol.removeHandler(for: sessionID) }

        let service = PremiumizeService(apiToken: "pm-token", session: session)
        let result = try await service.checkCache(hashes: ["HASHCACHED", "HASHMISS"])

        #expect(result["hashcached"] == .cached(fileId: nil, fileName: "Cached.Movie.mkv", fileSize: 123_456_789))
        #expect(result["hashcached"]?.isCached == true)
        #expect(result["hashmiss"] == .notCached)
        #expect(result["hashmiss"]?.isCached == false)
        #expect(capturedMethod == "POST")
        #expect(capturedQuery == nil)
        #expect(capturedBody.contains("items[]=HASHCACHED"))
        #expect(capturedBody.contains("items[]=HASHMISS"))
        #expect(capturedBody.contains("apikey=pm-token"))
    }

    @Test("checkCache short-circuits to empty for empty input without hitting network")
    func checkCacheEmptyInput() async throws {
        let sessionID = UUID().uuidString
        let session = makeMockSession(sessionID: sessionID)
        var didCallNetwork = false

        MockURLProtocol.setHandler({ request in
            didCallNetwork = true
            return try pmMakeResponse(for: request, statusCode: 200, body: "{}")
        }, for: sessionID)
        defer { MockURLProtocol.removeHandler(for: sessionID) }

        let service = PremiumizeService(apiToken: "pm-token", session: session)
        let result = try await service.checkCache(hashes: [])

        #expect(result.isEmpty)
        #expect(didCallNetwork == false)
    }

    // MARK: - getAccountInfo

    @Test("getAccountInfo treats a present premium_until as premium")
    func getAccountInfoDecodesPremium() async throws {
        let sessionID = UUID().uuidString
        let session = makeMockSession(sessionID: sessionID)

        MockURLProtocol.setHandler({ request in
            let body = #"{"customer_id":"pm-user","premium_until":1700000000}"#
            return try pmMakeResponse(for: request, statusCode: 200, body: body)
        }, for: sessionID)
        defer { MockURLProtocol.removeHandler(for: sessionID) }

        let service = PremiumizeService(apiToken: "pm-token", session: session)
        let info = try await service.getAccountInfo()

        #expect(info.username == "pm-user")
        #expect(info.email == nil)
        #expect(info.isPremium == true)
        #expect(info.premiumExpiry == Date(timeIntervalSince1970: 1_700_000_000))
    }

    @Test("getAccountInfo treats a missing premium_until as non-premium")
    func getAccountInfoDecodesNonPremium() async throws {
        let sessionID = UUID().uuidString
        let session = makeMockSession(sessionID: sessionID)

        MockURLProtocol.setHandler({ request in
            let body = #"{"customer_id":"free-user"}"#
            return try pmMakeResponse(for: request, statusCode: 200, body: body)
        }, for: sessionID)
        defer { MockURLProtocol.removeHandler(for: sessionID) }

        let service = PremiumizeService(apiToken: "pm-token", session: session)
        let info = try await service.getAccountInfo()

        #expect(info.username == "free-user")
        #expect(info.isPremium == false)
        #expect(info.premiumExpiry == nil)
    }

    @Test("getAccountInfo maps HTTP 401 to invalidToken")
    func getAccountInfoMaps401ToInvalidToken() async throws {
        let sessionID = UUID().uuidString
        let session = makeMockSession(sessionID: sessionID)

        MockURLProtocol.setHandler({ request in
            return try pmMakeResponse(for: request, statusCode: 401, body: #"{"error":"unauthorized"}"#)
        }, for: sessionID)
        defer { MockURLProtocol.removeHandler(for: sessionID) }

        let service = PremiumizeService(apiToken: "bad-token", session: session)

        await #expect(throws: DebridError.invalidToken) {
            _ = try await service.getAccountInfo()
        }
    }

    @Test("getAccountInfo maps a non-401 HTTP error to httpError")
    func getAccountInfoMapsServerErrorToHTTPError() async throws {
        let sessionID = UUID().uuidString
        let session = makeMockSession(sessionID: sessionID)

        MockURLProtocol.setHandler({ request in
            return try pmMakeResponse(for: request, statusCode: 503, body: "down")
        }, for: sessionID)
        defer { MockURLProtocol.removeHandler(for: sessionID) }

        let service = PremiumizeService(apiToken: "pm-token", session: session)

        await #expect(throws: DebridError.httpError(503, "down")) {
            _ = try await service.getAccountInfo()
        }
    }

    // MARK: - unrestrict

    @Test("unrestrict returns the link verbatim as a URL")
    func unrestrictReturnsLinkVerbatim() async throws {
        let service = PremiumizeService(apiToken: "pm-token", session: makeMockSession())
        let url = try await service.unrestrict(link: "https://pm.example/direct/file.mkv")
        #expect(url.absoluteString == "https://pm.example/direct/file.mkv")
    }

    // MARK: - validateToken

    @Test("validateToken returns true for a healthy account and false on 401")
    func validateTokenReflectsAccountHealth() async throws {
        let okSessionID = UUID().uuidString
        let okSession = makeMockSession(sessionID: okSessionID)
        MockURLProtocol.setHandler({ request in
            let body = #"{"customer_id":"ok","premium_until":1700000000}"#
            return try pmMakeResponse(for: request, statusCode: 200, body: body)
        }, for: okSessionID)
        defer { MockURLProtocol.removeHandler(for: okSessionID) }

        let okService = PremiumizeService(apiToken: "good", session: okSession)
        let okResult = try await okService.validateToken()
        #expect(okResult == true)

        let badSessionID = UUID().uuidString
        let badSession = makeMockSession(sessionID: badSessionID)
        MockURLProtocol.setHandler({ request in
            return try pmMakeResponse(for: request, statusCode: 401, body: "{}")
        }, for: badSessionID)
        defer { MockURLProtocol.removeHandler(for: badSessionID) }

        let badService = PremiumizeService(apiToken: "bad", session: badSession)
        let badResult = try await badService.validateToken()
        #expect(badResult == false)
    }

    // MARK: - serviceType

    @Test("serviceType is premiumize")
    func serviceTypeIsPremiumize() async {
        let service = PremiumizeService(apiToken: "pm-token", session: makeMockSession())
        #expect(await service.serviceType == .premiumize)
    }
}

// MARK: - fileprivate helpers

private func pmMakeResponse(for request: URLRequest, statusCode: Int, body: String) throws -> (HTTPURLResponse, Data) {
    guard let url = request.url else {
        throw NSError(domain: "PremiumizeServiceTests", code: 1)
    }
    guard let response = HTTPURLResponse(
        url: url,
        statusCode: statusCode,
        httpVersion: nil,
        headerFields: nil
    ) else {
        throw NSError(domain: "PremiumizeServiceTests", code: 2)
    }
    return (response, Data(body.utf8))
}

private func pmRequestBody(from request: URLRequest) -> String {
    if let body = request.httpBody {
        return String(data: body, encoding: .utf8) ?? ""
    }
    guard let stream = request.httpBodyStream else { return "" }
    stream.open()
    defer { stream.close() }
    let bufferSize = 1024
    var data = Data()
    var buffer = [UInt8](repeating: 0, count: bufferSize)
    while stream.hasBytesAvailable {
        let read = stream.read(&buffer, maxLength: bufferSize)
        guard read > 0 else { break }
        data.append(buffer, count: read)
    }
    return String(data: data, encoding: .utf8) ?? ""
}
