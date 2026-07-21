import Testing
import Foundation
@testable import DebridStreamer

    @Suite("TraktCoordinator Tests")
@MainActor
struct TraktCoordinatorTests {

    @Test("isConnected requires both client ID and access token")
    func isConnectedRequiresCredentials() async throws {
        let db = try makeTestDatabase()
        let settings = SettingsManager(database: db, secretStore: InMemorySecretStore())
        let service = TraktSyncService(session: makeMockSession())
        let coordinator = TraktCoordinator(service: service, settings: settings)

        #expect(await coordinator.isConnected() == false)

        try await settings.setValue("client-id", forKey: SettingsKeys.traktClientId)
        #expect(await coordinator.isConnected() == false)

        try await settings.setValue("access-token", forKey: SettingsKeys.traktAccessToken)
        #expect(await coordinator.isConnected() == true)
    }

    @Test("disconnect clears persisted trakt credentials")
    func disconnectClearsCredentialFields() async throws {
        let db = try makeTestDatabase()
        let settings = SettingsManager(database: db, secretStore: InMemorySecretStore())
        try await settings.setValue("client-id", forKey: SettingsKeys.traktClientId)
        try await settings.setValue("client-secret", forKey: SettingsKeys.traktClientSecret)
        try await settings.setValue("access-token", forKey: SettingsKeys.traktAccessToken)
        try await settings.setValue("refresh-token", forKey: SettingsKeys.traktRefreshToken)
        try await settings.setValue("1700000000", forKey: SettingsKeys.traktTokenCreatedAt)
        try await settings.setValue("3600", forKey: SettingsKeys.traktTokenExpiresIn)

        let coordinator = TraktCoordinator(service: TraktSyncService(session: makeMockSession()), settings: settings)
        await coordinator.disconnect()

        let accessToken = try? await settings.getValue(forKey: SettingsKeys.traktAccessToken)
        let refreshToken = try? await settings.getValue(forKey: SettingsKeys.traktRefreshToken)
        let createdAt = try? await settings.getValue(forKey: SettingsKeys.traktTokenCreatedAt)
        let expiresIn = try? await settings.getValue(forKey: SettingsKeys.traktTokenExpiresIn)

        let values = [accessToken, refreshToken, createdAt, expiresIn]
        for value in values {
            #expect(value == nil)
        }
    }

    @Test("storeToken writes the expected metadata")
    func storeTokenWritesMetadata() async throws {
        let db = try makeTestDatabase()
        let settings = SettingsManager(database: db, secretStore: InMemorySecretStore())
        let coordinator = TraktCoordinator(service: TraktSyncService(session: makeMockSession()), settings: settings)

        let token = TraktTokenResponse(
            accessToken: "new-access",
            refreshToken: "new-refresh",
            expiresIn: 9000,
            tokenType: "bearer",
            scope: "public",
            createdAt: 1_700_000_100
        )

        try await coordinator.storeToken(token)

        #expect((try await settings.getValue(forKey: SettingsKeys.traktAccessToken)) == token.accessToken)
        #expect((try await settings.getValue(forKey: SettingsKeys.traktRefreshToken)) == token.refreshToken)
        #expect((try await settings.getValue(forKey: SettingsKeys.traktTokenCreatedAt)) == "1700000100")
        #expect((try await settings.getValue(forKey: SettingsKeys.traktTokenExpiresIn)) == "9000")
    }

    @Test("validCredentials returns current token without refresh metadata")
    func validCredentialsNoRefreshWithoutMetadata() async throws {
        let db = try makeTestDatabase()
        let settings = SettingsManager(database: db, secretStore: InMemorySecretStore())
        try await settings.setValue("client-id", forKey: SettingsKeys.traktClientId)
        try await settings.setValue("client-secret", forKey: SettingsKeys.traktClientSecret)
        try await settings.setValue("access-token", forKey: SettingsKeys.traktAccessToken)

        let coordinator = TraktCoordinator(service: TraktSyncService(session: makeMockSession()), settings: settings)
        let creds = await coordinator.validCredentials()

        #expect(creds?.accessToken == "access-token")
        #expect(creds?.clientID == "client-id")
        #expect(creds?.clientSecret == "client-secret")
    }

