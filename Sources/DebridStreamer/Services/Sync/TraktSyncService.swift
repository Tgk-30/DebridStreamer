import Foundation

enum SyncState: String, Sendable, Codable {
    case idle
    case running
    case success
    case failed
}

enum TraktSyncError: LocalizedError, Equatable {
    case invalidURL
    case invalidResponse
    case decodingFailed(String)
    case httpStatus(Int, String)

    var errorDescription: String? {
        switch self {
        case .invalidURL:
            return "Invalid Trakt URL."
        case .invalidResponse:
            return "Invalid Trakt response."
        case .decodingFailed(let detail):
            return "Failed to decode Trakt response: \(detail)"
        case .httpStatus(let status, let body):
            return "Trakt HTTP \(status): \(body)"
        }
    }
}

struct TraktDeviceCodeResponse: Codable, Sendable {
    var deviceCode: String
    var userCode: String
    var verificationURL: String
    var expiresIn: Int
    var interval: Int

    enum CodingKeys: String, CodingKey {
        case deviceCode = "device_code"
        case userCode = "user_code"
        case verificationURL = "verification_url"
        case expiresIn = "expires_in"
        case interval
    }
}

struct TraktTokenResponse: Codable, Sendable {
    var accessToken: String
    var refreshToken: String
    var expiresIn: Int
    var tokenType: String
    var scope: String
    var createdAt: Int

    enum CodingKeys: String, CodingKey {
        case accessToken = "access_token"
        case refreshToken = "refresh_token"
        case expiresIn = "expires_in"
        case tokenType = "token_type"
        case scope
        case createdAt = "created_at"
    }
}

struct TraktWatchlistItem: Sendable, Equatable {
    var imdbID: String
    var title: String
    var year: Int?
}

/// Typed summary of a `POST /sync/watchlist` response. Trakt returns counts of
/// items that were `added`, were already `existing`, and could `not_found` be
/// matched. Decoding this (instead of discarding it) lets callers surface
/// rejected IDs to the user.
struct TraktWatchlistPushResult: Decodable, Sendable, Equatable {
    struct Counts: Decodable, Sendable, Equatable {
        var movies: Int?
    }

    struct NotFoundIDs: Decodable, Sendable, Equatable {
        var imdb: String?
    }

    struct NotFoundMovie: Decodable, Sendable, Equatable {
        var ids: NotFoundIDs?
    }

    struct NotFound: Decodable, Sendable, Equatable {
        var movies: [NotFoundMovie]?
    }

    var added: Counts?
    var existing: Counts?
    var notFound: NotFound?

    enum CodingKeys: String, CodingKey {
        case added
        case existing
        case notFound = "not_found"
    }
}

/// Typed summary of a `POST /scrobble/{action}` response. Trakt echoes the
/// reported `progress` and an `action` (e.g. `start`, `pause`, `scrobble`). All
/// fields are optional so a thin/best-effort response still decodes.
struct TraktScrobbleResult: Decodable, Sendable, Equatable {
    var action: String?
    var progress: Double?
}

