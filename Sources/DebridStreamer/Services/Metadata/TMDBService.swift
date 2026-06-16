import Foundation

/// TMDB API service for movie and TV show metadata.
actor TMDBService: MetadataProvider {
    private let apiKey: String
    private let baseURL = "https://api.themoviedb.org/3"
    private let session: URLSession

    init(apiKey: String, session: URLSession = .shared) {
        self.apiKey = apiKey
        self.session = session
    }

    // MARK: - MetadataProvider

    func search(query: String, type: MediaType?, page: Int = 1) async throws -> MetadataSearchResult {
        let path: String
        if let type = type {
            path = "/search/\(type.tmdbPath)"
        } else {
            path = "/search/multi"
        }

        var params: [String: String] = [
            "query": query,
            "page": String(page),
            "include_adult": "false"
        ]
        if type == nil {
            params["language"] = "en-US"
        }

        let response: TMDBPagedResponse<TMDBSearchResult> = try await request(path: path, params: params)
        let items = response.results.compactMap { $0.toMediaPreview() }
        return MetadataSearchResult(
            items: items,
            page: response.page,
            totalPages: response.totalPages,
            totalResults: response.totalResults
        )
    }

    func getDetail(id: String, type: MediaType) async throws -> MediaItem {
        // If the ID is a TMDB numeric ID, use it directly. Otherwise extract from "tmdb-{id}".
        let tmdbId: String
        if id.hasPrefix("tmdb-") {
            tmdbId = String(id.dropFirst(5))
        } else if id.allSatisfy(\.isNumber) {
            tmdbId = id
        } else {
            // This is an IMDB ID — we need to find the TMDB ID first
            let findResult = try await findByImdbId(id, type: type)
            guard let foundId = findResult else {
                throw TMDBError.notFound(id)
            }
            tmdbId = String(foundId)
        }

        let path = "/\(type.tmdbPath)/\(tmdbId)"
        let params = [
            "append_to_response": "external_ids,credits",
            "language": "en-US"
        ]

        let response: TMDBDetailResponse = try await request(path: path, params: params)
        return response.toMediaItem(type: type)
    }

    func getSeriesRenewalMetadata(id: String) async throws -> TMDBSeriesRenewalMetadata {
        // Resolve series TMDB ID from tmdb-* or imdb id inputs.
        let tmdbId: String
        if id.hasPrefix("tmdb-") {
            tmdbId = String(id.dropFirst(5))
        } else if id.allSatisfy(\.isNumber) {
            tmdbId = id
        } else if let found = try await findByImdbId(id, type: .series) {
            tmdbId = String(found)
        } else {
            throw TMDBError.notFound(id)
        }

        let path = "/tv/\(tmdbId)"
        let params = ["language": "en-US"]
        let response: TMDBSeriesRenewalResponse = try await request(path: path, params: params)
        return TMDBSeriesRenewalMetadata(
            status: response.status,
            inProduction: response.inProduction,
            nextEpisodeAirDate: response.nextEpisodeToAir?.airDate,
            lastAirDate: response.lastAirDate,
            numberOfSeasons: response.numberOfSeasons
        )
    }

    func getTrending(type: MediaType, timeWindow: TrendingWindow = .week, page: Int = 1) async throws -> MetadataSearchResult {
        let path = "/trending/\(type.tmdbPath)/\(timeWindow.rawValue)"
        let params = ["page": String(page), "language": "en-US"]

        let response: TMDBPagedResponse<TMDBSearchResult> = try await request(path: path, params: params)
        let items = response.results.compactMap { $0.toMediaPreview() }
        return MetadataSearchResult(
            items: items,
            page: response.page,
            totalPages: response.totalPages,
            totalResults: response.totalResults
        )
    }

    func getCategory(_ category: MediaCategory, type: MediaType, page: Int = 1) async throws -> MetadataSearchResult {
        let path = "/\(type.tmdbPath)/\(category.rawValue)"
        let params = ["page": String(page), "language": "en-US"]

        let response: TMDBPagedResponse<TMDBSearchResult> = try await request(path: path, params: params)
        let items = response.results.compactMap { $0.toMediaPreview() }
        return MetadataSearchResult(
            items: items,
            page: response.page,
            totalPages: response.totalPages,
            totalResults: response.totalResults
        )
    }

    func discover(type: MediaType, filters: DiscoverFilters) async throws -> MetadataSearchResult {
        let path = "/discover/\(type.tmdbPath)"
        var params: [String: String] = [
            "page": String(filters.page),
            "sort_by": filters.sortBy.rawValue,
            "language": "en-US",
            "include_adult": "false"
        ]
        if let genreId = filters.genreId {
            params["with_genres"] = String(genreId)
        }
        if let year = filters.year {
            if type == .movie {
                params["primary_release_year"] = String(year)
            } else {
                params["first_air_date_year"] = String(year)
            }
        }
        if let minRating = filters.minRating {
            params["vote_average.gte"] = String(minRating)
            params["vote_count.gte"] = "100"
        }

        let response: TMDBPagedResponse<TMDBSearchResult> = try await request(path: path, params: params)
        let items = response.results.compactMap { $0.toMediaPreview() }
        return MetadataSearchResult(
            items: items,
            page: response.page,
            totalPages: response.totalPages,
            totalResults: response.totalResults
        )
    }

    func getGenres(type: MediaType) async throws -> [Genre] {
        let path = "/genre/\(type.tmdbPath)/list"
        let response: TMDBGenresResponse = try await request(path: path, params: ["language": "en-US"])
        return response.genres.map { Genre(id: $0.id, name: $0.name) }
    }

    func getSeasons(tmdbId: Int) async throws -> [Season] {
        let path = "/tv/\(tmdbId)"
        let params = ["language": "en-US"]
        let response: TMDBTVDetailResponse = try await request(path: path, params: params)
        return response.seasons?.map { season in
            Season(
                id: season.id,
                seasonNumber: season.seasonNumber,
                name: season.name,
                overview: season.overview,
                posterPath: season.posterPath,
                episodeCount: season.episodeCount,
                airDate: season.airDate
            )
        } ?? []
    }

    func getEpisodes(tmdbId: Int, season: Int) async throws -> [Episode] {
        let path = "/tv/\(tmdbId)/season/\(season)"
        let params = ["language": "en-US"]
        let response: TMDBSeasonResponse = try await request(path: path, params: params)
        return response.episodes.map { ep in
            Episode(
                id: "\(tmdbId)-s\(season)e\(ep.episodeNumber)",
                mediaId: "tmdb-\(tmdbId)",
                seasonNumber: season,
                episodeNumber: ep.episodeNumber,
                title: ep.name,
                overview: ep.overview,
                airDate: ep.airDate,
                stillPath: ep.stillPath,
                runtime: ep.runtime
            )
        }
    }

    func getExternalIds(tmdbId: Int, type: MediaType) async throws -> ExternalIds {
        let path = "/\(type.tmdbPath)/\(tmdbId)/external_ids"
        return try await request(path: path, params: [:])
    }

    func getCast(tmdbId: Int, type: MediaType) async throws -> [CastMember] {
        let path = "/\(type.tmdbPath)/\(tmdbId)/credits"
        let params = ["language": "en-US"]
        let response: TMDBCredits = try await request(path: path, params: params)
        return response.cast.map {
            CastMember(id: $0.id, name: $0.name, character: $0.character ?? "", profilePath: $0.profilePath)
        }
    }

    func getRecommendations(tmdbId: Int, type: MediaType) async throws -> [MediaPreview] {
        let path = "/\(type.tmdbPath)/\(tmdbId)/recommendations"
        let params = ["language": "en-US", "page": "1"]
        let response: TMDBPagedResponse<TMDBSearchResult> = try await request(path: path, params: params)
        return response.results.compactMap { $0.toMediaPreview() }
    }

    // MARK: - Find by IMDB ID

    func findByImdbId(_ imdbId: String, type: MediaType) async throws -> Int? {
        let path = "/find/\(imdbId)"
        let params = ["external_source": "imdb_id"]
        let response: TMDBFindResponse = try await request(path: path, params: params)
        switch type {
        case .movie:
            return response.movieResults.first?.id
        case .series:
            return response.tvResults.first?.id
        }
    }

    // MARK: - HTTP

    private func request<T: Decodable>(path: String, params: [String: String]) async throws -> T {
        var components = URLComponents(string: baseURL + path)!
        var queryItems = params.map { URLQueryItem(name: $0.key, value: $0.value) }
        queryItems.append(URLQueryItem(name: "api_key", value: apiKey))
        components.queryItems = queryItems

        guard let url = components.url else {
            throw TMDBError.invalidURL(path)
        }

        let (data, response) = try await session.data(from: url)

        guard let httpResponse = response as? HTTPURLResponse else {
            throw TMDBError.invalidResponse
        }

        guard (200...299).contains(httpResponse.statusCode) else {
            if httpResponse.statusCode == 401 {
                throw TMDBError.unauthorized
            }
            if httpResponse.statusCode == 404 {
                throw TMDBError.notFound(path)
            }
            if httpResponse.statusCode == 429 {
                throw TMDBError.rateLimited
            }
            throw TMDBError.httpError(httpResponse.statusCode, String(data: data, encoding: .utf8) ?? "")
        }

        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        decoder.dateDecodingStrategy = .iso8601
        return try decoder.decode(T.self, from: data)
    }
}

