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