actor TraktSyncService {
    private let session: URLSession
    private let baseURL = "https://api.trakt.tv"

    /// Default safety buffer (seconds) before the real expiry at which a token is
    /// considered expired, so callers refresh proactively rather than racing a 401.
    static let defaultExpiryBuffer: TimeInterval = 24 * 60 * 60

    init(session: URLSession = .shared) {
        self.session = session
    }

    /// Returns true when a token issued at `createdAt` (Unix seconds) with lifetime
    /// `expiresIn` (seconds) is at or past its expiry, accounting for `buffer`.
    /// Both `createdAt` and `expiresIn` come directly from `TraktTokenResponse`.
    nonisolated static func isExpired(
        createdAt: Int,
        expiresIn: Int,
        now: Date = Date(),
        buffer: TimeInterval = TraktSyncService.defaultExpiryBuffer
    ) -> Bool {
        let expiry = Date(timeIntervalSince1970: TimeInterval(createdAt + expiresIn))
        return expiry.timeIntervalSince(now) <= buffer
    }

    func startDeviceAuth(clientID: String) async throws -> TraktDeviceCodeResponse {
        let payload = ["client_id": clientID]
        return try await request(
            path: "/oauth/device/code",
            method: "POST",
            traktClientID: nil,
            accessToken: nil,
            body: payload
        )
    }

    func exchangeDeviceCode(
        clientID: String,
        clientSecret: String,
        deviceCode: String
    ) async throws -> TraktTokenResponse {
        let payload: [String: String] = [
            "code": deviceCode,
            "client_id": clientID,
            "client_secret": clientSecret
        ]
        return try await request(
            path: "/oauth/device/token",
            method: "POST",
            traktClientID: nil,
            accessToken: nil,
            body: payload
        )
    }

    func refreshToken(
        clientID: String,
        clientSecret: String,
        refreshToken: String
    ) async throws -> TraktTokenResponse {
        let payload: [String: String] = [
            "refresh_token": refreshToken,
            "client_id": clientID,
            "client_secret": clientSecret,
            "grant_type": "refresh_token"
        ]
        return try await request(
            path: "/oauth/token",
            method: "POST",
            traktClientID: nil,
            accessToken: nil,
            body: payload
        )
    }

    func fetchWatchlist(clientID: String, accessToken: String) async throws -> [TraktWatchlistItem] {
        struct ResponseItem: Decodable {
            struct Movie: Decodable {
                struct IDs: Decodable {
                    let imdb: String?
                }
                let title: String
                let year: Int?
                let ids: IDs
            }
            let movie: Movie?
        }

        let response: [ResponseItem] = try await request(
            path: "/sync/watchlist/movies",
            method: "GET",
            traktClientID: clientID,
            accessToken: accessToken,
            body: Optional<String>.none
        )

        return response.compactMap { item in
            guard let movie = item.movie, let imdb = movie.ids.imdb else { return nil }
            return TraktWatchlistItem(imdbID: imdb, title: movie.title, year: movie.year)
        }
    }

    @discardableResult
    func pushWatchlist(clientID: String, accessToken: String, imdbIDs: [String]) async throws -> TraktWatchlistPushResult {
        struct Payload: Encodable {
            struct Movie: Encodable {
                struct IDs: Encodable {
                    let imdb: String
                }
                let ids: IDs
            }
            let movies: [Movie]
        }

        let payload = Payload(movies: imdbIDs.map { .init(ids: .init(imdb: $0)) })
        return try await request(
            path: "/sync/watchlist",
            method: "POST",
            traktClientID: clientID,
            accessToken: accessToken,
            body: payload
        )
    }

    /// The Trakt scrobble action. `start` marks playback began, `pause` a pause,
    /// and `stop` finalizes - Trakt auto-marks the item watched when a `stop`
    /// arrives with progress >= 80%.
    enum ScrobbleAction: String, Sendable {
        case start
        case pause
        case stop
    }

    /// Scrobbles a movie's playback progress to Trakt. `progressPercent` is the
    /// 0...100 watched fraction. Only IMDb-identified movies are supported (the
    /// id must look like `tt…`); callers should pass the bare IMDb id.
    ///
    /// This is best-effort: callers invoke it fire-and-forget and ignore errors so
    /// playback is never blocked or interrupted by a Trakt failure.
    @discardableResult
    func scrobbleMovie(
        clientID: String,
        accessToken: String,
        imdbID: String,
        progressPercent: Double,
        action: ScrobbleAction
    ) async throws -> TraktScrobbleResult {
        struct Payload: Encodable {
            struct Movie: Encodable {
                struct IDs: Encodable { let imdb: String }
                let ids: IDs
            }
            let movie: Movie
            let progress: Double
        }

        let clamped = min(max(progressPercent, 0), 100)
        let payload = Payload(movie: .init(ids: .init(imdb: imdbID)), progress: clamped)
        return try await request(
            path: "/scrobble/\(action.rawValue)",
            method: "POST",
            traktClientID: clientID,
            accessToken: accessToken,
            body: payload
        )
    }

    /// Scrobbles an episode's playback progress to Trakt, identifying the show by
    /// IMDb id plus season/episode numbers.
    @discardableResult
    func scrobbleEpisode(
        clientID: String,
        accessToken: String,
        showIMDbID: String,
        season: Int,
        episode: Int,
        progressPercent: Double,
        action: ScrobbleAction
    ) async throws -> TraktScrobbleResult {
        struct Payload: Encodable {
            struct Show: Encodable {
                struct IDs: Encodable { let imdb: String }
                let ids: IDs
            }
            struct Episode: Encodable {
                let season: Int
                let number: Int
            }
            let show: Show
            let episode: Episode
            let progress: Double
        }

        let clamped = min(max(progressPercent, 0), 100)
        let payload = Payload(
            show: .init(ids: .init(imdb: showIMDbID)),
            episode: .init(season: season, number: episode),
            progress: clamped
        )
        return try await request(
            path: "/scrobble/\(action.rawValue)",
            method: "POST",
            traktClientID: clientID,
            accessToken: accessToken,
            body: payload
        )
    }

    private func request<T: Decodable, Body: Encodable>(
        path: String,
        method: String,
        traktClientID: String?,
        accessToken: String?,
        body: Body?
    ) async throws -> T {
        guard let url = URL(string: baseURL + path) else {
            throw TraktSyncError.invalidURL
        }

        var request = URLRequest(url: url)
        request.httpMethod = method
        request.timeoutInterval = 45
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("2", forHTTPHeaderField: "trakt-api-version")
        if let traktClientID {
            request.setValue(traktClientID, forHTTPHeaderField: "trakt-api-key")
        }
        if let accessToken {
            request.setValue("Bearer \(accessToken)", forHTTPHeaderField: "Authorization")
        }
        if let body {
            request.httpBody = try JSONEncoder().encode(body)
        }

        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else {
            throw TraktSyncError.invalidResponse
        }

        if !(200...299).contains(http.statusCode) {
            throw TraktSyncError.httpStatus(http.statusCode, String(data: data, encoding: .utf8) ?? "")
        }

        if T.self == TraktNoContent.self {
            return TraktNoContent() as! T
        }

        do {
            return try JSONDecoder().decode(T.self, from: data)
        } catch {
            throw TraktSyncError.decodingFailed(String(describing: error))
        }
    }
}

private struct TraktNoContent: Decodable {}
