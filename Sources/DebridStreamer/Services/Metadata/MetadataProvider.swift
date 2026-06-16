import Foundation

/// Filters for content discovery.
struct DiscoverFilters: Sendable {
    var genreId: Int?
    var year: Int?
    var minRating: Double?
    var sortBy: SortOption
    var page: Int

    init(genreId: Int? = nil, year: Int? = nil, minRating: Double? = nil, sortBy: SortOption = .popularityDesc, page: Int = 1) {
        self.genreId = genreId
        self.year = year
        self.minRating = minRating
        self.sortBy = sortBy
        self.page = page
    }

    enum SortOption: String, Sendable, CaseIterable {
        case popularityDesc = "popularity.desc"
        case popularityAsc = "popularity.asc"
        case ratingDesc = "vote_average.desc"
        case ratingAsc = "vote_average.asc"
        case releaseDateDesc = "primary_release_date.desc"
        case releaseDateAsc = "primary_release_date.asc"
        case titleAsc = "title.asc"

        var displayName: String {
            switch self {
            case .popularityDesc: return "Most Popular"
            case .popularityAsc: return "Least Popular"
            case .ratingDesc: return "Highest Rated"
            case .ratingAsc: return "Lowest Rated"
            case .releaseDateDesc: return "Newest"
            case .releaseDateAsc: return "Oldest"
            case .titleAsc: return "Title A-Z"
            }
        }
    }
}

/// A genre for filtering content.
struct Genre: Codable, Sendable, Identifiable, Equatable {
    var id: Int
    var name: String
}

/// Protocol for metadata providers (TMDB, OMDB, etc.).
protocol MetadataProvider: Sendable {
    /// Search for media by text query.
    func search(query: String, type: MediaType?, page: Int) async throws -> MetadataSearchResult

    /// Get full detail for a specific item.
    func getDetail(id: String, type: MediaType) async throws -> MediaItem

    /// Get trending content.
    func getTrending(type: MediaType, timeWindow: TrendingWindow, page: Int) async throws -> MetadataSearchResult

    /// Get content by category.
    func getCategory(_ category: MediaCategory, type: MediaType, page: Int) async throws -> MetadataSearchResult

    /// Discover content with filters.
    func discover(type: MediaType, filters: DiscoverFilters) async throws -> MetadataSearchResult

    /// Get available genres.
    func getGenres(type: MediaType) async throws -> [Genre]

    /// Get seasons/episodes for a TV show.
    func getSeasons(tmdbId: Int) async throws -> [Season]

    /// Get episodes for a specific season.
    func getEpisodes(tmdbId: Int, season: Int) async throws -> [Episode]

    /// Get external IDs (IMDB ID) for a TMDB item.
    func getExternalIds(tmdbId: Int, type: MediaType) async throws -> ExternalIds

    /// Get the top-billed cast for a TMDB item (L23 — Detail cast row).
    func getCast(tmdbId: Int, type: MediaType) async throws -> [CastMember]

    /// Get "more like this" recommendations for a TMDB item (L23 — related row).
    func getRecommendations(tmdbId: Int, type: MediaType) async throws -> [MediaPreview]
}

/// Search result with pagination info.
struct MetadataSearchResult: Sendable {
    var items: [MediaPreview]
    var page: Int
    var totalPages: Int
    var totalResults: Int
}

/// Trending time window.
enum TrendingWindow: String, Sendable {
    case day
    case week
}

/// Content category for browsing.
enum MediaCategory: String, Sendable, CaseIterable {
    case popular
    case topRated = "top_rated"
    case nowPlaying = "now_playing"    // Movies
    case upcoming                       // Movies
    case airingToday = "airing_today"  // TV
    case onTheAir = "on_the_air"       // TV

    var displayName: String {
        switch self {
        case .popular: return "Popular"
        case .topRated: return "Top Rated"
        case .nowPlaying: return "Now Playing"
        case .upcoming: return "Upcoming"
        case .airingToday: return "Airing Today"
        case .onTheAir: return "On The Air"
        }
    }

    static func categories(for type: MediaType) -> [MediaCategory] {
        switch type {
        case .movie: return [.popular, .topRated, .nowPlaying, .upcoming]
        case .series: return [.popular, .topRated, .airingToday, .onTheAir]
        }
    }
}

/// External IDs for a media item.
struct ExternalIds: Codable, Sendable {
    var imdbId: String?
    var tvdbId: Int?

    enum CodingKeys: String, CodingKey {
        case imdbId = "imdb_id"
        case tvdbId = "tvdb_id"
    }
}
