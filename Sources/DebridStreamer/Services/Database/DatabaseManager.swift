import Foundation
import GRDB

enum DatabaseManagerError: LocalizedError, Equatable {
    case foldersNotSupported(UserLibraryEntry.ListType)

    var errorDescription: String? {
        switch self {
        case .foldersNotSupported(let listType):
            return "Folders are not supported for \(listType.rawValue)."
        }
    }
}

/// Actor managing all SQLite database operations via GRDB.
actor DatabaseManager {
    let dbPool: DatabasePool

    /// Initialize with the default app database location.
    init() throws {
        let appSupport = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first!
        let dbDir = appSupport.appendingPathComponent("DebridStreamer", isDirectory: true)
        try FileManager.default.createDirectory(at: dbDir, withIntermediateDirectories: true)
        let dbPath = dbDir.appendingPathComponent("db.sqlite").path

        var config = Configuration()
        if ProcessInfo.processInfo.environment["DEBRID_STREAMER_TRACE_SQL"] == "1" {
            config.prepareDatabase { db in
                db.trace { print("SQL: \($0)") }
            }
        }

        dbPool = try DatabasePool(path: dbPath, configuration: config)
        try Self.makeMigrator().migrate(dbPool)
    }

    /// Initialize with a custom database pool (for testing).
    init(dbPool: DatabasePool) throws {
        self.dbPool = dbPool
        try Self.makeMigrator().migrate(dbPool)
    }

    // MARK: - Migrations

    private static func makeMigrator() -> DatabaseMigrator {
        var migrator = DatabaseMigrator()

        #if DEBUG
        // Keep migrations additive in debug so upgrade paths are exercised in tests
        // and local data is not silently wiped when schema evolves.
        migrator.eraseDatabaseOnSchemaChange = false
        #endif

        migrator.registerMigration("v1_core") { db in
            // Media metadata cache
            try db.create(table: "media_cache") { t in
                t.primaryKey("id", .text).notNull()
                t.column("type", .text).notNull()
                t.column("title", .text).notNull()
                t.column("year", .integer)
                t.column("posterPath", .text)
                t.column("backdropPath", .text)
                t.column("overview", .text)
                t.column("genres", .blob)
                t.column("imdbRating", .double)
                t.column("rtRating", .integer)
                t.column("runtime", .integer)
                t.column("status", .text)
                t.column("tmdbId", .integer)
                t.column("lastFetched", .datetime).notNull()
            }

            // TV episodes
            try db.create(table: "episodes") { t in
                t.primaryKey("id", .text).notNull()
                t.column("mediaId", .text).notNull()
                    .references("media_cache", onDelete: .cascade)
                t.column("seasonNumber", .integer).notNull()
                t.column("episodeNumber", .integer).notNull()
                t.column("title", .text)
                t.column("overview", .text)
                t.column("airDate", .text)
                t.column("stillPath", .text)
                t.column("runtime", .integer)
            }
            try db.create(indexOn: "episodes", columns: ["mediaId", "seasonNumber"])

            // Watch history
            try db.create(table: "watch_history") { t in
                t.primaryKey("id", .text).notNull()
                t.column("mediaId", .text).notNull()
                t.column("episodeId", .text)
                t.column("progressSeconds", .double).notNull().defaults(to: 0)
                t.column("durationSeconds", .double)
                t.column("completed", .boolean).notNull().defaults(to: false)
                t.column("lastWatched", .datetime).notNull()
                t.column("streamQuality", .text)
            }
            try db.create(indexOn: "watch_history", columns: ["mediaId"])
            try db.create(indexOn: "watch_history", columns: ["lastWatched"])

            // User library
            try db.create(table: "user_library") { t in
                t.primaryKey("id", .text).notNull()
                t.column("mediaId", .text).notNull()
                t.column("listType", .text).notNull()
                t.column("addedAt", .datetime).notNull()
                t.column("customListName", .text)
            }
            try db.create(indexOn: "user_library", columns: ["mediaId"])
            try db.create(indexOn: "user_library", columns: ["listType"])

            // Torrent cache
            try db.create(table: "torrent_cache") { t in
                t.primaryKey("infoHash", .text).notNull()
                t.column("mediaId", .text).notNull()
                t.column("title", .text).notNull()
                t.column("sizeBytes", .integer)
                t.column("quality", .text)
                t.column("source", .text)
                t.column("seeders", .integer)
                t.column("codec", .text)
                t.column("audio", .text)
                t.column("cachedOnDebrid", .boolean).defaults(to: false)
                t.column("lastChecked", .datetime).notNull()
            }

            // Debrid service configs
            try db.create(table: "debrid_configs") { t in
                t.primaryKey("id", .text).notNull()
                t.column("service", .text).notNull()
                t.column("apiToken", .text).notNull()
                t.column("isActive", .boolean).defaults(to: true)
                t.column("priority", .integer).defaults(to: 0)
            }

            // Indexer configs
            try db.create(table: "indexer_configs") { t in
                t.primaryKey("id", .text).notNull()
                t.column("type", .text).notNull()
                t.column("baseURL", .text).notNull()
                t.column("apiKey", .text)
                t.column("isActive", .boolean).defaults(to: true)
            }

            // App settings (key-value)
            try db.create(table: "app_settings") { t in
                t.primaryKey("key", .text).notNull()
                t.column("value", .text)
            }

            // Full-text search for media
            try db.create(virtualTable: "media_fts", using: FTS5()) { t in
                t.synchronize(withTable: "media_cache")
                t.column("title")
                t.column("overview")
            }
        }

        migrator.registerMigration("v2_indexers_ext") { db in
            try db.alter(table: "indexer_configs") { t in
                t.add(column: "displayName", .text)
                t.add(column: "providerSubtype", .text).defaults(to: "custom_torznab")
                t.add(column: "endpointPath", .text).defaults(to: "/api")
                t.add(column: "categoryFilter", .text)
                t.add(column: "priority", .integer).defaults(to: 0)
            }
        }

        migrator.registerMigration("v3_ai_assistant") { db in
            try db.create(table: "assistant_conversations", ifNotExists: true) { t in
                t.primaryKey("id", .text).notNull()
                t.column("prompt", .text).notNull()
                t.column("provider", .text).notNull()
                t.column("response", .blob).notNull()
                t.column("createdAt", .datetime).notNull()
            }
            try db.execute(sql: "CREATE INDEX IF NOT EXISTS idx_assistant_conversations_createdAt ON assistant_conversations(createdAt)")

            try db.create(table: "ai_recommendation_cache", ifNotExists: true) { t in
                t.primaryKey("cacheKey", .text).notNull()
                t.column("response", .blob).notNull()
                t.column("expiresAt", .datetime).notNull()
                t.column("createdAt", .datetime).notNull()
            }
        }

        migrator.registerMigration("v4_sync_state") { db in
            try db.create(table: "sync_accounts", ifNotExists: true) { t in
                t.primaryKey("id", .text).notNull()
                t.column("provider", .text).notNull()
                t.column("accountId", .text)
                t.column("status", .text).notNull()
                t.column("updatedAt", .datetime).notNull()
            }

            try db.create(table: "sync_jobs", ifNotExists: true) { t in
                t.primaryKey("id", .text).notNull()
                t.column("provider", .text).notNull()
                t.column("direction", .text).notNull()
                t.column("status", .text).notNull()
                t.column("startedAt", .datetime)
                t.column("completedAt", .datetime)
                t.column("errorMessage", .text)
            }

            try db.create(table: "library_sync_map", ifNotExists: true) { t in
                t.primaryKey("id", .text).notNull()
                t.column("provider", .text).notNull()
                t.column("remoteId", .text).notNull()
                t.column("mediaId", .text).notNull()
            }
        }

        migrator.registerMigration("v5_library_folders") { db in
            try db.create(table: "library_folders", ifNotExists: true) { t in
                t.primaryKey("id", .text).notNull()
                t.column("name", .text).notNull()
                t.column("parentId", .text).references("library_folders", onDelete: .cascade)
                t.column("listType", .text).notNull()
                t.column("folderKind", .text).notNull().defaults(to: LibraryFolder.FolderKind.manual.rawValue)
                t.column("isSystem", .boolean).notNull().defaults(to: false)
                t.column("createdAt", .datetime).notNull()
                t.column("updatedAt", .datetime).notNull()
            }
            try db.execute(sql: "CREATE INDEX IF NOT EXISTS idx_library_folders_parentId ON library_folders(parentId)")
            try db.execute(sql: "CREATE INDEX IF NOT EXISTS idx_library_folders_listType ON library_folders(listType)")

            if try db.tableExists("user_library") {
                let hasFolderId = try db.columns(in: "user_library").contains(where: { $0.name == "folderId" })
                if !hasFolderId {
                    try db.alter(table: "user_library") { t in
                        t.add(column: "folderId", .text)
                    }
                }

                let now = Date()
                for listType in UserLibraryEntry.ListType.allCases {
                    let folder = LibraryFolder(
                        id: LibraryFolder.systemFolderID(for: listType),
                        name: LibraryFolder.systemFolderName(for: listType),
                        listType: listType,
                        folderKind: .systemRoot,
                        isSystem: true,
                        createdAt: now,
                        updatedAt: now
                    )
                    try folder.insert(db, onConflict: .ignore)
                }

                try db.execute(
                    sql: """
                    UPDATE user_library
                    SET folderId = CASE listType
                        WHEN 'watchlist' THEN ?
                        WHEN 'favorites' THEN ?
                        ELSE ?
                    END
                    WHERE folderId IS NULL OR folderId = ''
                    """,
                    arguments: [
                        LibraryFolder.systemFolderID(for: .watchlist),
                        LibraryFolder.systemFolderID(for: .favorites),
                        LibraryFolder.systemFolderID(for: .custom)
                    ]
                )

                try db.execute(
                    sql: """
                    DELETE FROM user_library
                    WHERE rowid NOT IN (
                        SELECT MIN(rowid)
                        FROM user_library
                        GROUP BY mediaId, folderId
                    )
                    """
                )
                try db.execute(sql: "CREATE INDEX IF NOT EXISTS idx_user_library_folderId ON user_library(folderId)")
                try db.execute(sql: "CREATE UNIQUE INDEX IF NOT EXISTS idx_user_library_media_folder ON user_library(mediaId, folderId)")
            }
        }

        migrator.registerMigration("v6_taste_profile") { db in
            try db.create(table: "user_taste_profile", ifNotExists: true) { t in
                t.primaryKey("userId", .text).notNull()
                t.column("likedGenres", .blob)
                t.column("dislikedGenres", .blob)
                t.column("preferredDecades", .blob)
                t.column("preferredLanguages", .blob)
                t.column("eventCount", .integer).notNull().defaults(to: 0)
                t.column("updatedAt", .datetime).notNull()
            }

            try db.create(table: "taste_events", ifNotExists: true) { t in
                t.primaryKey("id", .text).notNull()
                t.column("userId", .text).notNull()
                t.column("mediaId", .text)
                t.column("eventType", .text).notNull()
                t.column("signalStrength", .double).notNull().defaults(to: 1.0)
                t.column("metadata", .blob)
                t.column("createdAt", .datetime).notNull()
            }

            try db.execute(sql: "CREATE INDEX IF NOT EXISTS idx_taste_events_userId ON taste_events(userId)")
            try db.execute(sql: "CREATE INDEX IF NOT EXISTS idx_taste_events_createdAt ON taste_events(createdAt)")
            try db.execute(sql: "CREATE INDEX IF NOT EXISTS idx_taste_events_eventType ON taste_events(eventType)")
        }

        migrator.registerMigration("v7_discover_ai_cache") { db in
            try db.create(table: "discover_ai_cache", ifNotExists: true) { t in
                t.primaryKey("cacheKey", .text).notNull()
                t.column("payload", .blob).notNull()
                t.column("model", .text)
                t.column("createdAt", .datetime).notNull()
                t.column("expiresAt", .datetime).notNull()
            }

            try db.execute(sql: "CREATE INDEX IF NOT EXISTS idx_discover_ai_cache_expiresAt ON discover_ai_cache(expiresAt)")
        }

        migrator.registerMigration("v8_assistant_memory") { db in
            try db.create(table: "assistant_memory_chunks", ifNotExists: true) { t in
                t.primaryKey("id", .text).notNull()
                t.column("scope", .text).notNull()
                t.column("content", .text).notNull()
                t.column("summary", .text)
                t.column("tags", .blob)
                t.column("importance", .double).notNull().defaults(to: 0)
                t.column("createdAt", .datetime).notNull()
                t.column("lastAccessedAt", .datetime)
            }

            try db.execute(sql: "CREATE INDEX IF NOT EXISTS idx_assistant_memory_chunks_scope ON assistant_memory_chunks(scope)")
            try db.execute(sql: "CREATE INDEX IF NOT EXISTS idx_assistant_memory_chunks_createdAt ON assistant_memory_chunks(createdAt)")
            try db.execute(sql: "CREATE INDEX IF NOT EXISTS idx_assistant_memory_chunks_scope_importance ON assistant_memory_chunks(scope, importance DESC, createdAt DESC)")
        }

        migrator.registerMigration("v9_watchlist_flatten") { db in
            guard try db.tableExists("user_library"), try db.tableExists("library_folders") else { return }

            let folderColumns = try db.columns(in: "library_folders").map(\.name)
            if !folderColumns.contains("folderKind") {
                try db.alter(table: "library_folders") { t in
                    t.add(column: "folderKind", .text).notNull().defaults(to: LibraryFolder.FolderKind.manual.rawValue)
                }
            }

            try Self.ensureSystemLibraryFolders(in: db)
            let watchlistRootID = Self.systemFolderID(for: .watchlist)

            try db.execute(
                sql: """
                UPDATE user_library
                SET folderId = ?
                WHERE listType = 'watchlist'
                  AND (folderId IS NULL OR folderId = '' OR folderId != ?)
                """,
                arguments: [watchlistRootID, watchlistRootID]
            )

            try db.execute(
                sql: """
                DELETE FROM user_library
                WHERE listType = 'watchlist'
                  AND rowid NOT IN (
                      SELECT MIN(rowid)
                      FROM user_library
                      WHERE listType = 'watchlist'
                      GROUP BY mediaId, folderId
                  )
                """
            )

            try db.execute(
                sql: "DELETE FROM library_folders WHERE listType = 'watchlist' AND isSystem = 0"
            )
        }

        migrator.registerMigration("v10_feedback_preferences") { db in
            guard try db.tableExists("taste_events") else { return }

            let tasteColumns = try db.columns(in: "taste_events").map(\.name)
            if !tasteColumns.contains("episodeId") {
                try db.alter(table: "taste_events") { t in
                    t.add(column: "episodeId", .text)
                }
            }
            if !tasteColumns.contains("watchedState") {
                try db.alter(table: "taste_events") { t in
                    t.add(column: "watchedState", .text)
                }
            }
            if !tasteColumns.contains("feedbackScale") {
                try db.alter(table: "taste_events") { t in
                    t.add(column: "feedbackScale", .text)
                }
            }
            if !tasteColumns.contains("feedbackValue") {
                try db.alter(table: "taste_events") { t in
                    t.add(column: "feedbackValue", .double)
                }
            }
            if !tasteColumns.contains("source") {
                try db.alter(table: "taste_events") { t in
                    t.add(column: "source", .text)
                }
            }

            try db.execute(
                sql: "CREATE INDEX IF NOT EXISTS idx_taste_events_media_episode_createdAt ON taste_events(mediaId, episodeId, createdAt DESC)"
            )
            try db.execute(
                sql: "CREATE INDEX IF NOT EXISTS idx_taste_events_eventType_createdAt ON taste_events(eventType, createdAt DESC)"
            )
        }

        migrator.registerMigration("v11_library_folder_kind") { db in
            guard try db.tableExists("library_folders") else { return }
            let folderColumns = try db.columns(in: "library_folders").map(\.name)
            if !folderColumns.contains("folderKind") {
                try db.alter(table: "library_folders") { t in
                    t.add(column: "folderKind", .text).notNull().defaults(to: LibraryFolder.FolderKind.manual.rawValue)
                }
            }

            try db.execute(
                sql: "UPDATE library_folders SET folderKind = ? WHERE isSystem = 1",
                arguments: [LibraryFolder.FolderKind.systemRoot.rawValue]
            )

            try Self.ensureSystemLibraryFolders(in: db)
        }

        migrator.registerMigration("v12_library_release_metadata") { db in
            guard try db.tableExists("user_library") else { return }
            let userLibraryColumns = try db.columns(in: "user_library").map(\.name)
            if !userLibraryColumns.contains("releaseDateHint") {
                try db.alter(table: "user_library") { t in
                    t.add(column: "releaseDateHint", .text)
                }
            }
            if !userLibraryColumns.contains("renewalStatus") {
                try db.alter(table: "user_library") { t in
                    t.add(column: "renewalStatus", .text)
                }
            }
        }

        return migrator
    }

    // MARK: - Media Cache Operations

    func saveMedia(_ item: MediaItem) async throws {
        try await dbPool.write { db in
            try item.save(db)
        }
    }

    func saveMediaBatch(_ items: [MediaItem]) async throws {
        try await dbPool.write { db in
            for item in items {
                try item.save(db)
            }
        }
    }

    func fetchMedia(id: String) async throws -> MediaItem? {
        try await dbPool.read { db in
            try MediaItem.fetchOne(db, key: id)
        }
    }

    func fetchMedia(ids: [String]) async throws -> [String: MediaItem] {
        guard !ids.isEmpty else { return [:] }
        return try await dbPool.read { db in
            let items = try MediaItem.filter(ids.contains(MediaItem.Columns.id)).fetchAll(db)
            return Dictionary(uniqueKeysWithValues: items.map { ($0.id, $0) })
        }
    }

    func searchMedia(query: String, limit: Int = 50) async throws -> [MediaItem] {
        try await dbPool.read { db in
            // Use FTS5 full-text search via raw SQL joining to the content table
            let pattern = FTS5Pattern(matchingAnyTokenIn: query)
            if let pattern = pattern {
                let sql = """
                    SELECT media_cache.*
                    FROM media_cache
                    JOIN media_fts ON media_fts.rowid = media_cache.rowid
                    WHERE media_fts MATCH ?
                    LIMIT ?
                    """
                return try MediaItem.fetchAll(db, sql: sql, arguments: [pattern.rawPattern, limit])
            }
            // Fallback to LIKE search
            return try MediaItem
                .filter(MediaItem.Columns.title.like("%\(query)%"))
                .limit(limit)
                .fetchAll(db)
        }
    }

    func fetchCachedMedia(type: MediaType, limit: Int = 100) async throws -> [MediaItem] {
        try await dbPool.read { db in
            try MediaItem
                .filter(MediaItem.Columns.type == type.rawValue)
                .order(MediaItem.Columns.lastFetched.desc)
                .limit(limit)
                .fetchAll(db)
        }
    }

    // MARK: - Episode Operations

    func saveEpisodes(_ episodes: [Episode]) async throws {
        try await dbPool.write { db in
            for episode in episodes {
                try episode.save(db)
            }
        }
    }

    func fetchEpisodes(mediaId: String, season: Int? = nil) async throws -> [Episode] {
        try await dbPool.read { db in
            var request = Episode
                .filter(Episode.Columns.mediaId == mediaId)
            if let season = season {
                request = request.filter(Episode.Columns.seasonNumber == season)
            }
            return try request
                .order(Episode.Columns.seasonNumber, Episode.Columns.episodeNumber)
                .fetchAll(db)
        }
    }

    // MARK: - Watch History Operations

    func saveWatchHistory(_ entry: WatchHistory) async throws {
        try await dbPool.write { db in
            try entry.save(db)
        }
    }

    func fetchWatchHistory(mediaId: String, episodeId: String? = nil) async throws -> WatchHistory? {
        try await dbPool.read { db in
            if let episodeId = episodeId {
                return try WatchHistory
                    .filter(WatchHistory.Columns.mediaId == mediaId)
                    .filter(WatchHistory.Columns.episodeId == episodeId)
                    .fetchOne(db)
            }
            return try WatchHistory
                .filter(WatchHistory.Columns.mediaId == mediaId)
                .filter(WatchHistory.Columns.episodeId == nil)
                .fetchOne(db)
        }
    }

    func fetchRecentWatchHistory(limit: Int = 20) async throws -> [WatchHistory] {
        try await dbPool.read { db in
            try WatchHistory
                .filter(WatchHistory.Columns.completed == false)
                .order(WatchHistory.Columns.lastWatched.desc)
                .limit(limit)
                .fetchAll(db)
        }
    }

    func fetchAllWatchHistory(limit: Int = 100) async throws -> [WatchHistory] {
        try await dbPool.read { db in
            try WatchHistory
                .order(WatchHistory.Columns.lastWatched.desc)
                .limit(limit)
                .fetchAll(db)
        }
    }

    // MARK: - User Library Operations

    func addToLibrary(_ entry: UserLibraryEntry) async throws {
        try await dbPool.write { db in
            try Self.ensureSystemLibraryFolders(in: db)

            var normalized = entry
            if !normalized.listType.supportsFolders {
                normalized.folderId = Self.systemFolderID(for: normalized.listType)
            } else if normalized.folderId?.isEmpty != false {
                normalized.folderId = Self.systemFolderID(for: normalized.listType)
            }
            try normalized.save(db)
        }
    }

    func removeFromLibrary(id: String) async throws {
        try await dbPool.write { db in
            _ = try UserLibraryEntry.deleteOne(db, key: id)
        }
    }

    func removeFromLibrary(mediaId: String, listType: UserLibraryEntry.ListType) async throws {
        try await dbPool.write { db in
            _ = try UserLibraryEntry
                .filter(UserLibraryEntry.Columns.mediaId == mediaId)
                .filter(UserLibraryEntry.Columns.listType == listType.rawValue)
                .deleteAll(db)
        }
    }

    func fetchLibrary(listType: UserLibraryEntry.ListType) async throws -> [UserLibraryEntry] {
        try await dbPool.read { db in
            try UserLibraryEntry
                .filter(UserLibraryEntry.Columns.listType == listType.rawValue)
                .order(UserLibraryEntry.Columns.addedAt.desc)
                .fetchAll(db)
        }
    }

    func fetchLibrary(folderId: String, includeDescendants: Bool = false) async throws -> [UserLibraryEntry] {
        try await dbPool.read { db in
            if includeDescendants {
                let sql = """
                    WITH RECURSIVE folder_tree(id) AS (
                        SELECT id FROM library_folders WHERE id = ?
                        UNION ALL
                        SELECT f.id
                        FROM library_folders f
                        JOIN folder_tree ft ON f.parentId = ft.id
                    )
                    SELECT user_library.*
                    FROM user_library
                    JOIN folder_tree ON user_library.folderId = folder_tree.id
                    ORDER BY user_library.addedAt DESC
                    """
                return try UserLibraryEntry.fetchAll(db, sql: sql, arguments: [folderId])
            }

            return try UserLibraryEntry
                .filter(UserLibraryEntry.Columns.folderId == folderId)
                .order(UserLibraryEntry.Columns.addedAt.desc)
                .fetchAll(db)
        }
    }

    func isInLibrary(mediaId: String, listType: UserLibraryEntry.ListType) async throws -> Bool {
        try await dbPool.read { db in
            try UserLibraryEntry
                .filter(UserLibraryEntry.Columns.mediaId == mediaId)
                .filter(UserLibraryEntry.Columns.listType == listType.rawValue)
                .fetchCount(db) > 0
        }
    }

    func fetchLibraryEntries(mediaId: String, listType: UserLibraryEntry.ListType) async throws -> [UserLibraryEntry] {
        try await dbPool.read { db in
            try UserLibraryEntry
                .filter(UserLibraryEntry.Columns.mediaId == mediaId)
                .filter(UserLibraryEntry.Columns.listType == listType.rawValue)
                .order(UserLibraryEntry.Columns.addedAt.desc)
                .fetchAll(db)
        }
    }

    func isInLibrary(mediaId: String, folderId: String) async throws -> Bool {
        try await dbPool.read { db in
            try UserLibraryEntry
                .filter(UserLibraryEntry.Columns.mediaId == mediaId)
                .filter(UserLibraryEntry.Columns.folderId == folderId)
                .fetchCount(db) > 0
        }
    }

    func fetchLibraryMedia(folderId: String, includeDescendants: Bool = false) async throws -> [MediaItem] {
        try await dbPool.read { db in
            if includeDescendants {
                let sql = """
                    WITH RECURSIVE folder_tree(id) AS (
                        SELECT id FROM library_folders WHERE id = ?
                        UNION ALL
                        SELECT f.id
                        FROM library_folders f
                        JOIN folder_tree ft ON f.parentId = ft.id
                    )
                    SELECT media_cache.*
                    FROM media_cache
                    JOIN user_library ON user_library.mediaId = media_cache.id
                    JOIN folder_tree ON user_library.folderId = folder_tree.id
                    GROUP BY media_cache.id
                    ORDER BY MAX(user_library.addedAt) DESC
                    """
                return try MediaItem.fetchAll(db, sql: sql, arguments: [folderId])
            }

            let sql = """
                SELECT media_cache.*
                FROM media_cache
                JOIN user_library ON user_library.mediaId = media_cache.id
                WHERE user_library.folderId = ?
                GROUP BY media_cache.id
                ORDER BY MAX(user_library.addedAt) DESC
                """
            return try MediaItem.fetchAll(db, sql: sql, arguments: [folderId])
        }
    }

    func fetchLibraryMediaInFolderTree(rootFolderId: String? = nil) async throws -> [MediaItem] {
        try await dbPool.read { db in
            if let rootFolderId {
                let sql = """
                    WITH RECURSIVE folder_tree(id) AS (
                        SELECT id FROM library_folders WHERE id = ?
                        UNION ALL
                        SELECT f.id
                        FROM library_folders f
                        JOIN folder_tree ft ON f.parentId = ft.id
                    )
                    SELECT media_cache.*
                    FROM media_cache
                    JOIN user_library ON user_library.mediaId = media_cache.id
                    JOIN folder_tree ON user_library.folderId = folder_tree.id
                    GROUP BY media_cache.id
                    ORDER BY MAX(user_library.addedAt) DESC
                    """
                return try MediaItem.fetchAll(db, sql: sql, arguments: [rootFolderId])
            }

            let sql = """
                SELECT media_cache.*
                FROM media_cache
                JOIN user_library ON user_library.mediaId = media_cache.id
                WHERE user_library.folderId IS NOT NULL
                GROUP BY media_cache.id
                ORDER BY MAX(user_library.addedAt) DESC
                """
            return try MediaItem.fetchAll(db, sql: sql)
        }
    }

    // MARK: Library Folder Operations

    func saveLibraryFolder(_ folder: LibraryFolder) async throws {
        try await dbPool.write { db in
            try Self.ensureSystemLibraryFolders(in: db)
            try folder.save(db)
        }
    }

    func fetchLibraryFolder(id: String) async throws -> LibraryFolder? {
        try await dbPool.read { db in
            try LibraryFolder.fetchOne(db, key: id)
        }
    }

    func fetchSystemLibraryFolder(listType: UserLibraryEntry.ListType) async throws -> LibraryFolder {
        try await dbPool.write { db in
            try Self.ensureSystemLibraryFolders(in: db)
            let folderID = Self.systemFolderID(for: listType)
            guard let folder = try LibraryFolder.fetchOne(db, key: folderID) else {
                throw NSError(domain: "DatabaseManager", code: 1, userInfo: [
                    NSLocalizedDescriptionKey: "Missing system folder \(folderID)"
                ])
            }
            return folder
        }
    }

    func fetchSystemLibraryFolderID(listType: UserLibraryEntry.ListType) async throws -> String {
        try await fetchSystemLibraryFolder(listType: listType).id
    }

    func ensureDefaultBehaviorFolders() async throws {
        try await dbPool.write { db in
            try Self.ensureSystemLibraryFolders(in: db)
        }
    }

    func fetchFolderByKind(
        listType: UserLibraryEntry.ListType,
        kind: LibraryFolder.FolderKind
    ) async throws -> LibraryFolder? {
        try await dbPool.write { db in
            try Self.ensureSystemLibraryFolders(in: db)
            if kind == .systemRoot {
                return try LibraryFolder.fetchOne(db, key: Self.systemFolderID(for: listType))
            }
            return try LibraryFolder
                .filter(LibraryFolder.Columns.listType == listType.rawValue)
                .filter(LibraryFolder.Columns.folderKind == kind.rawValue)
                .order(LibraryFolder.Columns.updatedAt.desc)
                .fetchOne(db)
        }
    }

    func fetchAllLibraryFolders(listType: UserLibraryEntry.ListType? = nil) async throws -> [LibraryFolder] {
        try await dbPool.read { db in
            var request = LibraryFolder
                .order(LibraryFolder.Columns.isSystem.desc, LibraryFolder.Columns.name.asc)

            if let listType {
                request = request.filter(LibraryFolder.Columns.listType == listType.rawValue)
            }

            return try request.fetchAll(db)
        }
    }

    func fetchChildLibraryFolders(parentId: String?) async throws -> [LibraryFolder] {
        try await dbPool.read { db in
            let request = LibraryFolder
                .filter(LibraryFolder.Columns.parentId == parentId)
                .order(LibraryFolder.Columns.isSystem.desc, LibraryFolder.Columns.name.asc)
            return try request.fetchAll(db)
        }
    }

    func fetchLibraryFolderDescendantIDs(rootFolderId: String) async throws -> [String] {
        try await dbPool.read { db in
            let sql = """
                WITH RECURSIVE folder_tree(id) AS (
                    SELECT id FROM library_folders WHERE id = ?
                    UNION ALL
                    SELECT f.id
                    FROM library_folders f
                    JOIN folder_tree ft ON f.parentId = ft.id
                )
                SELECT id FROM folder_tree
                """
            return try String.fetchAll(db, sql: sql, arguments: [rootFolderId])
        }
    }

    func createLibraryFolder(
        name: String,
        listType: UserLibraryEntry.ListType,
        parentId: String?
    ) async throws -> LibraryFolder {
        guard listType.supportsFolders else {
            throw DatabaseManagerError.foldersNotSupported(listType)
        }
        return try await dbPool.write { db in
            try Self.ensureSystemLibraryFolders(in: db)
            let resolvedParentId = parentId ?? Self.systemFolderID(for: listType)
            let uniqueName = try Self.uniqueFolderName(
                in: db,
                desired: name,
                listType: listType,
                parentId: resolvedParentId,
                excludingID: nil
            )
            let folder = LibraryFolder(
                id: "folder-\(UUID().uuidString)",
                name: uniqueName,
                parentId: resolvedParentId,
                listType: listType,
                folderKind: .manual,
                isSystem: false,
                createdAt: Date(),
                updatedAt: Date()
            )
            try folder.save(db)
            return folder
        }
    }

    func renameLibraryFolder(id: String, name: String) async throws {
        try await dbPool.write { db in
            guard var folder = try LibraryFolder.fetchOne(db, key: id) else { return }
            if !folder.listType.supportsFolders {
                throw DatabaseManagerError.foldersNotSupported(folder.listType)
            }
            guard !folder.isSystem else { return }
            let uniqueName = try Self.uniqueFolderName(
                in: db,
                desired: name,
                listType: folder.listType,
                parentId: folder.parentId,
                excludingID: folder.id
            )
            folder.name = uniqueName
            folder.updatedAt = Date()
            try folder.save(db)
        }
    }

    func moveLibraryFolder(id: String, newParentId: String?) async throws {
        try await dbPool.write { db in
            guard var folder = try LibraryFolder.fetchOne(db, key: id) else { return }
            if !folder.listType.supportsFolders {
                throw DatabaseManagerError.foldersNotSupported(folder.listType)
            }
            guard !folder.isSystem else { return }
            let parent = if let newParentId {
                newParentId
            } else {
                Self.systemFolderID(for: folder.listType)
            }
            guard parent != folder.id else { return }

            let descendantIDs = try Self.fetchDescendantIDs(db: db, rootFolderId: folder.id)
            guard !descendantIDs.contains(parent) else { return }

            folder.parentId = parent
            folder.updatedAt = Date()
            try folder.save(db)
        }
    }

    func removeFromLibrary(mediaId: String, folderId: String) async throws {
        try await dbPool.write { db in
            _ = try UserLibraryEntry
                .filter(UserLibraryEntry.Columns.mediaId == mediaId)
                .filter(UserLibraryEntry.Columns.folderId == folderId)
                .deleteAll(db)
        }
    }

    func addOrUpsertLibraryEntryPreservingExistingFolders(
        mediaId: String,
        listType: UserLibraryEntry.ListType,
        folderId: String?,
        addedAt: Date = Date(),
        customListName: String? = nil,
        releaseDateHint: String? = nil,
        renewalStatus: String? = nil
    ) async throws -> UserLibraryEntry {
        try await dbPool.write { db in
            try Self.ensureSystemLibraryFolders(in: db)

            let resolvedFolderId: String
            if listType.supportsFolders {
                let trimmedFolderId = folderId?.trimmingCharacters(in: .whitespacesAndNewlines)
                resolvedFolderId = (trimmedFolderId?.isEmpty == false)
                    ? trimmedFolderId!
                    : Self.systemFolderID(for: listType)
            } else {
                resolvedFolderId = Self.systemFolderID(for: listType)
            }

            if var existing = try UserLibraryEntry
                .filter(UserLibraryEntry.Columns.mediaId == mediaId)
                .filter(UserLibraryEntry.Columns.folderId == resolvedFolderId)
                .fetchOne(db) {
                if addedAt > existing.addedAt {
                    existing.addedAt = addedAt
                }
                if let customListName {
                    existing.customListName = customListName
                }
                if let releaseDateHint {
                    existing.releaseDateHint = releaseDateHint
                }
                if let renewalStatus {
                    existing.renewalStatus = renewalStatus
                }
                try existing.save(db)
                return existing
            }

            let entry = UserLibraryEntry(
                id: "lib-\(UUID().uuidString)",
                mediaId: mediaId,
                folderId: resolvedFolderId,
                listType: listType,
                addedAt: addedAt,
                customListName: customListName,
                releaseDateHint: releaseDateHint,
                renewalStatus: renewalStatus
            )
            try entry.insert(db, onConflict: .ignore)
            if let fetched = try UserLibraryEntry
                .filter(UserLibraryEntry.Columns.mediaId == mediaId)
                .filter(UserLibraryEntry.Columns.folderId == resolvedFolderId)
                .fetchOne(db) {
                return fetched
            }
            return entry
        }
    }

    func deleteLibraryFolder(id: String) async throws {
        try await dbPool.write { db in
            if let folder = try LibraryFolder.fetchOne(db, key: id), folder.isSystem {
                throw NSError(domain: "DatabaseManager", code: 2, userInfo: [
                    NSLocalizedDescriptionKey: "System folders cannot be deleted"
                ])
            }
            guard let folder = try LibraryFolder.fetchOne(db, key: id) else { return }
            if !folder.listType.supportsFolders {
                throw DatabaseManagerError.foldersNotSupported(folder.listType)
            }
            let fallbackFolderID = Self.systemFolderID(for: folder.listType)
            let idsToReassign = try Self.fetchDescendantIDs(db: db, rootFolderId: id)

            // Move all entries from this subtree to the system root folder before deletion.
            if !idsToReassign.isEmpty {
                for oldFolderId in idsToReassign {
                    try db.execute(
                        sql: "UPDATE user_library SET folderId = ? WHERE folderId = ?",
                        arguments: [fallbackFolderID, oldFolderId]
                    )
                }
            }

            _ = try LibraryFolder.deleteOne(db, key: id)
        }
    }


    // MARK: Taste Profile Operations

    func saveUserTasteProfile(_ profile: UserTasteProfile) async throws {
        try await dbPool.write { db in
            try profile.save(db)
        }
    }

    func fetchUserTasteProfile(userId: String = "default") async throws -> UserTasteProfile? {
        try await dbPool.read { db in
            try UserTasteProfile.fetchOne(db, key: userId)
        }
    }

    func saveTasteEvent(_ event: TasteEvent) async throws {
        try await dbPool.write { db in
            try event.save(db)
        }
    }

    func saveTasteEvents(_ events: [TasteEvent]) async throws {
        try await dbPool.write { db in
            for event in events {
                try event.save(db)
            }
        }
    }

    func fetchTasteEvents(userId: String = "default", limit: Int = 100) async throws -> [TasteEvent] {
        try await dbPool.read { db in
            try TasteEvent
                .filter(TasteEvent.Columns.userId == userId)
                .order(TasteEvent.Columns.createdAt.desc)
                .limit(limit)
                .fetchAll(db)
        }
    }

    func fetchLatestWatchedState(
        mediaId: String,
        episodeId: String? = nil,
        userId: String = "default"
    ) async throws -> TasteEvent? {
        try await dbPool.read { db in
            var request = TasteEvent
                .filter(TasteEvent.Columns.userId == userId)
                .filter(TasteEvent.Columns.mediaId == mediaId)
                .filter(TasteEvent.Columns.watchedState != nil)
            if let episodeId {
                request = request.filter(TasteEvent.Columns.episodeId == episodeId)
            } else {
                request = request.filter(TasteEvent.Columns.episodeId == nil)
            }

            return try request
                .order(TasteEvent.Columns.createdAt.desc)
                .fetchOne(db)
        }
    }

    // MARK: Discover AI Cache Operations

    func saveDiscoverAICacheEntry(_ entry: AICurationCacheEntry) async throws {
        try await dbPool.write { db in
            try entry.save(db)
        }
    }

    func fetchDiscoverAICacheEntry(cacheKey: String, now: Date = Date()) async throws -> AICurationCacheEntry? {
        try await dbPool.write { db in
            guard let entry = try AICurationCacheEntry.fetchOne(db, key: cacheKey) else {
                return nil
            }

            guard entry.expiresAt > now else {
                _ = try AICurationCacheEntry.deleteOne(db, key: cacheKey)
                return nil
            }
            return entry
        }
    }

    func deleteExpiredDiscoverAICacheEntries(now: Date = Date()) async throws -> Int {
        try await dbPool.write { db in
            try db.execute(
                sql: "DELETE FROM discover_ai_cache WHERE expiresAt <= ?",
                arguments: [now]
            )
            return Int(db.changesCount)
        }
    }

    // MARK: Assistant Memory Operations

    func saveAssistantMemoryChunk(_ chunk: AssistantMemoryChunk) async throws {
        try await dbPool.write { db in
            try chunk.save(db)
        }
    }

    func saveAssistantMemoryChunks(_ chunks: [AssistantMemoryChunk]) async throws {
        try await dbPool.write { db in
            for chunk in chunks {
                try chunk.save(db)
            }
        }
    }

    func fetchAssistantMemoryChunks(scope: String = "default", limit: Int = 50) async throws -> [AssistantMemoryChunk] {
        try await dbPool.read { db in
            try AssistantMemoryChunk
                .filter(AssistantMemoryChunk.Columns.scope == scope)
                .order(AssistantMemoryChunk.Columns.importance.desc, AssistantMemoryChunk.Columns.createdAt.desc)
                .limit(limit)
                .fetchAll(db)
        }
    }

    func retrieveAssistantMemory(scope: String = "default", query: String, limit: Int = 10) async throws -> [AssistantMemoryChunk] {
        let trimmedQuery = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedQuery.isEmpty else {
            return try await fetchAssistantMemoryChunks(scope: scope, limit: limit)
        }

        let pattern = "%\(trimmedQuery)%"
        return try await dbPool.read { db in
            let sql = """
                SELECT assistant_memory_chunks.*
                FROM assistant_memory_chunks
                WHERE scope = ?
                  AND (
                    content LIKE ?
                    OR summary LIKE ?
                    OR CAST(tags AS TEXT) LIKE ?
                  )
                ORDER BY importance DESC, COALESCE(lastAccessedAt, createdAt) DESC
                LIMIT ?
                """
            return try AssistantMemoryChunk.fetchAll(
                db,
                sql: sql,
                arguments: [scope, pattern, pattern, pattern, limit]
            )
        }
    }

    // MARK: - Debrid Config Operations

    func saveDebridConfig(_ config: DebridConfig) async throws {
        try await dbPool.write { db in
            try config.save(db)
        }
    }

    func fetchDebridConfigs() async throws -> [DebridConfig] {
        try await dbPool.read { db in
            try DebridConfig
                .filter(DebridConfig.Columns.isActive == true)
                .order(DebridConfig.Columns.priority.asc)
                .fetchAll(db)
        }
    }

    /// Fetch all debrid configs regardless of active status (for settings UI).
    func fetchAllDebridConfigs() async throws -> [DebridConfig] {
        try await dbPool.read { db in
            try DebridConfig
                .order(DebridConfig.Columns.priority.asc)
                .fetchAll(db)
        }
    }

    func deleteDebridConfig(id: String) async throws {
        try await dbPool.write { db in
            _ = try DebridConfig.deleteOne(db, key: id)
        }
    }

    // MARK: - Indexer Config Operations

    func saveIndexerConfig(_ config: IndexerConfig) async throws {
        try await dbPool.write { db in
            try config.save(db)
        }
    }

    func fetchIndexerConfigs() async throws -> [IndexerConfig] {
        try await dbPool.read { db in
            try IndexerConfig
                .filter(IndexerConfig.Columns.isActive == true)
                .order(IndexerConfig.Columns.priority.asc)
                .fetchAll(db)
        }
    }

    func fetchAllIndexerConfigs() async throws -> [IndexerConfig] {
        try await dbPool.read { db in
            try IndexerConfig
                .order(IndexerConfig.Columns.priority.asc)
                .fetchAll(db)
        }
    }

    func deleteIndexerConfig(id: String) async throws {
        try await dbPool.write { db in
            _ = try IndexerConfig.deleteOne(db, key: id)
        }
    }

    // MARK: - Settings Operations

    func setSetting(key: String, value: String?) async throws {
        try await dbPool.write { db in
            if let value = value {
                try db.execute(
                    sql: "INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)",
                    arguments: [key, value]
                )
            } else {
                try db.execute(
                    sql: "DELETE FROM app_settings WHERE key = ?",
                    arguments: [key]
                )
            }
        }
    }

    func getSetting(key: String) async throws -> String? {
        try await dbPool.read { db in
            try String.fetchOne(db, sql: "SELECT value FROM app_settings WHERE key = ?", arguments: [key])
        }
    }

    func tableColumnNames(_ table: String) async throws -> [String] {
        try await dbPool.read { db in
            try db.columns(in: table).map(\.name)
        }
    }

    // MARK: - Torrent Cache Operations

    func saveTorrentCache(_ torrent: CachedTorrent) async throws {
        try await dbPool.write { db in
            try torrent.save(db)
        }
    }

    func fetchCachedTorrents(mediaId: String) async throws -> [CachedTorrent] {
        try await dbPool.read { db in
            try CachedTorrent
                .filter(CachedTorrent.Columns.mediaId == mediaId)
                .order(CachedTorrent.Columns.cachedOnDebrid.desc)
                .fetchAll(db)
        }
    }

    private static func systemFolderID(for listType: UserLibraryEntry.ListType) -> String {
        LibraryFolder.systemFolderID(for: listType)
    }

    private static func ensureSystemLibraryFolders(in db: Database) throws {
        let now = Date()
        for listType in UserLibraryEntry.ListType.allCases {
            let folderID = systemFolderID(for: listType)
            if var existing = try LibraryFolder.fetchOne(db, key: folderID) {
                var changed = false
                let expectedName = LibraryFolder.systemFolderName(for: listType)
                if existing.name != expectedName {
                    existing.name = expectedName
                    changed = true
                }
                if !existing.isSystem {
                    existing.isSystem = true
                    changed = true
                }
                if existing.folderKind != .systemRoot {
                    existing.folderKind = .systemRoot
                    changed = true
                }
                if existing.parentId != nil {
                    existing.parentId = nil
                    changed = true
                }
                if changed {
                    existing.updatedAt = now
                    try existing.save(db)
                }
                continue
            }

            let folder = LibraryFolder(
                id: folderID,
                name: LibraryFolder.systemFolderName(for: listType),
                listType: listType,
                folderKind: .systemRoot,
                isSystem: true,
                createdAt: now,
                updatedAt: now
            )
            try folder.insert(db)
        }

        try ensureDefaultBehaviorFolders(in: db)
    }

    private static func ensureDefaultBehaviorFolders(in db: Database) throws {
        let now = Date()
        let libraryRootID = systemFolderID(for: .favorites)

        let behaviorFolders: [(id: String, name: String, kind: LibraryFolder.FolderKind)] = [
            (LibraryFolder.watchedFolderID, "Watched", .watched),
            (LibraryFolder.releaseWaitFolderID, "Release Wait", .releaseWait)
        ]

        for behavior in behaviorFolders {
            if var existing = try LibraryFolder.fetchOne(db, key: behavior.id) {
                var changed = false
                if existing.name != behavior.name {
                    existing.name = behavior.name
                    changed = true
                }
                if existing.parentId != libraryRootID {
                    existing.parentId = libraryRootID
                    changed = true
                }
                if existing.listType != .favorites {
                    existing.listType = .favorites
                    changed = true
                }
                if !existing.isSystem {
                    existing.isSystem = true
                    changed = true
                }
                if existing.folderKind != behavior.kind {
                    existing.folderKind = behavior.kind
                    changed = true
                }
                if changed {
                    existing.updatedAt = now
                    try existing.save(db)
                }
                continue
            }

            let folder = LibraryFolder(
                id: behavior.id,
                name: behavior.name,
                parentId: libraryRootID,
                listType: .favorites,
                folderKind: behavior.kind,
                isSystem: true,
                createdAt: now,
                updatedAt: now
            )
            try folder.insert(db, onConflict: .ignore)
        }
    }

    private static func uniqueFolderName(
        in db: Database,
        desired: String,
        listType: UserLibraryEntry.ListType,
        parentId: String?,
        excludingID: String?
    ) throws -> String {
        let trimmed = desired.trimmingCharacters(in: .whitespacesAndNewlines)
        let baseName = trimmed.isEmpty ? "New Folder" : trimmed
        var candidate = baseName
        var index = 2

        while true {
            var request = LibraryFolder
                .filter(LibraryFolder.Columns.listType == listType.rawValue)
                .filter(LibraryFolder.Columns.parentId == parentId)
                .filter(LibraryFolder.Columns.name == candidate)
            if let excludingID {
                request = request.filter(LibraryFolder.Columns.id != excludingID)
            }

            let exists = try request.fetchCount(db) > 0
            if !exists {
                return candidate
            }
            candidate = "\(baseName) (\(index))"
            index += 1
        }
    }

    private static func fetchDescendantIDs(db: Database, rootFolderId: String) throws -> [String] {
        let sql = """
            WITH RECURSIVE folder_tree(id) AS (
                SELECT id FROM library_folders WHERE id = ?
                UNION ALL
                SELECT f.id
                FROM library_folders f
                JOIN folder_tree ft ON f.parentId = ft.id
            )
            SELECT id FROM folder_tree
            """
        return try String.fetchAll(db, sql: sql, arguments: [rootFolderId])
    }
}