    @Test("validCredentials refreshes token when expired and updates stored token")
    func validCredentialsRefreshesExpiredToken() async throws {
        let db = try makeTestDatabase()
        let settings = SettingsManager(database: db, secretStore: InMemorySecretStore())
        let sessionID = UUID().uuidString
        let session = makeMockSession(sessionID: sessionID)
        let requestLog = RequestLog()

        try await settings.setValue("client-id", forKey: SettingsKeys.traktClientId)
        try await settings.setValue("secret", forKey: SettingsKeys.traktClientSecret)
        try await settings.setValue("stale-access", forKey: SettingsKeys.traktAccessToken)
        try await settings.setValue("refresh-me", forKey: SettingsKeys.traktRefreshToken)
        // Force expired token metadata so coordinator attempts refresh.
        try await settings.setValue("1600000000", forKey: SettingsKeys.traktTokenCreatedAt)
        try await settings.setValue("10", forKey: SettingsKeys.traktTokenExpiresIn)

        MockURLProtocol.setHandler({ request in
            requestLog.record(path: request.url?.path)
            let responseBody = """
            {
              "access_token":"fresh-access",
              "refresh_token":"fresh-refresh",
              "expires_in":9000,
              "token_type":"bearer",
              "scope":"public",
              "created_at":1700000000
            }
            """
            return try response(for: request, statusCode: 200, body: responseBody)
        }, for: sessionID)
        defer { MockURLProtocol.removeHandler(for: sessionID) }

        let coordinator = TraktCoordinator(service: TraktSyncService(session: session), settings: settings)
        let creds = await coordinator.validCredentials()

        #expect(creds?.accessToken == "fresh-access")
        #expect(requestLog.callsToOauthToken == 1)
        #expect((try await settings.getValue(forKey: SettingsKeys.traktAccessToken)) == "fresh-access")
    }

    @Test("validCredentials falls back to existing token if refresh fails")
    func validCredentialsFallsBackAfterRefreshFailure() async throws {
        let db = try makeTestDatabase()
        let settings = SettingsManager(database: db, secretStore: InMemorySecretStore())
        let sessionID = UUID().uuidString
        let session = makeMockSession(sessionID: sessionID)
        let requestLog = RequestLog()

        try await settings.setValue("client-id", forKey: SettingsKeys.traktClientId)
        try await settings.setValue("secret", forKey: SettingsKeys.traktClientSecret)
        try await settings.setValue("stale-access", forKey: SettingsKeys.traktAccessToken)
        try await settings.setValue("refresh-me", forKey: SettingsKeys.traktRefreshToken)
        // Expired token metadata
        try await settings.setValue("1600000000", forKey: SettingsKeys.traktTokenCreatedAt)
        try await settings.setValue("10", forKey: SettingsKeys.traktTokenExpiresIn)

        MockURLProtocol.setHandler({ request in
            requestLog.record(path: request.url?.path)
            if request.url?.path == "/oauth/token" {
                return try response(for: request, statusCode: 500, body: "{\"error\":\"bad\"}")
            }
            return try response(for: request, statusCode: 200, body: "[]")
        }, for: sessionID)
        defer { MockURLProtocol.removeHandler(for: sessionID) }

        let coordinator = TraktCoordinator(service: TraktSyncService(session: session), settings: settings)
        let creds = await coordinator.validCredentials()

        #expect(creds?.accessToken == "stale-access")
        #expect(requestLog.callsToOauthToken == 1)
    }

    @Test("fetchWatchlist throws when trakt credentials are missing")
    func fetchWatchlistRequiresCredentials() async throws {
        let db = try makeTestDatabase()
        let settings = SettingsManager(database: db, secretStore: InMemorySecretStore())
        let coordinator = TraktCoordinator(service: TraktSyncService(session: makeMockSession()), settings: settings)

        do {
            _ = try await coordinator.fetchWatchlist()
            Issue.record("Expected fetchWatchlist to fail")
        } catch let error as TraktSyncError {
            #expect(error == .invalidResponse)
        } catch {
            Issue.record("Unexpected error: \(error)")
        }
    }

