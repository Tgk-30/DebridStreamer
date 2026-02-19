import Foundation
import GRDB

/// Tracks a user's watch progress for a movie or episode.
struct WatchHistory: Codable, Sendable, Identifiable, Equatable, FetchableRecord, PersistableRecord {
    static let databaseTableName = "watch_history"

    var id: String
    var mediaId: String
    var episodeId: String?       // nil for movies
    var progressSeconds: Double
    var durationSeconds: Double?
    var completed: Bool
    var lastWatched: Date
    var streamQuality: String?

    /// Progress as a percentage (0.0 - 1.0).
    var progressPercent: Double {
        guard let duration = durationSeconds, duration > 0 else { return 0 }
        return min(progressSeconds / duration, 1.0)
    }

    /// Formatted progress string like "1:23:45 / 2:01:30".
    var progressString: String {
        let current = Self.formatTime(progressSeconds)
        if let duration = durationSeconds {
            return "\(current) / \(Self.formatTime(duration))"
        }
        return current
    }

    /// Whether the user has meaningful progress (>2% and <95%).
    var hasResumePoint: Bool {
        progressPercent > 0.02 && progressPercent < 0.95
    }

    private static func formatTime(_ seconds: Double) -> String {
        let totalSeconds = Int(seconds)
        let hours = totalSeconds / 3600
        let minutes = (totalSeconds % 3600) / 60
        let secs = totalSeconds % 60
        if hours > 0 {
            return String(format: "%d:%02d:%02d", hours, minutes, secs)
        }
        return String(format: "%d:%02d", minutes, secs)
    }

    enum Columns: String, ColumnExpression {
        case id, mediaId, episodeId, progressSeconds
        case durationSeconds, completed, lastWatched, streamQuality
    }
}

/// A user's library entry (watchlist, favorites, etc.).
struct UserLibraryEntry: Codable, Sendable, Identifiable, Equatable, FetchableRecord, PersistableRecord {
    static let databaseTableName = "user_library"

    var id: String
    var mediaId: String
    var folderId: String?
    var listType: ListType
    var addedAt: Date
    var customListName: String?
    var releaseDateHint: String?
    var renewalStatus: String?

    enum ListType: String, Codable, Sendable, CaseIterable {
        case watchlist
        case favorites
        case custom

        var supportsFolders: Bool {
            switch self {
            case .watchlist:
                return false
            case .favorites, .custom:
                return true
            }
        }
    }

    enum Columns: String, ColumnExpression {
        case id, mediaId, folderId, listType, addedAt, customListName, releaseDateHint, renewalStatus
    }

    init(
        id: String,
        mediaId: String,
        folderId: String? = nil,
        listType: ListType,
        addedAt: Date = Date(),
        customListName: String? = nil,
        releaseDateHint: String? = nil,
        renewalStatus: String? = nil
    ) {
        self.id = id
        self.mediaId = mediaId
        self.folderId = folderId
        self.listType = listType
        self.addedAt = addedAt
        self.customListName = customListName
        self.releaseDateHint = releaseDateHint
        self.renewalStatus = renewalStatus
    }
}
