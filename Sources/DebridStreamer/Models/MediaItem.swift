import Foundation
import GRDB

/// A movie or TV show with metadata from TMDB.
struct MediaItem: Codable, Sendable, Identifiable, Equatable, FetchableRecord, PersistableRecord {
    static let databaseTableName = "media_cache"

    var id: String               // IMDB ID (tt1234567) or tmdb-{id}
    var type: MediaType
    var title: String
    var year: Int?
    var posterPath: String?
    var backdropPath: String?
    var overview: String?
    var genres: [String]
    var imdbRating: Double?
    var rtRating: Int?
    var runtime: Int?            // minutes
    var status: String?
    var tmdbId: Int?
    var lastFetched: Date

    // Computed poster/backdrop URLs
    var posterURL: URL? {
        guard let path = posterPath else { return nil }
        return URL(string: "https://image.tmdb.org/t/p/w500\(path)")
    }

    var backdropURL: URL? {
        guard let path = backdropPath else { return nil }
        return URL(string: "https://image.tmdb.org/t/p/w1280\(path)")
    }

    var posterThumbnailURL: URL? {
        guard let path = posterPath else { return nil }
        return URL(string: "https://image.tmdb.org/t/p/w342\(path)")
    }

    var yearString: String {
        guard let year = year else { return "" }
        return String(year)
    }

    var ratingString: String {
        guard let rating = imdbRating else { return "N/A" }
        return String(format: "%.1f", rating)
    }

    var runtimeString: String {
        guard let runtime = runtime, runtime > 0 else { return "" }
        let hours = runtime / 60
        let minutes = runtime % 60
        if hours > 0 {
            return "\(hours)h \(minutes)m"
        }
        return "\(minutes)m"
    }

    // MARK: - GRDB Column Encoding

    enum Columns: String, ColumnExpression {
        case id, type, title, year, posterPath, backdropPath, overview
        case genres, imdbRating, rtRating, runtime, status, tmdbId, lastFetched
    }

    func encode(to container: inout PersistenceContainer) {
        container[Columns.id] = id
        container[Columns.type] = type.rawValue
        container[Columns.title] = title
        container[Columns.year] = year
        container[Columns.posterPath] = posterPath
        container[Columns.backdropPath] = backdropPath
        container[Columns.overview] = overview
        container[Columns.genres] = try? JSONEncoder().encode(genres)
        container[Columns.imdbRating] = imdbRating
        container[Columns.rtRating] = rtRating
        container[Columns.runtime] = runtime
        container[Columns.status] = status
        container[Columns.tmdbId] = tmdbId
        container[Columns.lastFetched] = lastFetched
    }

    init(row: Row) throws {
        id = row[Columns.id]
        type = MediaType(rawValue: row[Columns.type] as String) ?? .movie
        title = row[Columns.title]
        year = row[Columns.year]
        posterPath = row[Columns.posterPath]
        backdropPath = row[Columns.backdropPath]
        overview = row[Columns.overview]
        if let genreData = row[Columns.genres] as Data? {
            genres = (try? JSONDecoder().decode([String].self, from: genreData)) ?? []
        } else {
            genres = []
        }
        imdbRating = row[Columns.imdbRating]
        rtRating = row[Columns.rtRating]
        runtime = row[Columns.runtime]
        status = row[Columns.status]
        tmdbId = row[Columns.tmdbId]
        lastFetched = row[Columns.lastFetched]
    }

    init(
        id: String,
        type: MediaType,
        title: String,
        year: Int? = nil,
        posterPath: String? = nil,
        backdropPath: String? = nil,
        overview: String? = nil,
        genres: [String] = [],
        imdbRating: Double? = nil,
        rtRating: Int? = nil,
        runtime: Int? = nil,
        status: String? = nil,
        tmdbId: Int? = nil,
        lastFetched: Date = Date()
    ) {
        self.id = id
        self.type = type
        self.title = title
        self.year = year
        self.posterPath = posterPath
        self.backdropPath = backdropPath
        self.overview = overview
        self.genres = genres
        self.imdbRating = imdbRating
        self.rtRating = rtRating
        self.runtime = runtime
        self.status = status
        self.tmdbId = tmdbId
        self.lastFetched = lastFetched
    }
}

/// A preview/summary version of MediaItem for catalog listings.
struct MediaPreview: Codable, Sendable, Identifiable, Equatable {
    var id: String
    var type: MediaType
    var title: String
    var year: Int?
    var posterPath: String?
    var imdbRating: Double?
    var tmdbId: Int?
    /// Optional 16:9 backdrop path - populated for hero/spotlight surfaces.
    /// Declared last with a default so the memberwise init and Codable stay
    /// backward-compatible with existing call sites and cached JSON.
    var backdropPath: String? = nil

    var posterURL: URL? {
        guard let path = posterPath else { return nil }
        return URL(string: "https://image.tmdb.org/t/p/w342\(path)")
    }

    /// Full-bleed backdrop for the Discover hero/spotlight (w1280).
    var backdropURL: URL? {
        guard let path = backdropPath else { return nil }
        return URL(string: "https://image.tmdb.org/t/p/w1280\(path)")
    }

    var ratingString: String {
        guard let rating = imdbRating else { return "" }
        return String(format: "%.1f", rating)
    }
}
