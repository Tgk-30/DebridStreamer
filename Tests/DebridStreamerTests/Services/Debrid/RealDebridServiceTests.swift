import Testing
import Foundation
@testable import DebridStreamer

@Suite("Real-Debrid Service Tests")
struct RealDebridServiceTests {

    // MARK: - getAccountInfo

    @Test("getAccountInfo decodes username, email, premium and ISO8601 expiration")
    func accountInfoDecodesPremiumUser() async throws {
        let sessionID = UUID().uuidString
        let session = makeMockSession(sessionID: sessionID)
        var userRequest: URLRequest?

        MockURLProtocol.setHandler({ request in
            let path = request.url?.path ?? ""
            switch path {
            case "/rest/1.0/user":
                userRequest = request
                let body = """
                {
                  "username": "rd-user",
                  "email": "rd@example.com",
                  "premium": 2592000,
                  "points": 1000,
                  "expiration": "2026-09-01T12:00:00Z"
                }
                """
                return try rdResponse(for: request, statusCode: 200, body: body)
            default:
                return try rdResponse(for: request, statusCode: 404, body: "{}")
            }
        }, for: sessionID)
        defer { MockURLProtocol.removeHandler(for: sessionID) }

        let rd = RealDebridService(apiToken: "rd-token", session: session)
        let info = try await rd.getAccountInfo()

        #expect(info.username == "rd-user")
        #expect(info.email == "rd@example.com")
        #expect(info.isPremium == true)
        #expect(info.points == 1000)

        // ISO8601 with internet date-time. Verify the parsed instant.
        let expected = ISO8601DateFormatter().date(from: "2026-09-01T12:00:00Z")
        #expect(info.premiumExpiry == expected)

        // Token is sent as a Bearer header, never leaked into the query.
        let req = try #require(userRequest)
        #expect(req.value(forHTTPHeaderField: "Authorization") == "Bearer rd-token")
        #expect(req.url?.query?.contains("token=") != true)
    }

    @Test("getAccountInfo treats premium == 0 as not premium and tolerates missing fields")
    func accountInfoNonPremiumDefaults() async throws {
        let sessionID = UUID().uuidString
        let session = makeMockSession(sessionID: sessionID)

        MockURLProtocol.setHandler({ request in
            // No username/email/expiration; premium absent -> defaults to 0.
            let body = #"{"id": 1}"#
            return try rdResponse(for: request, statusCode: 200, body: body)
        }, for: sessionID)
        defer { MockURLProtocol.removeHandler(for: sessionID) }

        let rd = RealDebridService(apiToken: "rd-token", session: session)
        let info = try await rd.getAccountInfo()

        #expect(info.username == "Unknown")
        #expect(info.email == nil)
        #expect(info.isPremium == false)
        #expect(info.premiumExpiry == nil)
        #expect(info.points == nil)
    }

    // MARK: - HTTP status mapping

    @Test("HTTP 401 maps to DebridError.invalidToken")
    func unauthorizedMapsToInvalidToken() async throws {
        let rd = try await expectAccountError(statusCode: 401)
        #expect(rd == .invalidToken)
    }

    @Test("HTTP 403 maps to DebridError.expired")
    func forbiddenMapsToExpired() async throws {
        let rd = try await expectAccountError(statusCode: 403)
        #expect(rd == .expired)
    }

    @Test("HTTP 429 maps to DebridError.rateLimited")
    func tooManyRequestsMapsToRateLimited() async throws {
        let rd = try await expectAccountError(statusCode: 429)
        #expect(rd == .rateLimited)
    }

