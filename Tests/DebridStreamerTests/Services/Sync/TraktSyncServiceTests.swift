import Testing
import Foundation
@testable import DebridStreamer

@Suite("TraktSyncService Tests")
struct TraktSyncServiceTests {
    @Test("Device auth start and token exchange decode correctly")
    func deviceAuthFlowDecoding() async throws {
        let sessionID = UUID().uuidString
        let session = makeMockSession(sessionID: sessionID)
        var step = 0

        MockURLProtocol.setHandler({ request in
            step += 1
            if step == 1 {
                let body = """
                {
                  "device_code":"dev-code",
                  "user_code":"ABCD-EFGH",
                  "verification_url":"https://trakt.tv/activate",
                  "expires_in":600,
                  "interval":5
                }
                """
                return try makeResponse(for: request, statusCode: 200, body: body)
            } else {
                let body = """
                {
                  "access_token":"access-token",
                  "refresh_token":"refresh-token",
                  "expires_in":7776000,
                  "token_type":"bearer",
                  "scope":"public",
                  "created_at":1700000000
                }
                """
                return try makeResponse(for: request, statusCode: 200, body: body)
            }
        }, for: sessionID)
        defer { MockURLProtocol.removeHandler(for: sessionID) }

        let service = TraktSyncService(session: session)
        let device = try await service.startDeviceAuth(clientID: "client-id")
        #expect(device.deviceCode == "dev-code")
        #expect(device.userCode == "ABCD-EFGH")

        let token = try await service.exchangeDeviceCode(
            clientID: "client-id",
            clientSecret: "client-secret",
            deviceCode: "dev-code"
        )
        #expect(token.accessToken == "access-token")
        #expect(token.refreshToken == "refresh-token")
    }

    @Test("Watchlist fetch decodes movie IDs")
    func fetchWatchlistDecoding() async throws {
        let sessionID = UUID().uuidString
        let session = makeMockSession(sessionID: sessionID)

        MockURLProtocol.setHandler({ request in
            let body = """
            [
              {"movie":{"title":"Movie A","year":2024,"ids":{"imdb":"tt1111111"}}},
              {"movie":{"title":"Movie B","year":2025,"ids":{"imdb":"tt2222222"}}}
            ]
            """
            return try makeResponse(for: request, statusCode: 200, body: body)
        }, for: sessionID)
        defer { MockURLProtocol.removeHandler(for: sessionID) }

        let service = TraktSyncService(session: session)
        let items = try await service.fetchWatchlist(clientID: "client-id", accessToken: "access-token")
        #expect(items.count == 2)
        #expect(items[0].imdbID == "tt1111111")
        #expect(items[1].title == "Movie B")
    }

    @Test("HTTP errors surface status and body")
    func errorHandling() async {
        let sessionID = UUID().uuidString
        let session = makeMockSession(sessionID: sessionID)

        MockURLProtocol.setHandler({ request in
            return try makeResponse(for: request, statusCode: 401, body: "{\"error\":\"invalid_grant\"}")
        }, for: sessionID)
        defer { MockURLProtocol.removeHandler(for: sessionID) }

        let service = TraktSyncService(session: session)
        do {
            _ = try await service.startDeviceAuth(clientID: "client-id")
            Issue.record("Expected TraktSyncError")
        } catch let error as TraktSyncError {
            switch error {
            case .httpStatus(let status, let body):
                #expect(status == 401)
                #expect(body.contains("invalid_grant"))
            default:
                Issue.record("Expected httpStatus error")
            }
        } catch {
            Issue.record("Unexpected error: \(error)")
        }
    }

    @Test("Malformed JSON surfaces decodingFailed, not invalidResponse")
    func decodeErrorSurfacesDecodingFailed() async {
        let sessionID = UUID().uuidString
        let session = makeMockSession(sessionID: sessionID)

        MockURLProtocol.setHandler({ request in
            // 200 OK but body is not a valid TraktDeviceCodeResponse.
            return try makeResponse(for: request, statusCode: 200, body: "{\"unexpected\":true}")
        }, for: sessionID)
        defer { MockURLProtocol.removeHandler(for: sessionID) }

        let service = TraktSyncService(session: session)
        do {
            _ = try await service.startDeviceAuth(clientID: "client-id")
            Issue.record("Expected TraktSyncError")
        } catch let error as TraktSyncError {
            switch error {
            case .decodingFailed(let detail):
                #expect(!detail.isEmpty)
            default:
                Issue.record("Expected decodingFailed error, got \(error)")
            }
        } catch {
            Issue.record("Unexpected error: \(error)")
        }
    }

    @Test("pushWatchlist decodes added/existing/not_found summary")
    func pushWatchlistDecodesSummary() async throws {
        let sessionID = UUID().uuidString
        let session = makeMockSession(sessionID: sessionID)

        MockURLProtocol.setHandler({ request in
            let body = """
            {
              "added": {"movies": 1},
              "existing": {"movies": 0},
              "not_found": {"movies": [{"ids": {"imdb": "tt9999999"}}]}
            }
            """
            return try makeResponse(for: request, statusCode: 201, body: body)
        }, for: sessionID)
        defer { MockURLProtocol.removeHandler(for: sessionID) }

        let service = TraktSyncService(session: session)
        let result = try await service.pushWatchlist(
            clientID: "client-id",
            accessToken: "access-token",
            imdbIDs: ["tt1111111", "tt9999999"]
        )
        #expect(result.added?.movies == 1)
        #expect(result.existing?.movies == 0)
        #expect(result.notFound?.movies?.first?.ids?.imdb == "tt9999999")
    }

    @Test("isExpired accounts for created_at + expires_in and buffer")
    func isExpiredMath() {
        let createdAt = 1_700_000_000
        let expiresIn = 7_776_000 // 90 days

        // Well before expiry, with no buffer, the token is still valid.
        let early = Date(timeIntervalSince1970: TimeInterval(createdAt + 1000))
        #expect(TraktSyncService.isExpired(createdAt: createdAt, expiresIn: expiresIn, now: early, buffer: 0) == false)

        // Past the real expiry, the token is expired.
        let late = Date(timeIntervalSince1970: TimeInterval(createdAt + expiresIn + 10))
        #expect(TraktSyncService.isExpired(createdAt: createdAt, expiresIn: expiresIn, now: late, buffer: 0) == true)

        // Within the buffer window before real expiry, treat as expired so callers refresh proactively.
        let justInsideBuffer = Date(timeIntervalSince1970: TimeInterval(createdAt + expiresIn - 3600))
        #expect(TraktSyncService.isExpired(createdAt: createdAt, expiresIn: expiresIn, now: justInsideBuffer, buffer: 24 * 60 * 60) == true)
    }

    private func makeResponse(for request: URLRequest, statusCode: Int, body: String) throws -> (HTTPURLResponse, Data) {
        guard let url = request.url else {
            throw NSError(domain: "TraktSyncServiceTests", code: 1)
        }
        guard let response = HTTPURLResponse(url: url, statusCode: statusCode, httpVersion: nil, headerFields: nil) else {
            throw NSError(domain: "TraktSyncServiceTests", code: 2)
        }
        return (response, Data(body.utf8))
    }
}