    @Test("scrobble no-op for non-imdb media identifiers")
    func scrobbleIgnoresNonImdbIdentifiers() async throws {
        let db = try makeTestDatabase()
        let settings = SettingsManager(database: db, secretStore: InMemorySecretStore())
        let requestLog = RequestLog()
        let sessionID = UUID().uuidString
        let session = makeMockSession(sessionID: sessionID)

        MockURLProtocol.setHandler({ request in
            requestLog.record(path: request.url?.path)
            return try response(for: request, statusCode: 200, body: "{}")
        }, for: sessionID)
        defer { MockURLProtocol.removeHandler(for: sessionID) }

        try? await settings.setValue("client-id", forKey: SettingsKeys.traktClientId)
        try? await settings.setValue("client-secret", forKey: SettingsKeys.traktClientSecret)
        try? await settings.setValue("access", forKey: SettingsKeys.traktAccessToken)

        let coordinator = TraktCoordinator(service: TraktSyncService(session: session), settings: settings)
        await coordinator.scrobble(imdbID: "not-an-imdb-id", season: nil, episode: nil, progressPercent: 50, action: .pause)

        try await Task.sleep(for: .milliseconds(80))
        #expect(requestLog.callsToScrobble == 0)
    }

    @Test("scrobble sends movie and episode endpoints")
    func scrobbleCallsExpectedEndpoint() async throws {
        let db = try makeTestDatabase()
        let settings = SettingsManager(database: db, secretStore: InMemorySecretStore())
        let requestLog = RequestLog()
        let sessionID = UUID().uuidString
        let session = makeMockSession(sessionID: sessionID)

        try await settings.setValue("client-id", forKey: SettingsKeys.traktClientId)
        try await settings.setValue("client-secret", forKey: SettingsKeys.traktClientSecret)
        try await settings.setValue("access", forKey: SettingsKeys.traktAccessToken)

        MockURLProtocol.setHandler({ request in
            requestLog.record(path: request.url?.path)
            return try response(for: request, statusCode: 200, body: "{}");
        }, for: sessionID)
        defer { MockURLProtocol.removeHandler(for: sessionID) }

        let coordinator = TraktCoordinator(service: TraktSyncService(session: session), settings: settings)
        await coordinator.scrobble(imdbID: "tt1234567", season: 2, episode: 3, progressPercent: 50, action: .start)
        await coordinator.scrobble(imdbID: "tt1234567", season: nil, episode: nil, progressPercent: 50, action: .pause)

        try! await Task.sleep(for: .milliseconds(150))
        #expect(requestLog.callsToScrobble == 2)
        #expect(requestLog.paths.contains("/scrobble/start"))
        #expect(requestLog.paths.contains("/scrobble/pause"))
    }
}

private func response(for request: URLRequest, statusCode: Int, body: String) throws -> (HTTPURLResponse, Data) {
    guard let url = request.url else {
        throw NSError(domain: "TraktCoordinatorTests", code: 1)
    }
    guard let httpResponse = HTTPURLResponse(
        url: url,
        statusCode: statusCode,
        httpVersion: nil,
        headerFields: nil
    ) else {
        throw NSError(domain: "TraktCoordinatorTests", code: 2)
    }
    return (httpResponse, Data(body.utf8))
}

private final class RequestLog {
    private let lock = NSLock()
    private(set) var paths: [String] = []

    func record(path: String?) {
        guard let path else { return }
        lock.lock()
        paths.append(path)
        lock.unlock()
    }

    var callsToOauthToken: Int {
        callCount(where: { $0 == "/oauth/token" })
    }

    var callsToScrobble: Int {
        callCount(where: { $0.hasPrefix("/scrobble/") })
    }

    private func callCount(where matcher: (String) -> Bool) -> Int {
        lock.lock()
        defer { lock.unlock() }
        return paths.filter(matcher).count
    }
}
