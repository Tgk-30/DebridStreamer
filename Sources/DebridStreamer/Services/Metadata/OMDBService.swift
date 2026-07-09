import Foundation

/// Aggregated ratings parsed from an OMDB lookup (B1).
///
/// Every field is optional and defensively `nil` when OMDB returns "N/A" or an
/// unparseable value - callers can surface whatever is present without crashing.
struct OMDBRatings: Sendable, Equatable {
    var imdbRating: Double?
    var rtPercent: Int?
    var metascore: Int?
}

/// Thin OMDB API client used to enrich a title with IMDb / Rotten Tomatoes
/// ratings keyed by IMDb id (B1).
actor OMDBService {
    private let apiKey: String
    private let baseURL = "https://www.omdbapi.com/"
    private let session: URLSession

    init(apiKey: String, session: URLSession = AppHTTP.api) {
        self.apiKey = apiKey
        self.session = session
    }

    /// Fetch ratings for an IMDb id (`tt…`). Throws on transport/decoding
    /// failures and on an OMDB error response; the caller treats any throw as
    /// "no ratings available" and silently skips.
    func fetchRatings(imdbId: String) async throws -> OMDBRatings {
        var components = URLComponents(string: baseURL)!
        components.queryItems = [
            URLQueryItem(name: "i", value: imdbId),
            URLQueryItem(name: "apikey", value: apiKey)
        ]
        guard let url = components.url else {
            throw OMDBError.invalidURL
        }

        let (data, response) = try await session.data(from: url)
        guard let http = response as? HTTPURLResponse else {
            throw OMDBError.invalidResponse
        }
        guard (200...299).contains(http.statusCode) else {
            throw OMDBError.httpError(http.statusCode)
        }

        let decoded = try JSONDecoder().decode(OMDBResponse.self, from: data)
        if decoded.response?.lowercased() == "false" {
            throw OMDBError.notFound(decoded.error ?? imdbId)
        }
        return decoded.toRatings()
    }
}

// MARK: - Raw response models

/// OMDB uses PascalCase keys and string "N/A" sentinels for missing values, so
/// this is decoded with explicit keys (no snake-case strategy) and parsed
/// defensively below.
private struct OMDBResponse: Decodable {
    let imdbRating: String?
    let metascore: String?
    let ratings: [OMDBRating]?
    let response: String?
    let error: String?

    enum CodingKeys: String, CodingKey {
        case imdbRating
        case metascore = "Metascore"
        case ratings = "Ratings"
        case response = "Response"
        case error = "Error"
    }

    func toRatings() -> OMDBRatings {
        OMDBRatings(
            imdbRating: Self.parseDouble(imdbRating),
            rtPercent: Self.rottenTomatoesPercent(from: ratings),
            metascore: Self.parseInt(metascore)
        )
    }

    /// Parse "7.4" → 7.4, ignoring "N/A" / empty / garbage.
    private static func parseDouble(_ value: String?) -> Double? {
        guard let value, value != "N/A", !value.isEmpty else { return nil }
        return Double(value.trimmingCharacters(in: .whitespaces))
    }

    /// Parse "63" → 63, ignoring "N/A" / empty / garbage.
    private static func parseInt(_ value: String?) -> Int? {
        guard let value, value != "N/A", !value.isEmpty else { return nil }
        return Int(value.trimmingCharacters(in: .whitespaces))
    }

    /// Pull the Rotten Tomatoes entry out of the `Ratings` array and parse its
    /// "74%" value into an Int in 0...100. Returns nil if absent or unparseable.
    private static func rottenTomatoesPercent(from ratings: [OMDBRating]?) -> Int? {
        guard let entry = ratings?.first(where: { $0.source == "Rotten Tomatoes" }) else {
            return nil
        }
        let digits = entry.value.filter(\.isNumber)
        guard !digits.isEmpty, let percent = Int(digits) else { return nil }
        return min(100, max(0, percent))
    }
}

private struct OMDBRating: Decodable {
    let source: String
    let value: String

    enum CodingKeys: String, CodingKey {
        case source = "Source"
        case value = "Value"
    }
}

// MARK: - Errors

enum OMDBError: LocalizedError, Equatable {
    case invalidURL
    case invalidResponse
    case httpError(Int)
    case notFound(String)

    var errorDescription: String? {
        switch self {
        case .invalidURL: return "Invalid OMDB URL"
        case .invalidResponse: return "Invalid response from OMDB"
        case .httpError(let code): return "OMDB HTTP \(code)"
        case .notFound(let msg): return "OMDB lookup failed: \(msg)"
        }
    }
}
