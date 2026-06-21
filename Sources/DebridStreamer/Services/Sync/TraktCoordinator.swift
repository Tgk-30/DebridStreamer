import Foundation

/// High-level Trakt coordinator that sits on top of `TraktSyncService` and the
/// `SettingsManager`-backed credential store. It owns the "is the user connected,
/// and what is a currently-valid access token" question — including proactively
/// refreshing an expiring token — so callers (settings, player scrobbling,
/// watchlist import) don't each re-implement that dance.
///
/// All work is best-effort and fault tolerant: a missing credential or a network
/// failure surfaces as `nil`/`false`/a thrown error the caller can ignore, never
/// as a crash or a blocked UI.
actor TraktCoordinator {
    private let service: TraktSyncService
    private let settings: SettingsManager

    init(service: TraktSyncService = TraktSyncService(), settings: SettingsManager) {
        self.service = service
        self.settings = settings
    }

    /// Credentials required to talk to Trakt on the user's behalf.
    struct Credentials: Sendable {
        let clientID: String
        let clientSecret: String
        let accessToken: String
    }

    /// True when both a client id and an access token are stored — i.e. the user
    /// has completed device auth at least once.
    func isConnected() async -> Bool {
        let clientID = (try? await settings.getValue(forKey: SettingsKeys.traktClientId)) ?? nil
        let accessToken = (try? await settings.getValue(forKey: SettingsKeys.traktAccessToken)) ?? nil
        return !(clientID?.isEmpty ?? true) && !(accessToken?.isEmpty ?? true)
    }

    /// Clears all stored Trakt credentials (the "Disconnect" action).
    func disconnect() async {
        try? await settings.setValue(nil, forKey: SettingsKeys.traktAccessToken)
        try? await settings.setValue(nil, forKey: SettingsKeys.traktRefreshToken)
        try? await settings.setValue(nil, forKey: SettingsKeys.traktTokenCreatedAt)
        try? await settings.setValue(nil, forKey: SettingsKeys.traktTokenExpiresIn)
    }

    /// Persists a freshly-issued token (from device auth or a refresh), including
    /// the `created_at`/`expires_in` needed to drive proactive refresh later.
    func storeToken(_ token: TraktTokenResponse) async throws {
        try await settings.setValue(token.accessToken, forKey: SettingsKeys.traktAccessToken)
        try await settings.setValue(token.refreshToken, forKey: SettingsKeys.traktRefreshToken)
        try await settings.setValue(String(token.createdAt), forKey: SettingsKeys.traktTokenCreatedAt)
        try await settings.setValue(String(token.expiresIn), forKey: SettingsKeys.traktTokenExpiresIn)
    }

    /// Returns currently-valid credentials, refreshing the access token first if it
    /// is expired/near expiry and a refresh token + client secret are available.
    /// Returns `nil` when the user isn't connected or a refresh is impossible.
    func validCredentials() async -> Credentials? {
        guard
            let clientID = ((try? await settings.getValue(forKey: SettingsKeys.traktClientId)) ?? nil)?.nonEmpty,
            let accessToken = ((try? await settings.getValue(forKey: SettingsKeys.traktAccessToken)) ?? nil)?.nonEmpty
        else {
            return nil
        }
        let clientSecret = await storedString(SettingsKeys.traktClientSecret) ?? ""

        // Decide whether a refresh is warranted based on stored token metadata.
        let createdAt = await storedInt(SettingsKeys.traktTokenCreatedAt)
        let expiresIn = await storedInt(SettingsKeys.traktTokenExpiresIn)
        let refreshToken = await storedString(SettingsKeys.traktRefreshToken) ?? ""

        let shouldRefresh: Bool
        if let createdAt, let expiresIn {
            shouldRefresh = TraktSyncService.isExpired(createdAt: createdAt, expiresIn: expiresIn)
        } else {
            // No metadata (e.g. token issued before we tracked it). Don't risk an
            // unnecessary refresh that could fail; use the token as-is.
            shouldRefresh = false
        }

        if shouldRefresh, !refreshToken.isEmpty, !clientSecret.isEmpty {
            do {
                let refreshed = try await service.refreshToken(
                    clientID: clientID,
                    clientSecret: clientSecret,
                    refreshToken: refreshToken
                )
                try await storeToken(refreshed)
                return Credentials(clientID: clientID, clientSecret: clientSecret, accessToken: refreshed.accessToken)
            } catch {
                // Refresh failed (e.g. offline / revoked). Fall back to the existing
                // token; the actual API call will surface any auth error.
                return Credentials(clientID: clientID, clientSecret: clientSecret, accessToken: accessToken)
            }
        }

        return Credentials(clientID: clientID, clientSecret: clientSecret, accessToken: accessToken)
    }

    private func storedString(_ key: String) async -> String? {
        ((try? await settings.getValue(forKey: key)) ?? nil)?.nonEmpty
    }

    private func storedInt(_ key: String) async -> Int? {
        guard let value = await storedString(key) else { return nil }
        return Int(value)
    }

    /// Fetches the user's Trakt movie watchlist (auto-refreshing the token first).
    func fetchWatchlist() async throws -> [TraktWatchlistItem] {
        guard let creds = await validCredentials() else {
            throw TraktSyncError.invalidResponse
        }
        return try await service.fetchWatchlist(clientID: creds.clientID, accessToken: creds.accessToken)
    }

    /// Best-effort scrobble: resolves valid credentials and forwards to Trakt.
    /// Movies are identified by a bare IMDb id (`tt…`); series additionally need
    /// season/episode. Silently no-ops when the user isn't connected or the id is
    /// not IMDb-shaped. Never throws to the caller — failures are swallowed so
    /// playback is never affected.
    func scrobble(
        imdbID: String,
        season: Int?,
        episode: Int?,
        progressPercent: Double,
        action: TraktSyncService.ScrobbleAction
    ) async {
        let trimmed = imdbID.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmed.lowercased().hasPrefix("tt") else { return }
        guard let creds = await validCredentials() else { return }

        do {
            if let season, let episode {
                try await service.scrobbleEpisode(
                    clientID: creds.clientID,
                    accessToken: creds.accessToken,
                    showIMDbID: trimmed,
                    season: season,
                    episode: episode,
                    progressPercent: progressPercent,
                    action: action
                )
            } else {
                try await service.scrobbleMovie(
                    clientID: creds.clientID,
                    accessToken: creds.accessToken,
                    imdbID: trimmed,
                    progressPercent: progressPercent,
                    action: action
                )
            }
        } catch {
            // Best-effort: ignore all errors.
        }
    }
}

private extension String {
    var nonEmpty: String? {
        let trimmed = trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }
}
