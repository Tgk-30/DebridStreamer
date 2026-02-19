import Foundation
import GRDB

/// Event log of user preference signals used to personalize recommendations.
struct TasteEvent: Codable, Sendable, Identifiable, Equatable, FetchableRecord, PersistableRecord {
    static let databaseTableName = "taste_events"

    var id: String
    var userId: String
    var mediaId: String?
    var episodeId: String?
    var eventType: EventType
    var signalStrength: Double
    var watchedState: WatchedState?
    var feedbackScale: FeedbackScaleMode?
    var feedbackValue: Double?
    var source: FeedbackSource?
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
        case notInterested = "not_interested"
    }

    enum Columns: String, ColumnExpression {
        case id, userId, mediaId, episodeId, eventType, signalStrength, watchedState, feedbackScale, feedbackValue, source, metadata, createdAt
    }

    func encode(to container: inout PersistenceContainer) {
        container[Columns.id] = id
        container[Columns.userId] = userId
        container[Columns.mediaId] = mediaId
        container[Columns.episodeId] = episodeId
        container[Columns.eventType] = eventType.rawValue
        container[Columns.signalStrength] = signalStrength
        container[Columns.watchedState] = watchedState?.rawValue
        container[Columns.feedbackScale] = feedbackScale?.rawValue
        container[Columns.feedbackValue] = feedbackValue
        container[Columns.source] = source?.rawValue
        container[Columns.metadata] = try? JSONEncoder().encode(metadata)
        container[Columns.createdAt] = createdAt
    }

    init(row: Row) throws {
        id = row[Columns.id]
        userId = row[Columns.userId]
        mediaId = row[Columns.mediaId]
        episodeId = row[Columns.episodeId]
        eventType = EventType(rawValue: row[Columns.eventType] as String) ?? .watched
        signalStrength = row[Columns.signalStrength]
        let watchedStateValue: String? = row[Columns.watchedState]
        watchedState = watchedStateValue.flatMap(WatchedState.init(rawValue:))
        let feedbackScaleValue: String? = row[Columns.feedbackScale]
        feedbackScale = feedbackScaleValue.flatMap(FeedbackScaleMode.init(rawValue:))
        feedbackValue = row[Columns.feedbackValue]
        let sourceValue: String? = row[Columns.source]
        source = sourceValue.flatMap(FeedbackSource.init(rawValue:))
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
        episodeId: String? = nil,
        eventType: EventType,
        signalStrength: Double = 1.0,
        watchedState: WatchedState? = nil,
        feedbackScale: FeedbackScaleMode? = nil,
        feedbackValue: Double? = nil,
        source: FeedbackSource? = nil,
        metadata: [String: String] = [:],
        createdAt: Date = Date()
    ) {
        self.id = id
        self.userId = userId
        self.mediaId = mediaId
        self.episodeId = episodeId
        self.eventType = eventType
        self.signalStrength = signalStrength
        self.watchedState = watchedState
        self.feedbackScale = feedbackScale
        self.feedbackValue = feedbackValue
        self.source = source
        self.metadata = metadata
        self.createdAt = createdAt
    }
}
