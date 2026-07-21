import Testing
import Foundation
@testable import DebridStreamer

@Suite("AllDebrid Service Tests")
struct AllDebridServiceTests {

    // MARK: - getStreamURL

    @Test("getStreamURL parses quality/codec/source from the selected filename")
    func getStreamURLParsesStreamInfo() async throws {
        let sessionID = UUID().uuidString
        let session = makeMockSession(sessionID: sessionID)

        MockURLProtocol.setHandler({ request in
            switch request.url?.path ?? "" {
            case "/v4/magnet/status":
                // Status is "Ready" on the first read, so the poll loop breaks
                // immediately and never sleeps.
                let body = """
                {"data":{"magnets":{"status":"Ready","links":[
                  {"link":"https://ad.example/sample.mkv","filename":"Movie.2026.sample.mkv","size":500000},
                  {"link":"https://ad.example/movie.mkv","filename":"Movie.2026.1080p.BluRay.x264.mkv","size":4000000000}
                ]}}}
                """
                return try adMakeResponse(for: request, statusCode: 200, body: body)
            case "/v4/link/unlock":
                let body = #"{"data":{"link":"https://ad.example/direct/movie.mkv"}}"#
                return try adMakeResponse(for: request, statusCode: 200, body: body)
            default:
                return try adMakeResponse(for: request, statusCode: 404, body: "{}")
            }
        }, for: sessionID)
        defer { MockURLProtocol.removeHandler(for: sessionID) }

        let service = AllDebridService(apiToken: "ad-token", session: session)
        let stream = try await service.getStreamURL(torrentId: "abc123")

        #expect(stream.streamURL == "https://ad.example/direct/movie.mkv")
        #expect(stream.fileName == "Movie.2026.1080p.BluRay.x264.mkv")
        #expect(stream.quality == .hd1080p)
        #expect(stream.codec == .h264)
        #expect(stream.source == .bluray)
        #expect(stream.sizeBytes == 4_000_000_000)
        #expect(stream.debridService == "AD")
    }

    @Test("getStreamURL unlocks the best link and uses its direct URL")
    func getStreamURLUnlocksBestLink() async throws {
        let sessionID = UUID().uuidString
        let session = makeMockSession(sessionID: sessionID)
        var unlockBody = ""

        MockURLProtocol.setHandler({ request in
            switch request.url?.path ?? "" {
            case "/v4/magnet/status":
                let body = """
                {"data":{"magnets":{"status":"Ready","links":[
                  {"link":"https://ad.example/best.mp4","filename":"Show.S01E01.720p.WEB-DL.x265.mp4","size":1500000000}
                ]}}}
                """
                return try adMakeResponse(for: request, statusCode: 200, body: body)
            case "/v4/link/unlock":
                unlockBody = adRequestBody(from: request)
                let body = #"{"data":{"link":"https://ad.example/direct/best.mp4"}}"#
                return try adMakeResponse(for: request, statusCode: 200, body: body)
            default:
                return try adMakeResponse(for: request, statusCode: 404, body: "{}")
            }
        }, for: sessionID)
        defer { MockURLProtocol.removeHandler(for: sessionID) }

        let service = AllDebridService(apiToken: "ad-token", session: session)
        let stream = try await service.getStreamURL(torrentId: "xyz")

        // The unlock call carries the selected (encoded) source link.
        #expect(unlockBody.contains("link="))
        #expect(unlockBody.contains("best.mp4"))
        #expect(stream.streamURL == "https://ad.example/direct/best.mp4")
        #expect(stream.codec == .h265)
        #expect(stream.source == .webDL)
    }

    @Test("getStreamURL throws torrentNotFound when status payload is malformed")
    func getStreamURLThrowsWhenStatusMalformed() async throws {
        let sessionID = UUID().uuidString
        let session = makeMockSession(sessionID: sessionID)

        MockURLProtocol.setHandler({ request in
            // Missing data.magnets -> torrentNotFound on the first read.
            return try adMakeResponse(for: request, statusCode: 200, body: #"{"data":{}}"#)
        }, for: sessionID)
        defer { MockURLProtocol.removeHandler(for: sessionID) }

        let service = AllDebridService(apiToken: "ad-token", session: session)

        await #expect(throws: DebridError.torrentNotFound("nope")) {
            _ = try await service.getStreamURL(torrentId: "nope")
        }
    }

