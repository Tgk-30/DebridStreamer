import Foundation
import GRDB

/// Event log of user preference signals used to personalize recommendations.
struct TasteEvent: Codable, Sendable, Identifiable, Equatable, FetchableRecord, PersistableRecord {
    static let databaseTableName = "taste_events"

    var id: String
    var userId: String
    var mediaId: String?
    var eventType: EventType
    var signalStrength: Double
    var metadata: [String: String]
    var createdAt: Date

    enum EventType: String, Codable, Sendable, CaseIterable {
        case watched
        case completed
        case liked
        case disliked
        case addedToWatchlist = "added_to_watchlist"
        case removedFromWatchlist = "removed_from_watchlist"
        case searched
        case rated
    }

    enum Columns: String, ColumnExpression {
        case id, userId, mediaId, eventType, signalStrength, metadata, createdAt
    }

    func encode(to container: inout PersistenceContainer) {
        container[Columns.id] = id
        container[Columns.userId] = userId
        container[Columns.mediaId] = mediaId
        container[Columns.eventType] = eventType.rawValue
        container[Columns.signalStrength] = signalStrength
        container[Columns.metadata] = try? JSONEncoder().encode(metadata)
        container[Columns.createdAt] = createdAt
    }

    init(row: Row) throws {
        id = row[Columns.id]
        userId = row[Columns.userId]
        mediaId = row[Columns.mediaId]
        eventType = EventType(rawValue: row[Columns.eventType] as String) ?? .watched
        signalStrength = row[Columns.signalStrength]
        if let metadataData = row[Columns.metadata] as Data? {
            metadata = (try? JSONDecoder().decode([String: String].self, from: metadataData)) ?? [:]
        } else {
            metadata = [:]
        }
        createdAt = row[Columns.createdAt]
    }

    init(
        id: String,
        userId: String = "default",
        mediaId: String? = nil,
        eventType: EventType,
        signalStrength: Double = 1.0,
        metadata: [String: String] = [:],
        createdAt: Date = Date()
    ) {
        self.id = id
        self.userId = userId
        self.mediaId = mediaId
        self.eventType = eventType
        self.signalStrength = signalStrength
        self.metadata = metadata
        self.createdAt = createdAt
    }
}
