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
    case httpStatus(Int, String)

    var errorDescription: String? {
        switch self {
        case .invalidURL:
            return "Invalid Trakt URL."
        case .invalidResponse:
            return "Invalid Trakt response."
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

actor TraktSyncService {
    private let session: URLSession
    private let baseURL = "https://api.trakt.tv"

    init(session: URLSession = .shared) {
        self.session = session
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

    func pushWatchlist(clientID: String, accessToken: String, imdbIDs: [String]) async throws {
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
        let _: TraktNoContent = try await request(
            path: "/sync/watchlist",
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
            throw TraktSyncError.invalidResponse
        }
    }
}

private struct TraktNoContent: Decodable {}