// MARK: - TMDB API Response Models

struct TMDBPagedResponse<T: Decodable>: Decodable {
    let page: Int
    let results: [T]
    let totalPages: Int
    let totalResults: Int
}

struct TMDBSearchResult: Decodable {
    let id: Int
    let title: String?       // Movies
    let name: String?         // TV
    let mediaType: String?    // multi search
    let overview: String?
    let posterPath: String?
    let backdropPath: String?
    let releaseDate: String?  // Movies
    let firstAirDate: String? // TV
    let voteAverage: Double?
    let genreIds: [Int]?

    func toMediaPreview() -> MediaPreview? {
        let displayTitle = title ?? name ?? ""
        guard !displayTitle.isEmpty else { return nil }

        let type: MediaType
        if let mt = mediaType {
            switch mt {
            case "movie": type = .movie
            case "tv": type = .series
            default: return nil // Skip "person" etc.
            }
        } else {
            type = title != nil ? .movie : .series
        }

        let dateStr = releaseDate ?? firstAirDate
        let year = dateStr.flatMap { str -> Int? in
            guard str.count >= 4 else { return nil }
            return Int(str.prefix(4))
        }

        return MediaPreview(
            id: "tmdb-\(id)",
            type: type,
            title: displayTitle,
            year: year,
            posterPath: posterPath,
            imdbRating: voteAverage,
            tmdbId: id,
            backdropPath: backdropPath
        )
    }
}

