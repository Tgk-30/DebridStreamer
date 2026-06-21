import Foundation

/// TMDB API service for movie and TV show metadata.
actor TMDBService: MetadataProvider {
    private let apiKey: String
    private let baseURL = "https://api.themoviedb.org/3"
    private let session: URLSession

    // A single configured decoder reused across all requests (snake_case + iso8601),
    // instead of allocating + configuring one per call.
    private let decoder: JSONDecoder = {
        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        decoder.dateDecodingStrategy = .iso8601
        return decoder
    }()

    // MARK: - Response memoization
    //
    // Bounded TTL cache of already-DECODED read responses, keyed by
    // `path + sorted query params`. Because `TMDBService` is an actor the cache
    // is race-free, and because it stores the typed model directly (not raw Data
    // across the generic `request<T>`) it stays type-safe. Only successful reads
    // are cached — errors are never stored, so a failure is always retried. A
    // cache hit can only return a value that was itself a valid network response
    // within the TTL window, so behavior is identical, just faster. This also
    // dedups the getDetail+getSeasons `/tv/{id}` double-fetch within the TTL.
    private struct CacheEntry {
        let expiresAt: Date
        let value: Any
    }
    private var responseCache: [String: CacheEntry] = [:]
    private let cacheCapacity = 256

    /// Short TTL for volatile catalog reads (search/trending/category/discover/
    /// detail/seasons/episodes/cast/recommendations).
    static let shortTTL: TimeInterval = 60 * 5
    /// Long TTL for the effectively-static genre list.
    static let longTTL: TimeInterval = 60 * 60 * 24

    init(apiKey: String, session: URLSession = AppHTTP.api) {
        self.apiKey = apiKey
        self.session = session
    }

    /// Returns a cached value for `key` if present and unexpired and castable to
    /// `T`; otherwise runs `produce`, stores its result under the TTL, and returns
    /// it. Only the success path stores into the cache (`produce` throwing never
    /// caches), so error responses are never memoized.
    private func cached<T>(key: String, ttl: TimeInterval, produce: () async throws -> T) async rethrows -> T {
        if let entry = responseCache[key], entry.expiresAt > Date(), let value = entry.value as? T {
            return value
        }
        let value = try await produce()
        store(key: key, value: value, ttl: ttl)
        return value
    }

    /// Inserts into the bounded cache: expired entries are swept first, then the
    /// soonest-to-expire entries are evicted if the cap is reached. Eviction can
    /// only cause a miss (an extra network call), never an incorrect result.
    private func store(key: String, value: Any, ttl: TimeInterval) {
        let now = Date()
        responseCache = responseCache.filter { $0.value.expiresAt > now }
        if responseCache.count >= cacheCapacity {
            let overflow = responseCache.count - (cacheCapacity - 1)
            let victims = responseCache
                .sorted { $0.value.expiresAt < $1.value.expiresAt }
                .prefix(overflow)
                .map(\.key)
            for victim in victims {
                responseCache.removeValue(forKey: victim)
            }
        }
        responseCache[key] = CacheEntry(expiresAt: now.addingTimeInterval(ttl), value: value)
    }

    /// Stable cache key from a path plus its query params, sorted so param order
    /// never produces distinct keys for the same logical request.
    private func cacheKey(_ path: String, _ params: [String: String]) -> String {
        let sorted = params.sorted { $0.key < $1.key }.map { "\($0.key)=\($0.value)" }.joined(separator: "&")
        return "\(path)?\(sorted)"
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

        return try await cached(key: cacheKey(path, params), ttl: Self.shortTTL) {
            let response: TMDBPagedResponse<TMDBSearchResult> = try await request(path: path, params: params)
            let items = response.results.compactMap { $0.toMediaPreview() }
            return MetadataSearchResult(
                items: items,
                page: response.page,
                totalPages: response.totalPages,
                totalResults: response.totalResults
            )
        }
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
        // `credits` are fetched separately by getCast, so only request external_ids
        // here — the credits payload would otherwise be downloaded and discarded.
        let params = [
            "append_to_response": "external_ids",
            "language": "en-US"
        ]

        return try await cached(key: cacheKey(path, params), ttl: Self.shortTTL) {
            let response: TMDBDetailResponse = try await request(path: path, params: params)
            return response.toMediaItem(type: type)
        }
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

        return try await cached(key: cacheKey(path, params), ttl: Self.shortTTL) {
            let response: TMDBPagedResponse<TMDBSearchResult> = try await request(path: path, params: params)
            let items = response.results.compactMap { $0.toMediaPreview() }
            return MetadataSearchResult(
                items: items,
                page: response.page,
                totalPages: response.totalPages,
                totalResults: response.totalResults
            )
        }
    }

    func getCategory(_ category: MediaCategory, type: MediaType, page: Int = 1) async throws -> MetadataSearchResult {
        let path = "/\(type.tmdbPath)/\(category.rawValue)"
        let params = ["page": String(page), "language": "en-US"]

        return try await cached(key: cacheKey(path, params), ttl: Self.shortTTL) {
            let response: TMDBPagedResponse<TMDBSearchResult> = try await request(path: path, params: params)
            let items = response.results.compactMap { $0.toMediaPreview() }
            return MetadataSearchResult(
                items: items,
                page: response.page,
                totalPages: response.totalPages,
                totalResults: response.totalResults
            )
        }
    }

    func discover(type: MediaType, filters: DiscoverFilters) async throws -> MetadataSearchResult {
        let path = "/discover/\(type.tmdbPath)"
        var params: [String: String] = [
            "page": String(filters.page),
            "sort_by": filters.sortBy.rawValue,
            "language": "en-US",
            "include_adult": "false"
        ]
        // `with_genres` accepts a single id (legacy `genreId`) or a comma list
        // (`genreIds`, from NL→filter). When both are present they're merged.
        var genres = filters.genreIds
        if let genreId = filters.genreId { genres.insert(genreId, at: 0) }
        if !genres.isEmpty {
            params["with_genres"] = genres.map(String.init).joined(separator: ",")
        }
        if !filters.keywordIds.isEmpty {
            params["with_keywords"] = filters.keywordIds.map(String.init).joined(separator: ",")
        }
        if !filters.companyIds.isEmpty {
            params["with_companies"] = filters.companyIds.map(String.init).joined(separator: ",")
        }
        if !filters.networkIds.isEmpty, type == .series {
            params["with_networks"] = filters.networkIds.map(String.init).joined(separator: ",")
        }
        if let year = filters.year {
            if type == .movie {
                params["primary_release_year"] = String(year)
            } else {
                params["first_air_date_year"] = String(year)
            }
        }
        // Inclusive year range ("from the 2010s"). TMDB uses date-bound params,
        // distinct between movies (primary_release_date) and TV (first_air_date).
        let dateKey = type == .movie ? "primary_release_date" : "first_air_date"
        if let yearGTE = filters.yearGTE {
            params["\(dateKey).gte"] = "\(yearGTE)-01-01"
        }
        if let yearLTE = filters.yearLTE {
            params["\(dateKey).lte"] = "\(yearLTE)-12-31"
        }
        if let minRating = filters.minRating {
            params["vote_average.gte"] = String(minRating)
            params["vote_count.gte"] = "100"
        }

        return try await cached(key: cacheKey(path, params), ttl: Self.shortTTL) {
            let response: TMDBPagedResponse<TMDBSearchResult> = try await request(path: path, params: params)
            let items = response.results.compactMap { $0.toMediaPreview() }
            return MetadataSearchResult(
                items: items,
                page: response.page,
                totalPages: response.totalPages,
                totalResults: response.totalResults
            )
        }
    }

    func getGenres(type: MediaType) async throws -> [Genre] {
        let path = "/genre/\(type.tmdbPath)/list"
        let params = ["language": "en-US"]
        return try await cached(key: cacheKey(path, params), ttl: Self.longTTL) {
            let response: TMDBGenresResponse = try await request(path: path, params: params)
            return response.genres.map { Genre(id: $0.id, name: $0.name) }
        }
    }

    func getSeasons(tmdbId: Int) async throws -> [Season] {
        let path = "/tv/\(tmdbId)"
        let params = ["language": "en-US"]
        return try await cached(key: cacheKey(path, params), ttl: Self.shortTTL) {
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
    }

    func getEpisodes(tmdbId: Int, season: Int) async throws -> [Episode] {
        let path = "/tv/\(tmdbId)/season/\(season)"
        let params = ["language": "en-US"]
        return try await cached(key: cacheKey(path, params), ttl: Self.shortTTL) {
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
    }

    func getExternalIds(tmdbId: Int, type: MediaType) async throws -> ExternalIds {
        let path = "/\(type.tmdbPath)/\(tmdbId)/external_ids"
        return try await request(path: path, params: [:])
    }

    func getCast(tmdbId: Int, type: MediaType) async throws -> [CastMember] {
        let path = "/\(type.tmdbPath)/\(tmdbId)/credits"
        let params = ["language": "en-US"]
        return try await cached(key: cacheKey(path, params), ttl: Self.shortTTL) {
            let response: TMDBCredits = try await request(path: path, params: params)
            return response.cast.map {
                CastMember(id: $0.id, name: $0.name, character: $0.character ?? "", profilePath: $0.profilePath)
            }
        }
    }

    func getRecommendations(tmdbId: Int, type: MediaType) async throws -> [MediaPreview] {
        let path = "/\(type.tmdbPath)/\(tmdbId)/recommendations"
        let params = ["language": "en-US", "page": "1"]
        return try await cached(key: cacheKey(path, params), ttl: Self.shortTTL) {
            let response: TMDBPagedResponse<TMDBSearchResult> = try await request(path: path, params: params)
            return response.results.compactMap { $0.toMediaPreview() }
        }
    }

    // MARK: - Person / Cast pages

    func getPerson(personId: Int) async throws -> Person {
        let path = "/person/\(personId)"
        let params = ["language": "en-US"]
        return try await cached(key: cacheKey(path, params), ttl: Self.shortTTL) {
            let response: TMDBPersonResponse = try await request(path: path, params: params)
            return Person(
                id: response.id,
                name: response.name,
                biography: response.biography,
                knownForDepartment: response.knownForDepartment,
                profilePath: response.profilePath,
                birthday: response.birthday,
                placeOfBirth: response.placeOfBirth
            )
        }
    }

    func getPersonCredits(personId: Int) async throws -> [MediaPreview] {
        let path = "/person/\(personId)/combined_credits"
        let params = ["language": "en-US"]
        return try await cached(key: cacheKey(path, params), ttl: Self.shortTTL) {
            let response: TMDBCombinedCreditsResponse = try await request(path: path, params: params)
            // Cast + crew rows, mapped to MediaPreview. De-dupe by id (a person can
            // appear as both actor and writer on the same title), then sort by
            // popularity desc with recency as a tie-break so the best-known work
            // surfaces first.
            var seen = Set<Int>()
            var entries: [(preview: MediaPreview, popularity: Double, year: Int)] = []
            for credit in response.cast + response.crew {
                guard let preview = credit.toMediaPreview() else { continue }
                guard seen.insert(credit.id).inserted else { continue }
                entries.append((preview, credit.popularity ?? 0, preview.year ?? 0))
            }
            entries.sort {
                if $0.popularity != $1.popularity { return $0.popularity > $1.popularity }
                return $0.year > $1.year
            }
            return entries.map(\.preview)
        }
    }

    func searchKeywords(query: String) async throws -> [TMDBKeyword] {
        let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return [] }
        let path = "/search/keyword"
        let params = ["query": trimmed, "page": "1"]
        return try await cached(key: cacheKey(path, params), ttl: Self.longTTL) {
            let response: TMDBPagedResponse<TMDBKeyword> = try await request(path: path, params: params)
            return response.results
        }
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

// MARK: - Person responses

struct TMDBPersonResponse: Decodable {
    let id: Int
    let name: String
    let biography: String?
    let knownForDepartment: String?
    let profilePath: String?
    let birthday: String?
    let placeOfBirth: String?
}

/// `/person/{id}/combined_credits` — cast + crew filmography across movies + TV.
struct TMDBCombinedCreditsResponse: Decodable {
    let cast: [TMDBPersonCredit]
    let crew: [TMDBPersonCredit]
}

/// One filmography entry. `mediaType` is always present on combined_credits, so
/// movie/TV mapping is unambiguous. Reuses the same fields as a search result.
struct TMDBPersonCredit: Decodable {
    let id: Int
    let title: String?       // Movies
    let name: String?         // TV
    let mediaType: String?
    let posterPath: String?
    let backdropPath: String?
    let releaseDate: String?  // Movies
    let firstAirDate: String? // TV
    let voteAverage: Double?
    let popularity: Double?

    func toMediaPreview() -> MediaPreview? {
        let displayTitle = title ?? name ?? ""
        guard !displayTitle.isEmpty else { return nil }

        let type: MediaType
        switch mediaType {
        case "movie": type = .movie
        case "tv": type = .series
        default: return nil  // Skip non-title credits.
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