    @Test("getStreamURL throws downloadFailed on a terminal Error status")
    func getStreamURLThrowsOnErrorStatus() async throws {
        let sessionID = UUID().uuidString
        let session = makeMockSession(sessionID: sessionID)

        MockURLProtocol.setHandler({ request in
            // "Error" is a terminal state - the loop stops immediately, no sleep.
            let body = #"{"data":{"magnets":{"status":"Error","links":[]}}}"#
            return try adMakeResponse(for: request, statusCode: 200, body: body)
        }, for: sessionID)
        defer { MockURLProtocol.removeHandler(for: sessionID) }

        let service = AllDebridService(apiToken: "ad-token", session: session)

        await #expect(throws: DebridError.self) {
            _ = try await service.getStreamURL(torrentId: "boom")
        }
    }

    @Test("getStreamURL throws noFilesAvailable when Ready but links are missing")
    func getStreamURLThrowsWhenNoLinks() async throws {
        let sessionID = UUID().uuidString
        let session = makeMockSession(sessionID: sessionID)

        MockURLProtocol.setHandler({ request in
            // Ready, but no "links" key at all -> noFilesAvailable.
            let body = #"{"data":{"magnets":{"status":"Ready"}}}"#
            return try adMakeResponse(for: request, statusCode: 200, body: body)
        }, for: sessionID)
        defer { MockURLProtocol.removeHandler(for: sessionID) }

        let service = AllDebridService(apiToken: "ad-token", session: session)

        await #expect(throws: DebridError.noFilesAvailable) {
            _ = try await service.getStreamURL(torrentId: "empty")
        }
    }

    // MARK: - checkCache

    @Test("checkCache maps instant flags to cached/notCached keyed by lowercased hash")
    func checkCacheMapsInstantFlags() async throws {
        let sessionID = UUID().uuidString
        let session = makeMockSession(sessionID: sessionID)

        MockURLProtocol.setHandler({ request in
            let body = """
            {"data":{"magnets":[
              {"hash":"ABCDEF","instant":true},
              {"hash":"123456","instant":false}
            ]}}
            """
            return try adMakeResponse(for: request, statusCode: 200, body: body)
        }, for: sessionID)
        defer { MockURLProtocol.removeHandler(for: sessionID) }

        let service = AllDebridService(apiToken: "ad-token", session: session)
        let result = try await service.checkCache(hashes: ["ABCDEF", "123456"])

        #expect(result["abcdef"] == .cached(fileId: nil, fileName: nil, fileSize: nil))
        #expect(result["abcdef"]?.isCached == true)
        #expect(result["123456"] == .notCached)
        #expect(result["123456"]?.isCached == false)
    }

    @Test("checkCache short-circuits to empty for empty input without hitting network")
    func checkCacheEmptyInput() async throws {
        let sessionID = UUID().uuidString
        let session = makeMockSession(sessionID: sessionID)
        var didCallNetwork = false

        MockURLProtocol.setHandler({ request in
            didCallNetwork = true
            return try adMakeResponse(for: request, statusCode: 200, body: "{}")
        }, for: sessionID)
        defer { MockURLProtocol.removeHandler(for: sessionID) }

        let service = AllDebridService(apiToken: "ad-token", session: session)
        let result = try await service.checkCache(hashes: [])

        #expect(result.isEmpty)
        #expect(didCallNetwork == false)
    }

    // MARK: - getAccountInfo

    @Test("getAccountInfo decodes username, email, isPremium and premium expiry")
    func getAccountInfoDecodesPremium() async throws {
        let sessionID = UUID().uuidString
        let session = makeMockSession(sessionID: sessionID)

        MockURLProtocol.setHandler({ request in
            let body = """
            {"data":{"user":{"username":"ad-user","email":"ad@example.com","isPremium":true,"premiumUntil":1700000000}}}
            """
            return try adMakeResponse(for: request, statusCode: 200, body: body)
        }, for: sessionID)
        defer { MockURLProtocol.removeHandler(for: sessionID) }

        let service = AllDebridService(apiToken: "ad-token", session: session)
        let info = try await service.getAccountInfo()

        #expect(info.username == "ad-user")
        #expect(info.email == "ad@example.com")
        #expect(info.isPremium == true)
        #expect(info.premiumExpiry == Date(timeIntervalSince1970: 1_700_000_000))
    }

    @Test("getAccountInfo decodes a non-premium account with defaults")
    func getAccountInfoDecodesNonPremium() async throws {
        let sessionID = UUID().uuidString
        let session = makeMockSession(sessionID: sessionID)

        MockURLProtocol.setHandler({ request in
            // No isPremium / premiumUntil / email -> defaults.
            let body = #"{"data":{"user":{"username":"free-user"}}}"#
            return try adMakeResponse(for: request, statusCode: 200, body: body)
        }, for: sessionID)
        defer { MockURLProtocol.removeHandler(for: sessionID) }

        let service = AllDebridService(apiToken: "ad-token", session: session)
        let info = try await service.getAccountInfo()

        #expect(info.username == "free-user")
        #expect(info.email == nil)
        #expect(info.isPremium == false)
        #expect(info.premiumExpiry == nil)
    }

    @Test("getAccountInfo throws invalidToken when the user object is missing")
    func getAccountInfoThrowsInvalidTokenOnMalformedBody() async throws {
        let sessionID = UUID().uuidString
        let session = makeMockSession(sessionID: sessionID)

        MockURLProtocol.setHandler({ request in
            return try adMakeResponse(for: request, statusCode: 200, body: #"{"data":{}}"#)
        }, for: sessionID)
        defer { MockURLProtocol.removeHandler(for: sessionID) }

        let service = AllDebridService(apiToken: "ad-token", session: session)

        await #expect(throws: DebridError.invalidToken) {
            _ = try await service.getAccountInfo()
        }
    }

    @Test("getAccountInfo maps HTTP 401 to invalidToken")
    func getAccountInfoMaps401ToInvalidToken() async throws {
        let sessionID = UUID().uuidString
        let session = makeMockSession(sessionID: sessionID)

        MockURLProtocol.setHandler({ request in
            return try adMakeResponse(for: request, statusCode: 401, body: #"{"error":"unauthorized"}"#)
        }, for: sessionID)
        defer { MockURLProtocol.removeHandler(for: sessionID) }

        let service = AllDebridService(apiToken: "bad-token", session: session)

        await #expect(throws: DebridError.invalidToken) {
            _ = try await service.getAccountInfo()
        }
    }

    @Test("getAccountInfo maps a non-401 HTTP error to httpError")
    func getAccountInfoMapsServerErrorToHTTPError() async throws {
        let sessionID = UUID().uuidString
        let session = makeMockSession(sessionID: sessionID)

        MockURLProtocol.setHandler({ request in
            return try adMakeResponse(for: request, statusCode: 500, body: "boom")
        }, for: sessionID)
        defer { MockURLProtocol.removeHandler(for: sessionID) }

        let service = AllDebridService(apiToken: "ad-token", session: session)

        await #expect(throws: DebridError.httpError(500, "boom")) {
            _ = try await service.getAccountInfo()
        }
    }

    // MARK: - validateToken

    @Test("validateToken returns true for a healthy account and false on 401")
    func validateTokenReflectsAccountHealth() async throws {
        // Happy path.
        let okSessionID = UUID().uuidString
        let okSession = makeMockSession(sessionID: okSessionID)
        MockURLProtocol.setHandler({ request in
            let body = #"{"data":{"user":{"username":"ok","isPremium":true}}}"#
            return try adMakeResponse(for: request, statusCode: 200, body: body)
        }, for: okSessionID)
        defer { MockURLProtocol.removeHandler(for: okSessionID) }

        let okService = AllDebridService(apiToken: "good", session: okSession)
        let okResult = try await okService.validateToken()
        #expect(okResult == true)

        // Failure path.
        let badSessionID = UUID().uuidString
        let badSession = makeMockSession(sessionID: badSessionID)
        MockURLProtocol.setHandler({ request in
            return try adMakeResponse(for: request, statusCode: 401, body: "{}")
        }, for: badSessionID)
        defer { MockURLProtocol.removeHandler(for: badSessionID) }

        let badService = AllDebridService(apiToken: "bad", session: badSession)
        let badResult = try await badService.validateToken()
        #expect(badResult == false)
    }

    // MARK: - serviceType

    @Test("serviceType is allDebrid")
    func serviceTypeIsAllDebrid() async {
        let service = AllDebridService(apiToken: "ad-token", session: makeMockSession())
        #expect(await service.serviceType == .allDebrid)
    }

    @Test("addMagnet posts body and returns torrent id")
    func addMagnetPostsAndReturnsId() async throws {
        let sessionID = UUID().uuidString
        let session = makeMockSession(sessionID: sessionID)
        var seenAuthHeader = ""
        var seenApiKeyHeader = ""
        var seenMethod = ""
        var seenPath = ""
        var seenBody = ""

        MockURLProtocol.setHandler({ request in
            seenAuthHeader = request.value(forHTTPHeaderField: "Authorization") ?? ""
            seenApiKeyHeader = request.value(forHTTPHeaderField: "X-API-Key") ?? ""
            seenMethod = request.httpMethod ?? ""
            seenPath = request.url?.path ?? ""
            seenBody = adRequestBody(from: request)
            let body = """
            {"data":{"magnets":[{"id":987654}]}}
            """
            return try adMakeResponse(for: request, statusCode: 200, body: body)
        }, for: sessionID)
        defer { MockURLProtocol.removeHandler(for: sessionID) }

        let service = AllDebridService(apiToken: "ad-token", session: session)
        let torrentId = try await service.addMagnet(hash: "123ABC")

        #expect(seenPath == "/v4/magnet/upload")
        #expect(seenMethod == "POST")
        #expect(seenAuthHeader == "Bearer ad-token")
        #expect(seenApiKeyHeader == "ad-token")
        #expect(seenBody.contains("magnets[]="))
        #expect(seenBody.contains("magnets[]=magnet:?xt=urn:btih:123ABC"))
        #expect(torrentId == "987654")
    }

    @Test("addMagnet throws downloadFailed when response is malformed")
    func addMagnetThrowsOnMalformedResponse() async {
        let sessionID = UUID().uuidString
        let session = makeMockSession(sessionID: sessionID)

        MockURLProtocol.setHandler({ request in
            let body = """
            {"data":{"mismatched_field":true}}
            """
            return try adMakeResponse(for: request, statusCode: 200, body: body)
        }, for: sessionID)
        defer { MockURLProtocol.removeHandler(for: sessionID) }

        let service = AllDebridService(apiToken: "ad-token", session: session)
        do {
            _ = try await service.addMagnet(hash: "123ABC")
            Issue.record("Expected addMagnet malformed response failure")
        } catch let error as DebridError {
            if case .downloadFailed = error {
                // expected
            } else {
                Issue.record("Expected DebridError.downloadFailed, got \(error)")
            }
        } catch {
            Issue.record("Expected DebridError, got \(error)")
        }
    }
}

// MARK: - fileprivate helpers

private func adMakeResponse(for request: URLRequest, statusCode: Int, body: String) throws -> (HTTPURLResponse, Data) {
    guard let url = request.url else {
        throw NSError(domain: "AllDebridServiceTests", code: 1)
    }
    guard let response = HTTPURLResponse(
        url: url,
        statusCode: statusCode,
        httpVersion: nil,
        headerFields: nil
    ) else {
        throw NSError(domain: "AllDebridServiceTests", code: 2)
    }
    return (response, Data(body.utf8))
}

private func adRequestBody(from request: URLRequest) -> String {
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