struct TMDBDetailResponse: Decodable {
    let id: Int
    let title: String?
    let name: String?
    let overview: String?
    let posterPath: String?
    let backdropPath: String?
    let releaseDate: String?
    let firstAirDate: String?
    let voteAverage: Double?
    let runtime: Int?
    let episodeRunTime: [Int]?
    let status: String?
    var inProduction: Bool? = nil
    var nextEpisodeToAir: TMDBEpisodeToAir? = nil
    var lastAirDate: String? = nil
    var numberOfSeasons: Int? = nil
    let genres: [TMDBGenre]?
    let externalIds: ExternalIds?
    var credits: TMDBCredits? = nil

    func toMediaItem(type: MediaType) -> MediaItem {
        let displayTitle = title ?? name ?? "Unknown"
        let dateStr = releaseDate ?? firstAirDate
        let year = dateStr.flatMap { str -> Int? in
            guard str.count >= 4 else { return nil }
            return Int(str.prefix(4))
        }

        let itemId: String
        if let imdbId = externalIds?.imdbId, !imdbId.isEmpty {
            itemId = imdbId
        } else {
            itemId = "tmdb-\(id)"
        }

        let displayRuntime: Int?
        if let rt = runtime, rt > 0 {
            displayRuntime = rt
        } else if let epRt = episodeRunTime?.first, epRt > 0 {
            displayRuntime = epRt
        } else {
            displayRuntime = nil
        }

        return MediaItem(
            id: itemId,
            type: type,
            title: displayTitle,
            year: year,
            posterPath: posterPath,
            backdropPath: backdropPath,
            overview: overview,
            genres: genres?.map(\.name) ?? [],
            imdbRating: voteAverage,
            runtime: displayRuntime,
            status: status,
            tmdbId: id,
            lastFetched: Date()
        )
    }
}

struct TMDBSeriesRenewalMetadata: Sendable, Equatable {
    let status: String?
    let inProduction: Bool?
    let nextEpisodeAirDate: String?
    let lastAirDate: String?
    let numberOfSeasons: Int?
}

struct TMDBSeriesRenewalResponse: Decodable {
    let status: String?
    let inProduction: Bool?
    let nextEpisodeToAir: TMDBEpisodeToAir?
    let lastAirDate: String?
    let numberOfSeasons: Int?
}

struct TMDBEpisodeToAir: Decodable {
    let airDate: String?
}

struct TMDBGenre: Decodable {
    let id: Int
    let name: String
}

/// `credits` payload that TMDB already returns alongside detail when we request
/// `append_to_response=credits` (and from the dedicated `/credits` endpoint).
struct TMDBCredits: Decodable {
    let cast: [TMDBCastMember]
}

struct TMDBCastMember: Decodable {
    let id: Int
    let name: String
    let character: String?
    let profilePath: String?
}

struct TMDBGenresResponse: Decodable {
    let genres: [TMDBGenre]
}

struct TMDBTVDetailResponse: Decodable {
    let id: Int
    let seasons: [TMDBSeason]?
}

struct TMDBSeason: Decodable {
    let id: Int
    let seasonNumber: Int
    let name: String
    let overview: String?
    let posterPath: String?
    let episodeCount: Int
    let airDate: String?
}

struct TMDBSeasonResponse: Decodable {
    let episodes: [TMDBEpisode]
}

struct TMDBEpisode: Decodable {
    let id: Int
    let episodeNumber: Int
    let name: String?
    let overview: String?
    let airDate: String?
    let stillPath: String?
    let runtime: Int?
}

struct TMDBFindResponse: Decodable {
    let movieResults: [TMDBSearchResult]
    let tvResults: [TMDBSearchResult]
}

// MARK: - Errors

enum TMDBError: LocalizedError, Equatable {
    case invalidURL(String)
    case invalidResponse
    case unauthorized
    case notFound(String)
    case rateLimited
    case httpError(Int, String)

    var errorDescription: String? {
        switch self {
        case .invalidURL(let path): return "Invalid TMDB URL: \(path)"
        case .invalidResponse: return "Invalid response from TMDB"
        case .unauthorized: return "Invalid TMDB API key"
        case .notFound(let id): return "Not found on TMDB: \(id)"
        case .rateLimited: return "TMDB rate limit exceeded. Try again shortly."
        case .httpError(let code, let msg): return "TMDB HTTP \(code): \(msg)"
        }
    }
}
