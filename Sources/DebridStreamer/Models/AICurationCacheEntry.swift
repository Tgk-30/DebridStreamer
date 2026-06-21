import Foundation
import GRDB

/// Cached AI curation response for discover prompts/filters.
struct AICurationCacheEntry: Codable, Sendable, Identifiable, Equatable, FetchableRecord, PersistableRecord {
    static let databaseTableName = "discover_ai_cache"

    var cacheKey: String
    var payload: Data
    var model: String?
    var createdAt: Date
    var expiresAt: Date

    var id: String { cacheKey }

    enum Columns: String, ColumnExpression {
        case cacheKey, payload, model, createdAt, expiresAt
    }

    func encode(to container: inout PersistenceContainer) {
        container[Columns.cacheKey] = cacheKey
        container[Columns.payload] = payload
        container[Columns.model] = model
        container[Columns.createdAt] = createdAt
        container[Columns.expiresAt] = expiresAt
    }

    init(row: Row) throws {
        cacheKey = row[Columns.cacheKey]
        payload = row[Columns.payload]
        model = row[Columns.model]
        createdAt = row[Columns.createdAt]
        expiresAt = row[Columns.expiresAt]
    }

    init(
        cacheKey: String,
        payload: Data,
        model: String? = nil,
        createdAt: Date = Date(),
        expiresAt: Date
    ) {
        self.cacheKey = cacheKey
        self.payload = payload
        self.model = model
        self.createdAt = createdAt
        self.expiresAt = expiresAt
    }
}
