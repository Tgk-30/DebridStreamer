import Foundation
import GRDB

/// Aggregate preference profile built from taste events.
struct UserTasteProfile: Codable, Sendable, Identifiable, Equatable, FetchableRecord, PersistableRecord {
    static let databaseTableName = "user_taste_profile"

    var userId: String
    var likedGenres: [String]
    var dislikedGenres: [String]
    var preferredDecades: [Int]
    var preferredLanguages: [String]
    var eventCount: Int
    var updatedAt: Date

    var id: String { userId }

    enum Columns: String, ColumnExpression {
        case userId, likedGenres, dislikedGenres, preferredDecades, preferredLanguages, eventCount, updatedAt
    }

    func encode(to container: inout PersistenceContainer) {
        container[Columns.userId] = userId
        container[Columns.likedGenres] = try? JSONEncoder().encode(likedGenres)
        container[Columns.dislikedGenres] = try? JSONEncoder().encode(dislikedGenres)
        container[Columns.preferredDecades] = try? JSONEncoder().encode(preferredDecades)
        container[Columns.preferredLanguages] = try? JSONEncoder().encode(preferredLanguages)
        container[Columns.eventCount] = eventCount
        container[Columns.updatedAt] = updatedAt
    }

    init(row: Row) throws {
        userId = row[Columns.userId]

        if let likedData = row[Columns.likedGenres] as Data? {
            likedGenres = (try? JSONDecoder().decode([String].self, from: likedData)) ?? []
        } else {
            likedGenres = []
        }

        if let dislikedData = row[Columns.dislikedGenres] as Data? {
            dislikedGenres = (try? JSONDecoder().decode([String].self, from: dislikedData)) ?? []
        } else {
            dislikedGenres = []
        }

        if let decadeData = row[Columns.preferredDecades] as Data? {
            preferredDecades = (try? JSONDecoder().decode([Int].self, from: decadeData)) ?? []
        } else {
            preferredDecades = []
        }

        if let languageData = row[Columns.preferredLanguages] as Data? {
            preferredLanguages = (try? JSONDecoder().decode([String].self, from: languageData)) ?? []
        } else {
            preferredLanguages = []
        }

        eventCount = row[Columns.eventCount] ?? 0
        updatedAt = row[Columns.updatedAt]
    }

    init(
        userId: String = "default",
        likedGenres: [String] = [],
        dislikedGenres: [String] = [],
        preferredDecades: [Int] = [],
        preferredLanguages: [String] = [],
        eventCount: Int = 0,
        updatedAt: Date = Date()
    ) {
        self.userId = userId
        self.likedGenres = likedGenres
        self.dislikedGenres = dislikedGenres
        self.preferredDecades = preferredDecades
        self.preferredLanguages = preferredLanguages
        self.eventCount = eventCount
        self.updatedAt = updatedAt
    }
}