    @Test("HTTP 400 maps to DebridError.httpError with status and body")
    func badRequestMapsToHTTPError() async throws {
        let sessionID = UUID().uuidString
        let session = makeMockSession(sessionID: sessionID)

        MockURLProtocol.setHandler({ request in
            try rdResponse(for: request, statusCode: 400, body: #"{"error":"bad_token"}"#)
        }, for: sessionID)
        defer { MockURLProtocol.removeHandler(for: sessionID) }

        let rd = RealDebridService(apiToken: "rd-token", session: session)
        let caught = await captureDebridError {
            _ = try await rd.getAccountInfo()
        }
        let error = try #require(caught)
        guard case let .httpError(code, message) = error else {
            Issue.record("Expected .httpError, got \(error)")
            return
        }
        #expect(code == 400)
        #expect(message.contains("bad_token"))
    }

    @Test("validateToken returns false when getAccountInfo throws")
    func validateTokenFalseOnError() async throws {
        let sessionID = UUID().uuidString
        let session = makeMockSession(sessionID: sessionID)

        MockURLProtocol.setHandler({ request in
            try rdResponse(for: request, statusCode: 401, body: "{}")
        }, for: sessionID)
        defer { MockURLProtocol.removeHandler(for: sessionID) }

        let rd = RealDebridService(apiToken: "bad", session: session)
        let valid = try await rd.validateToken()
        #expect(valid == false)
    }

    @Test("validateToken returns true when account info resolves")
    func validateTokenTrueOnSuccess() async throws {
        let sessionID = UUID().uuidString
        let session = makeMockSession(sessionID: sessionID)

        MockURLProtocol.setHandler({ request in
            try rdResponse(for: request, statusCode: 200, body: #"{"username":"ok","premium":1}"#)
        }, for: sessionID)
        defer { MockURLProtocol.removeHandler(for: sessionID) }

        let rd = RealDebridService(apiToken: "good", session: session)
        let valid = try await rd.validateToken()
        #expect(valid == true)
    }

    // MARK: - findExistingTorrent

    @Test("findExistingTorrent requests the bounded V2 list and returns id for downloaded match")
    func findExistingReturnsDownloadedID() async throws {
        let sessionID = UUID().uuidString
        let session = makeMockSession(sessionID: sessionID)
        var listRequest: URLRequest?

        MockURLProtocol.setHandler({ request in
            let path = request.url?.path ?? ""
            if path == "/rest/1.0/torrents" {
                listRequest = request
                let body = """
                [
                  {"id": "AAA", "hash": "DEADBEEF", "status": "downloaded"},
                  {"id": "BBB", "hash": "CAFE0000", "status": "magnet_conversion"}
                ]
                """
                return try rdResponse(for: request, statusCode: 200, body: body)
            }
            return try rdResponse(for: request, statusCode: 404, body: "[]")
        }, for: sessionID)
        defer { MockURLProtocol.removeHandler(for: sessionID) }

        let rd = RealDebridService(apiToken: "rd-token", session: session)
        // Hash matching is case-insensitive.
        let id = try await rd.findExistingTorrent(hash: "deadbeef")
        #expect(id == "AAA")

        // V2 bounds the list with ?limit=100&page=1.
        let req = try #require(listRequest)
        let query = req.url?.query ?? ""
        #expect(query.contains("limit=100"))
        #expect(query.contains("page=1"))
    }

    @Test("findExistingTorrent returns in-progress id without deleting")
    func findExistingReturnsInProgressID() async throws {
        let sessionID = UUID().uuidString
        let session = makeMockSession(sessionID: sessionID)
        var deleteCalled = false

        MockURLProtocol.setHandler({ request in
            let path = request.url?.path ?? ""
            if path == "/rest/1.0/torrents" {
                let body = #"[{"id": "PROG", "hash": "abc123", "status": "downloading"}]"#
                return try rdResponse(for: request, statusCode: 200, body: body)
            }
            if path.hasPrefix("/rest/1.0/torrents/delete/") {
                deleteCalled = true
                return try rdResponse(for: request, statusCode: 204, body: "")
            }
            return try rdResponse(for: request, statusCode: 404, body: "[]")
        }, for: sessionID)
        defer { MockURLProtocol.removeHandler(for: sessionID) }

        let rd = RealDebridService(apiToken: "rd-token", session: session)
        let id = try await rd.findExistingTorrent(hash: "ABC123")
        #expect(id == "PROG")
        #expect(deleteCalled == false)
    }

    @Test("findExistingTorrent deletes error-state torrent and returns nil")
    func findExistingDeletesErroredTorrent() async throws {
        let sessionID = UUID().uuidString
        let session = makeMockSession(sessionID: sessionID)
        var deletedPath: String?

        MockURLProtocol.setHandler({ request in
            let path = request.url?.path ?? ""
            if path == "/rest/1.0/torrents" {
                let body = #"[{"id": "ERR1", "hash": "ff00ff00", "status": "error"}]"#
                return try rdResponse(for: request, statusCode: 200, body: body)
            }
            if path.hasPrefix("/rest/1.0/torrents/delete/") {
                deletedPath = path
                return try rdResponse(for: request, statusCode: 204, body: "")
            }
            return try rdResponse(for: request, statusCode: 404, body: "[]")
        }, for: sessionID)
        defer { MockURLProtocol.removeHandler(for: sessionID) }

        let rd = RealDebridService(apiToken: "rd-token", session: session)
        let id = try await rd.findExistingTorrent(hash: "FF00FF00")
        #expect(id == nil)
        // The delete request targeted the offending torrent's id.
        #expect(deletedPath == "/rest/1.0/torrents/delete/ERR1")
    }

    @Test("findExistingTorrent returns nil when no hash matches")
    func findExistingNoMatch() async throws {
        let sessionID = UUID().uuidString
        let session = makeMockSession(sessionID: sessionID)

        MockURLProtocol.setHandler({ request in
            let path = request.url?.path ?? ""
            if path == "/rest/1.0/torrents" {
                let body = #"[{"id": "OTHER", "hash": "11112222", "status": "downloaded"}]"#
                return try rdResponse(for: request, statusCode: 200, body: body)
            }
            return try rdResponse(for: request, statusCode: 404, body: "[]")
        }, for: sessionID)
        defer { MockURLProtocol.removeHandler(for: sessionID) }

        let rd = RealDebridService(apiToken: "rd-token", session: session)
        let id = try await rd.findExistingTorrent(hash: "deadbeef")
        #expect(id == nil)
    }

    // MARK: - File candidate pairing via getStreamURL (downloaded -> no poll loop)

    @Test("getStreamURL pairs links to selected files by index and unrestricts the best")
    func streamURLPairsLinksToSelectedFiles() async throws {
        let sessionID = UUID().uuidString
        let session = makeMockSession(sessionID: sessionID)
        var unrestrictBody: String?

        // Two selected files (sorted by id), two links. Index pairing means
        // links[0] -> file id 3 (sample), links[1] -> file id 7 (the real movie).
        // DebridFileSelector should reject the sample and pick the 1080p x264 movie,
        // so the unrestrict body must carry link index 1.
        MockURLProtocol.setHandler({ request in
            let path = request.url?.path ?? ""
            if path.hasPrefix("/rest/1.0/torrents/info/") {
                let body = """
                {
                  "id": "T1",
                  "status": "downloaded",
                  "filename": "Movie.2026",
                  "links": [
                    "https://rd.example/link-sample",
                    "https://rd.example/link-movie"
                  ],
                  "files": [
                    {"id": 7, "path": "/Movie.2026.1080p.x264.mp4", "bytes": 2500000000, "selected": 1},
                    {"id": 3, "path": "/Movie.2026.sample.mkv", "bytes": 50000000, "selected": 1},
                    {"id": 9, "path": "/Movie.2026.nfo", "bytes": 1000, "selected": 0}
                  ]
                }
                """
                return try rdResponse(for: request, statusCode: 200, body: body)
            }
            if path == "/rest/1.0/unrestrict/link" {
                unrestrictBody = rdRequestBodyString(from: request)
                let body = #"{"download":"https://rd.example/direct/movie.mp4"}"#
                return try rdResponse(for: request, statusCode: 200, body: body)
            }
            return try rdResponse(for: request, statusCode: 404, body: "{}")
        }, for: sessionID)
        defer { MockURLProtocol.removeHandler(for: sessionID) }

        let rd = RealDebridService(apiToken: "rd-token", session: session)
        let stream = try await rd.getStreamURL(torrentId: "T1")

        // The movie (selected file id 7, paired to links[1]) wins selection.
        #expect(stream.streamURL == "https://rd.example/direct/movie.mp4")
        #expect(stream.fileName == "Movie.2026.1080p.x264.mp4")
        #expect(stream.quality == .hd1080p)
        #expect(stream.codec == .h264)
        #expect(stream.sizeBytes == 2_500_000_000)
        #expect(stream.debridService == "RD")

        // The link sent to unrestrict is the movie link (links[1]), not the sample.
        let body = try #require(unrestrictBody)
        #expect(body.contains("link-movie"))
        #expect(!body.contains("link-sample"))
    }

    @Test("getStreamURL falls back to top-level filename when no files are selected")
    func streamURLFallbackToTopLevelFilename() async throws {
        let sessionID = UUID().uuidString
        let session = makeMockSession(sessionID: sessionID)

        MockURLProtocol.setHandler({ request in
            let path = request.url?.path ?? ""
            if path.hasPrefix("/rest/1.0/torrents/info/") {
                // Single-file torrent: no `files` array, just a top-level filename.
                let body = """
                {
                  "id": "T2",
                  "status": "downloaded",
                  "filename": "Solo.2026.1080p.mp4",
                  "bytes": 1500000000,
                  "links": ["https://rd.example/solo-link"]
                }
                """
                return try rdResponse(for: request, statusCode: 200, body: body)
            }
            if path == "/rest/1.0/unrestrict/link" {
                return try rdResponse(for: request, statusCode: 200, body: #"{"download":"https://rd.example/direct/solo.mp4"}"#)
            }
            return try rdResponse(for: request, statusCode: 404, body: "{}")
        }, for: sessionID)
        defer { MockURLProtocol.removeHandler(for: sessionID) }

        let rd = RealDebridService(apiToken: "rd-token", session: session)
        let stream = try await rd.getStreamURL(torrentId: "T2")

        #expect(stream.fileName == "Solo.2026.1080p.mp4")
        #expect(stream.sizeBytes == 1_500_000_000)
        #expect(stream.streamURL == "https://rd.example/direct/solo.mp4")
    }

    @Test("getStreamURL throws noFilesAvailable when downloaded torrent has no links")
    func streamURLThrowsWhenNoLinks() async throws {
        let sessionID = UUID().uuidString
        let session = makeMockSession(sessionID: sessionID)

        MockURLProtocol.setHandler({ request in
            let path = request.url?.path ?? ""
            if path.hasPrefix("/rest/1.0/torrents/info/") {
                let body = #"{"id":"T3","status":"downloaded","filename":"X","links":[]}"#
                return try rdResponse(for: request, statusCode: 200, body: body)
            }
            return try rdResponse(for: request, statusCode: 404, body: "{}")
        }, for: sessionID)
        defer { MockURLProtocol.removeHandler(for: sessionID) }

        let rd = RealDebridService(apiToken: "rd-token", session: session)
        let caught = await captureDebridError {
            _ = try await rd.getStreamURL(torrentId: "T3")
        }
        #expect(caught == .noFilesAvailable)
    }

    @Test("getStreamURL throws downloadFailed immediately on terminal error status")
    func streamURLThrowsOnErrorStatus() async throws {
        let sessionID = UUID().uuidString
        let session = makeMockSession(sessionID: sessionID)

        MockURLProtocol.setHandler({ request in
            // Terminal status -> service throws on the first poll, no backoff sleep.
            try rdResponse(for: request, statusCode: 200, body: #"{"id":"T4","status":"dead"}"#)
        }, for: sessionID)
        defer { MockURLProtocol.removeHandler(for: sessionID) }

        let rd = RealDebridService(apiToken: "rd-token", session: session)
        let caught = await captureDebridError {
            _ = try await rd.getStreamURL(torrentId: "T4")
        }
        let error = try #require(caught)
        guard case let .downloadFailed(message) = error else {
            Issue.record("Expected .downloadFailed, got \(error)")
            return
        }
        #expect(message.contains("dead"))
    }

    // MARK: - unrestrict (single-shot parse)

    @Test("unrestrict parses the download URL from the response")
    func unrestrictParsesDownloadURL() async throws {
        let sessionID = UUID().uuidString
        let session = makeMockSession(sessionID: sessionID)
        var unrestrictBody: String?

        MockURLProtocol.setHandler({ request in
            let path = request.url?.path ?? ""
            if path == "/rest/1.0/unrestrict/link" {
                unrestrictBody = rdRequestBodyString(from: request)
                let body = #"{"download":"https://rd.example/direct/file.mkv","filename":"file.mkv"}"#
                return try rdResponse(for: request, statusCode: 200, body: body)
            }
            return try rdResponse(for: request, statusCode: 404, body: "{}")
        }, for: sessionID)
        defer { MockURLProtocol.removeHandler(for: sessionID) }

        let rd = RealDebridService(apiToken: "rd-token", session: session)
        let url = try await rd.unrestrict(link: "https://host.example/restricted/abc")

        #expect(url.absoluteString == "https://rd.example/direct/file.mkv")
        // The original restricted link is sent percent-encoded in the form body.
        let body = try #require(unrestrictBody)
        #expect(body.hasPrefix("link="))
        #expect(body.contains("host.example"))
    }

    // MARK: - checkCache (RD disabled instantAvailability -> all unknown)

    @Test("checkCache returns .unknown for every lowercased hash and empty for empty input")
    func checkCacheReturnsUnknown() async throws {
        let sessionID = UUID().uuidString
        let session = makeMockSession(sessionID: sessionID)

        // checkCache makes no network calls; fail loudly if it ever does.
        MockURLProtocol.setHandler({ request in
            Issue.record("checkCache must not perform any network request")
            return try rdResponse(for: request, statusCode: 500, body: "{}")
        }, for: sessionID)
        defer { MockURLProtocol.removeHandler(for: sessionID) }

        let rd = RealDebridService(apiToken: "rd-token", session: session)

        let empty = try await rd.checkCache(hashes: [])
        #expect(empty.isEmpty)

        let result = try await rd.checkCache(hashes: ["ABCD", "EfGh"])
        #expect(result.count == 2)
        #expect(result["abcd"] == .unknown)
        #expect(result["efgh"] == .unknown)
        // Keys are normalized to lowercase.
        #expect(result["ABCD"] == nil)
    }
}

// MARK: - Helpers (fileprivate to avoid cross-file symbol collisions)

/// Drives a `getAccountInfo()` call that should surface a mapped `DebridError`
/// for the given non-2xx status, returning the caught error.
private func expectAccountError(statusCode: Int) async throws -> DebridError {
    let sessionID = UUID().uuidString
    let session = makeMockSession(sessionID: sessionID)

    MockURLProtocol.setHandler({ request in
        try rdResponse(for: request, statusCode: statusCode, body: "{}")
    }, for: sessionID)
    defer { MockURLProtocol.removeHandler(for: sessionID) }

    let rd = RealDebridService(apiToken: "rd-token", session: session)
    let caught = await captureDebridError {
        _ = try await rd.getAccountInfo()
    }
    return try #require(caught)
}

/// Runs an async throwing block and returns any thrown `DebridError`, or nil if
/// none (or a non-DebridError) was thrown.
private func captureDebridError(_ body: () async throws -> Void) async -> DebridError? {
    do {
        try await body()
        return nil
    } catch let error as DebridError {
        return error
    } catch {
        return nil
    }
}

private func rdResponse(for request: URLRequest, statusCode: Int, body: String) throws -> (HTTPURLResponse, Data) {
    guard let url = request.url else {
        throw NSError(domain: "RealDebridServiceTests", code: 1)
    }
    guard let response = HTTPURLResponse(
        url: url,
        statusCode: statusCode,
        httpVersion: nil,
        headerFields: nil
    ) else {
        throw NSError(domain: "RealDebridServiceTests", code: 2)
    }
    return (response, Data(body.utf8))
}

private func rdRequestBodyString(from request: URLRequest) -> String {
    if let body = request.httpBody {
        return String(data: body, encoding: .utf8) ?? ""
    }

    guard let stream = request.httpBodyStream else {
        return ""
    }

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
