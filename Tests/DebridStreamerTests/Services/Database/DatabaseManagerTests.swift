import Testing
import Foundation
import GRDB
@testable import DebridStreamer

/// Helper to create a temporary file-based database for testing.
func makeTestDatabase() throws -> DatabaseManager {
    let tempDir = FileManager.default.temporaryDirectory
    let dbPath = tempDir.appendingPathComponent("test-\(UUID().uuidString).sqlite").path
    let dbPool = try DatabasePool(path: dbPath)
    return try DatabaseManager(dbPool: dbPool)
}

/// Helper to create a pre-v5 schema and migration state for migration tests.
func makeLegacyV4DatabasePool() throws -> DatabasePool {
    let tempDir = FileManager.default.temporaryDirectory
    let dbPath = tempDir.appendingPathComponent("legacy-v4-\(UUID().uuidString).sqlite").path
    let dbPool = try DatabasePool(path: dbPath)

    try dbPool.write { db in
        try db.execute(
            sql: """
            CREATE TABLE user_library (
                id TEXT PRIMARY KEY NOT NULL,
                mediaId TEXT NOT NULL,
                listType TEXT NOT NULL,
                addedAt DATETIME NOT NULL,
                customListName TEXT
            )
            """
        )

        try db.execute(sql: "CREATE INDEX idx_user_library_mediaId ON user_library(mediaId)")
        try db.execute(sql: "CREATE INDEX idx_user_library_listType ON user_library(listType)")

        try db.execute(sql: "CREATE TABLE grdb_migrations (identifier TEXT NOT NULL PRIMARY KEY)")
        for identifier in ["v1_core", "v2_indexers_ext", "v3_ai_assistant", "v4_sync_state"] {
            try db.execute(
                sql: "INSERT INTO grdb_migrations (identifier) VALUES (?)",
                arguments: [identifier]
            )
        }
    }

    return dbPool
}

@Suite("DatabaseManager - Media Cache Operations")
struct DatabaseMediaCacheTests {
    @Test("Save and fetch media item")
    func saveAndFetch() async throws {
        let db = try makeTestDatabase()

        let item = MediaItem(
            id: "tt1234567",
            type: .movie,
            title: "Test Movie",
            year: 2024,
            posterPath: "/poster.jpg",
            overview: "A great movie",
            genres: ["Action", "Comedy"],
            imdbRating: 8.5,
            runtime: 120,
            tmdbId: 12345
        )

        try await db.saveMedia(item)
        let fetched = try await db.fetchMedia(id: "tt1234567")

        #expect(fetched != nil)
        #expect(fetched?.title == "Test Movie")
        #expect(fetched?.year == 2024)
        #expect(fetched?.type == .movie)
        #expect(fetched?.genres == ["Action", "Comedy"])
        #expect(fetched?.imdbRating == 8.5)
        #expect(fetched?.runtime == 120)
        #expect(fetched?.tmdbId == 12345)
    }

    @Test("Fetch nonexistent media returns nil")
    func fetchNonexistent() async throws {
        let db = try makeTestDatabase()
        let result = try await db.fetchMedia(id: "tt9999999")
        #expect(result == nil)
    }

    @Test("Save batch of media items")
    func saveBatch() async throws {
        let db = try makeTestDatabase()

        let items = (1...5).map { i in
            MediaItem(id: "tt\(i)", type: .movie, title: "Movie \(i)")
        }
        try await db.saveMediaBatch(items)

        let cached = try await db.fetchCachedMedia(type: .movie)
        #expect(cached.count == 5)
    }

    @Test("Fetch cached media by type")
    func fetchByType() async throws {
        let db = try makeTestDatabase()

        try await db.saveMedia(MediaItem(id: "tt1", type: .movie, title: "Movie 1"))
        try await db.saveMedia(MediaItem(id: "tt2", type: .series, title: "Show 1"))
        try await db.saveMedia(MediaItem(id: "tt3", type: .movie, title: "Movie 2"))

        let movies = try await db.fetchCachedMedia(type: .movie)
        let shows = try await db.fetchCachedMedia(type: .series)

        #expect(movies.count == 2)
        #expect(shows.count == 1)
    }

    @Test("Update existing media item")
    func updateMedia() async throws {
        let db = try makeTestDatabase()

        let original = MediaItem(id: "tt1", type: .movie, title: "Old Title", imdbRating: 6.0)
        try await db.saveMedia(original)

        let updated = MediaItem(id: "tt1", type: .movie, title: "New Title", imdbRating: 8.0)
        try await db.saveMedia(updated)

        let fetched = try await db.fetchMedia(id: "tt1")
        #expect(fetched?.title == "New Title")
        #expect(fetched?.imdbRating == 8.0)
    }
}

@Suite("DatabaseManager - Episode Operations")
struct DatabaseEpisodeTests {
    @Test("Save and fetch episodes")
    func saveAndFetch() async throws {
        let db = try makeTestDatabase()

        // First save the parent media
        try await db.saveMedia(MediaItem(id: "tt1234567", type: .series, title: "Test Show"))

        let episodes = [
            Episode(id: "ep1", mediaId: "tt1234567", seasonNumber: 1, episodeNumber: 1, title: "Pilot"),
            Episode(id: "ep2", mediaId: "tt1234567", seasonNumber: 1, episodeNumber: 2, title: "Second"),
            Episode(id: "ep3", mediaId: "tt1234567", seasonNumber: 2, episodeNumber: 1, title: "S2 Premiere"),
        ]
        try await db.saveEpisodes(episodes)

        let allEps = try await db.fetchEpisodes(mediaId: "tt1234567")
        #expect(allEps.count == 3)

        let season1 = try await db.fetchEpisodes(mediaId: "tt1234567", season: 1)
        #expect(season1.count == 2)
        #expect(season1[0].title == "Pilot")

        let season2 = try await db.fetchEpisodes(mediaId: "tt1234567", season: 2)
        #expect(season2.count == 1)
    }
}

@Suite("DatabaseManager - Watch History Operations")
struct DatabaseWatchHistoryTests {
    @Test("Save and fetch watch history")
    func saveAndFetch() async throws {
        let db = try makeTestDatabase()

        let entry = WatchHistory(
            id: "wh-1",
            mediaId: "tt1234567",
            progressSeconds: 3600,
            durationSeconds: 7200,
            completed: false,
            lastWatched: Date()
        )
        try await db.saveWatchHistory(entry)

        let fetched = try await db.fetchWatchHistory(mediaId: "tt1234567")
        #expect(fetched != nil)
        #expect(fetched?.progressSeconds == 3600)
        #expect(fetched?.durationSeconds == 7200)
    }

    @Test("Fetch recent watch history")
    func fetchRecent() async throws {
        let db = try makeTestDatabase()

        for i in 1...5 {
            let entry = WatchHistory(
                id: "wh-\(i)",
                mediaId: "tt\(i)",
                progressSeconds: Double(i * 600),
                durationSeconds: 7200,
                completed: i == 5, // only last one completed
                lastWatched: Date().addingTimeInterval(Double(i) * 60)
            )
            try await db.saveWatchHistory(entry)
        }

        let recent = try await db.fetchRecentWatchHistory()
        #expect(recent.count == 4) // Excludes completed
    }

    @Test("Fetch all watch history includes completed entries")
    func fetchAllHistoryIncludesCompleted() async throws {
        let db = try makeTestDatabase()

        try await db.saveWatchHistory(
            WatchHistory(
                id: "wh-a",
                mediaId: "tt-a",
                progressSeconds: 100,
                durationSeconds: 200,
                completed: false,
                lastWatched: Date()
            )
        )
        try await db.saveWatchHistory(
            WatchHistory(
                id: "wh-b",
                mediaId: "tt-b",
                progressSeconds: 200,
                durationSeconds: 200,
                completed: true,
                lastWatched: Date().addingTimeInterval(5)
            )
        )

        let all = try await db.fetchAllWatchHistory()
        #expect(all.count == 2)
        #expect(all[0].mediaId == "tt-b")
    }

    @Test("Watch history with episode ID")
    func withEpisodeId() async throws {
        let db = try makeTestDatabase()

        let entry = WatchHistory(
            id: "wh-ep",
            mediaId: "tt1234567",
            episodeId: "s1e1",
            progressSeconds: 1200,
            completed: false,
            lastWatched: Date()
        )
        try await db.saveWatchHistory(entry)

        let fetched = try await db.fetchWatchHistory(mediaId: "tt1234567", episodeId: "s1e1")
        #expect(fetched != nil)
        #expect(fetched?.episodeId == "s1e1")

        // Should NOT find it without episodeId
        let noEp = try await db.fetchWatchHistory(mediaId: "tt1234567")
        #expect(noEp == nil)
    }
}

@Suite("DatabaseManager - User Library Operations")
struct DatabaseLibraryTests {
    @Test("Add and fetch library entries")
    func addAndFetch() async throws {
        let db = try makeTestDatabase()

        let entry = UserLibraryEntry(
            id: "lib-1",
            mediaId: "tt1234567",
            listType: .watchlist,
            addedAt: Date()
        )
        try await db.addToLibrary(entry)

        let watchlist = try await db.fetchLibrary(listType: .watchlist)
        #expect(watchlist.count == 1)
        #expect(watchlist[0].mediaId == "tt1234567")
    }

    @Test("Remove from library")
    func remove() async throws {
        let db = try makeTestDatabase()

        let entry = UserLibraryEntry(
            id: "lib-1",
            mediaId: "tt1234567",
            listType: .favorites,
            addedAt: Date()
        )
        try await db.addToLibrary(entry)
        try await db.removeFromLibrary(id: "lib-1")

        let favorites = try await db.fetchLibrary(listType: .favorites)
        #expect(favorites.isEmpty)
    }

    @Test("Check if in library")
    func isInLibrary() async throws {
        let db = try makeTestDatabase()

        let entry = UserLibraryEntry(
            id: "lib-1",
            mediaId: "tt1234567",
            listType: .watchlist,
            addedAt: Date()
        )
        try await db.addToLibrary(entry)

        let isIn = try await db.isInLibrary(mediaId: "tt1234567", listType: .watchlist)
        #expect(isIn == true)

        let isNotIn = try await db.isInLibrary(mediaId: "tt1234567", listType: .favorites)
        #expect(isNotIn == false)
    }

    @Test("Library entries sorted by date descending")
    func sortOrder() async throws {
        let db = try makeTestDatabase()

        let now = Date()
        for i in 1...3 {
            let entry = UserLibraryEntry(
                id: "lib-\(i)",
                mediaId: "tt\(i)",
                listType: .watchlist,
                addedAt: now.addingTimeInterval(Double(i) * 3600)
            )
            try await db.addToLibrary(entry)
        }

        let list = try await db.fetchLibrary(listType: .watchlist)
        #expect(list.count == 3)
        #expect(list[0].mediaId == "tt3") // Most recent first
    }
}

@Suite("DatabaseManager - Settings Operations")
struct DatabaseSettingsTests {
    @Test("Set and get setting")
    func setAndGet() async throws {
        let db = try makeTestDatabase()

        try await db.setSetting(key: "test_key", value: "test_value")
        let value = try await db.getSetting(key: "test_key")
        #expect(value == "test_value")
    }

    @Test("Get nonexistent setting returns nil")
    func getNonexistent() async throws {
        let db = try makeTestDatabase()
        let value = try await db.getSetting(key: "nonexistent")
        #expect(value == nil)
    }

    @Test("Update setting value")
    func updateSetting() async throws {
        let db = try makeTestDatabase()

        try await db.setSetting(key: "key", value: "old")
        try await db.setSetting(key: "key", value: "new")
        let value = try await db.getSetting(key: "key")
        #expect(value == "new")
    }

    @Test("Delete setting with nil value")
    func deleteSetting() async throws {
        let db = try makeTestDatabase()

        try await db.setSetting(key: "key", value: "value")
        try await db.setSetting(key: "key", value: nil)
        let value = try await db.getSetting(key: "key")
        #expect(value == nil)
    }
}

@Suite("DatabaseManager - Debrid Config Operations")
struct DatabaseDebridConfigTests {
    @Test("Save and fetch debrid configs")
    func saveAndFetch() async throws {
        let db = try makeTestDatabase()

        let config = DebridConfig(
            id: "rd-1",
            service: .realDebrid,
            apiToken: "test-token",
            isActive: true,
            priority: 0
        )
        try await db.saveDebridConfig(config)

        let configs = try await db.fetchDebridConfigs()
        #expect(configs.count == 1)
        #expect(configs[0].service == .realDebrid)
        #expect(configs[0].apiToken == "test-token")
    }

    @Test("Fetch only active configs")
    func fetchActive() async throws {
        let db = try makeTestDatabase()

        try await db.saveDebridConfig(DebridConfig(id: "1", service: .realDebrid, apiToken: "t1", isActive: true))
        try await db.saveDebridConfig(DebridConfig(id: "2", service: .allDebrid, apiToken: "t2", isActive: false))

        let configs = try await db.fetchDebridConfigs()
        #expect(configs.count == 1)
        #expect(configs[0].service == .realDebrid)
    }

    @Test("Configs sorted by priority")
    func sortedByPriority() async throws {
        let db = try makeTestDatabase()

        try await db.saveDebridConfig(DebridConfig(id: "1", service: .premiumize, apiToken: "t1", priority: 2))
        try await db.saveDebridConfig(DebridConfig(id: "2", service: .realDebrid, apiToken: "t2", priority: 0))
        try await db.saveDebridConfig(DebridConfig(id: "3", service: .allDebrid, apiToken: "t3", priority: 1))

        let configs = try await db.fetchDebridConfigs()
        #expect(configs[0].service == .realDebrid)
        #expect(configs[1].service == .allDebrid)
        #expect(configs[2].service == .premiumize)
    }

    @Test("Delete debrid config")
    func deleteConfig() async throws {
        let db = try makeTestDatabase()

        try await db.saveDebridConfig(DebridConfig(id: "1", service: .realDebrid, apiToken: "t1"))
        try await db.deleteDebridConfig(id: "1")

        let configs = try await db.fetchDebridConfigs()
        #expect(configs.isEmpty)
    }

    @Test("Fetch all configs includes inactive")
    func fetchAllIncludesInactive() async throws {
        let db = try makeTestDatabase()

        try await db.saveDebridConfig(DebridConfig(id: "1", service: .realDebrid, apiToken: "t1", isActive: true))
        try await db.saveDebridConfig(DebridConfig(id: "2", service: .allDebrid, apiToken: "t2", isActive: false))
        try await db.saveDebridConfig(DebridConfig(id: "3", service: .premiumize, apiToken: "t3", isActive: true))

        // fetchDebridConfigs only returns active
        let active = try await db.fetchDebridConfigs()
        #expect(active.count == 2)

        // fetchAllDebridConfigs returns all
        let all = try await db.fetchAllDebridConfigs()
        #expect(all.count == 3)
    }

    @Test("Save and verify debrid config round-trip")
    func saveAndVerify() async throws {
        let db = try makeTestDatabase()

        let config = DebridConfig(
            id: DebridServiceType.realDebrid.rawValue,
            service: .realDebrid,
            apiToken: "my-secret-token-123",
            isActive: true,
            priority: 0
        )
        try await db.saveDebridConfig(config)

        // Verify via fetchAll
        let saved = try await db.fetchAllDebridConfigs()
        #expect(saved.contains(where: { $0.service == .realDebrid && $0.apiToken == "my-secret-token-123" }))
    }

    @Test("Update debrid config token")
    func updateToken() async throws {
        let db = try makeTestDatabase()

        try await db.saveDebridConfig(DebridConfig(id: "rd", service: .realDebrid, apiToken: "old-token"))
        try await db.saveDebridConfig(DebridConfig(id: "rd", service: .realDebrid, apiToken: "new-token"))

        let configs = try await db.fetchDebridConfigs()
        #expect(configs.count == 1)
        #expect(configs[0].apiToken == "new-token")
    }

    @Test("Delete config by clearing token")
    func deleteByClearingToken() async throws {
        let db = try makeTestDatabase()

        try await db.saveDebridConfig(DebridConfig(id: "rd", service: .realDebrid, apiToken: "token"))
        try await db.deleteDebridConfig(id: "rd")

        let all = try await db.fetchAllDebridConfigs()
        #expect(all.isEmpty)
    }
}

@Suite("DatabaseManager - Indexer Config Operations")
struct DatabaseIndexerConfigTests {
    @Test("Save and fetch indexer configs")
    func saveAndFetch() async throws {
        let db = try makeTestDatabase()

        let config = IndexerConfig(
            id: "jackett-1",
            type: .jackett,
            baseURL: "http://localhost:9117",
            apiKey: "abc123"
        )
        try await db.saveIndexerConfig(config)

        let configs = try await db.fetchIndexerConfigs()
        #expect(configs.count == 1)
        #expect(configs[0].type == .jackett)
        #expect(configs[0].baseURL == "http://localhost:9117")
    }

    @Test("Fetch all indexers includes inactive and sorted by priority")
    func fetchAllIndexersSorted() async throws {
        let db = try makeTestDatabase()

        try await db.saveIndexerConfig(IndexerConfig(id: "idx-1", type: .jackett, baseURL: "http://1", isActive: true, priority: 20))
        try await db.saveIndexerConfig(IndexerConfig(id: "idx-2", type: .torznab, baseURL: "http://2", isActive: false, priority: 10))
        try await db.saveIndexerConfig(IndexerConfig(id: "idx-3", type: .prowlarr, baseURL: "http://3", isActive: true, priority: 30))

        let active = try await db.fetchIndexerConfigs()
        #expect(active.count == 2)
        #expect(active[0].id == "idx-1")

        let all = try await db.fetchAllIndexerConfigs()
        #expect(all.count == 3)
        #expect(all[0].id == "idx-2")
        #expect(all[1].id == "idx-1")
        #expect(all[2].id == "idx-3")
    }

    @Test("Delete indexer config")
    func deleteIndexerConfig() async throws {
        let db = try makeTestDatabase()
        try await db.saveIndexerConfig(IndexerConfig(id: "idx-del", type: .torznab, baseURL: "http://x"))
        try await db.deleteIndexerConfig(id: "idx-del")

        let all = try await db.fetchAllIndexerConfigs()
        #expect(all.isEmpty)
    }
}

@Suite("DatabaseManager - Migration v5-v8")
struct DatabaseMigrationV5ToV8Tests {
    @Test("v5 backfills user_library.folderId and seeds system folders")
    func v5BackfillFolderIDs() async throws {
        let dbPool = try makeLegacyV4DatabasePool()
        let now = Date()

        try await dbPool.write { db in
            try db.execute(
                sql: "INSERT INTO user_library (id, mediaId, listType, addedAt) VALUES (?, ?, ?, ?)",
                arguments: ["w-1", "tt-w1", "watchlist", now]
            )
            try db.execute(
                sql: "INSERT INTO user_library (id, mediaId, listType, addedAt) VALUES (?, ?, ?, ?)",
                arguments: ["f-1", "tt-f1", "favorites", now]
            )
            try db.execute(
                sql: "INSERT INTO user_library (id, mediaId, listType, addedAt, customListName) VALUES (?, ?, ?, ?, ?)",
                arguments: ["c-1", "tt-c1", "custom", now, "My List"]
            )
        }

        let db = try DatabaseManager(dbPool: dbPool)
        let watchlist = try await db.fetchLibrary(listType: .watchlist)
        let favorites = try await db.fetchLibrary(listType: .favorites)
        let custom = try await db.fetchLibrary(listType: .custom)

        #expect(watchlist.first?.folderId == LibraryFolder.systemFolderID(for: .watchlist))
        #expect(favorites.first?.folderId == LibraryFolder.systemFolderID(for: .favorites))
        #expect(custom.first?.folderId == LibraryFolder.systemFolderID(for: .custom))

        let folders = try await db.fetchAllLibraryFolders()
        #expect(folders.contains(where: { $0.id == LibraryFolder.systemFolderID(for: .watchlist) && $0.isSystem }))
        #expect(folders.contains(where: { $0.id == LibraryFolder.systemFolderID(for: .favorites) && $0.isSystem }))
        #expect(folders.contains(where: { $0.id == LibraryFolder.systemFolderID(for: .custom) && $0.isSystem }))
    }

    @Test("v6-v8 tables are writable via CRUD APIs")
    func v6ToV8TablesRoundTrip() async throws {
        let db = try makeTestDatabase()

        let profile = UserTasteProfile(
            userId: "default",
            likedGenres: ["Sci-Fi", "Thriller"],
            dislikedGenres: ["Horror"],
            preferredDecades: [1990, 2000],
            preferredLanguages: ["en"],
            eventCount: 7
        )
        try await db.saveUserTasteProfile(profile)
        let fetchedProfile = try await db.fetchUserTasteProfile()
        #expect(fetchedProfile?.likedGenres == ["Sci-Fi", "Thriller"])

        let cache = AICurationCacheEntry(
            cacheKey: "discover:seed",
            payload: Data("payload".utf8),
            model: "test-model",
            expiresAt: Date().addingTimeInterval(60)
        )
        try await db.saveDiscoverAICacheEntry(cache)
        let fetchedCache = try await db.fetchDiscoverAICacheEntry(cacheKey: "discover:seed")
        #expect(fetchedCache?.model == "test-model")

        let memory = AssistantMemoryChunk(
            id: "mem-1",
            scope: "default",
            content: "User prefers grounded science fiction",
            tags: ["science fiction", "tone"],
            importance: 0.9
        )
        try await db.saveAssistantMemoryChunk(memory)
        let retrieved = try await db.retrieveAssistantMemory(scope: "default", query: "science", limit: 5)
        #expect(retrieved.count == 1)
        #expect(retrieved[0].id == "mem-1")
    }
}

@Suite("DatabaseManager - Folder Tree Operations")
struct DatabaseFolderTreeTests {
    @Test("Folder tree queries include descendants when requested")
    func folderTreeFetches() async throws {
        let db = try makeTestDatabase()
        let rootID = try await db.fetchSystemLibraryFolderID(listType: .watchlist)

        let child = LibraryFolder(
            id: "watchlist-sci-fi",
            name: "Sci-Fi",
            parentId: rootID,
            listType: .watchlist
        )
        try await db.saveLibraryFolder(child)

        try await db.saveMedia(MediaItem(id: "tt1001", type: .movie, title: "Root Movie"))
        try await db.saveMedia(MediaItem(id: "tt1002", type: .movie, title: "Child Movie"))

        try await db.addToLibrary(UserLibraryEntry(
            id: "tt1001-root",
            mediaId: "tt1001",
            folderId: rootID,
            listType: .watchlist,
            addedAt: Date()
        ))
        try await db.addToLibrary(UserLibraryEntry(
            id: "tt1002-child",
            mediaId: "tt1002",
            folderId: child.id,
            listType: .watchlist,
            addedAt: Date()
        ))

        let directEntries = try await db.fetchLibrary(folderId: rootID)
        #expect(directEntries.count == 1)

        let treeEntries = try await db.fetchLibrary(folderId: rootID, includeDescendants: true)
        #expect(treeEntries.count == 2)

        let descendantIDs = try await db.fetchLibraryFolderDescendantIDs(rootFolderId: rootID)
        #expect(descendantIDs.contains(child.id))

        let treeMedia = try await db.fetchLibraryMedia(folderId: rootID, includeDescendants: true)
        #expect(treeMedia.map(\.id).contains("tt1001"))
        #expect(treeMedia.map(\.id).contains("tt1002"))
    }
}

@Suite("DatabaseManager - Taste and Memory Operations")
struct DatabaseTasteAndMemoryTests {
    @Test("Save and fetch taste events ordered by newest first")
    func tasteEventsRoundTrip() async throws {
        let db = try makeTestDatabase()
        let now = Date()

        try await db.saveTasteEvents([
            TasteEvent(
                id: "te-1",
                userId: "default",
                mediaId: "tt1",
                eventType: .watched,
                signalStrength: 0.7,
                metadata: ["source": "history"],
                createdAt: now.addingTimeInterval(-120)
            ),
            TasteEvent(
                id: "te-2",
                userId: "default",
                mediaId: "tt2",
                eventType: .liked,
                signalStrength: 1.0,
                metadata: ["source": "favorites"],
                createdAt: now
            )
        ])

        let events = try await db.fetchTasteEvents(userId: "default", limit: 10)
        #expect(events.count == 2)
        #expect(events[0].id == "te-2")
        #expect(events[1].id == "te-1")
    }

    @Test("Discover AI cache expires entries")
    func discoverCacheExpiry() async throws {
        let db = try makeTestDatabase()

        try await db.saveDiscoverAICacheEntry(AICurationCacheEntry(
            cacheKey: "live-key",
            payload: Data("live".utf8),
            model: "model-x",
            expiresAt: Date().addingTimeInterval(60)
        ))
        try await db.saveDiscoverAICacheEntry(AICurationCacheEntry(
            cacheKey: "expired-key",
            payload: Data("old".utf8),
            model: "model-y",
            createdAt: Date().addingTimeInterval(-120),
            expiresAt: Date().addingTimeInterval(-60)
        ))

        let live = try await db.fetchDiscoverAICacheEntry(cacheKey: "live-key")
        #expect(live != nil)

        let expired = try await db.fetchDiscoverAICacheEntry(cacheKey: "expired-key")
        #expect(expired == nil)

        let deleted = try await db.deleteExpiredDiscoverAICacheEntries()
        #expect(deleted >= 0)
    }

    @Test("Assistant memory retrieval filters by scope and query")
    func assistantMemoryRetrieval() async throws {
        let db = try makeTestDatabase()
        try await db.saveAssistantMemoryChunks([
            AssistantMemoryChunk(
                id: "mem-a",
                scope: "default",
                content: "The user likes cerebral sci-fi and noir mysteries.",
                tags: ["sci-fi", "noir"],
                importance: 0.9
            ),
            AssistantMemoryChunk(
                id: "mem-b",
                scope: "default",
                content: "Avoid broad slapstick comedy recommendations.",
                tags: ["comedy"],
                importance: 0.4
            ),
            AssistantMemoryChunk(
                id: "mem-c",
                scope: "other",
                content: "Other scope content",
                tags: ["other"],
                importance: 1.0
            )
        ])

        let scoped = try await db.fetchAssistantMemoryChunks(scope: "default", limit: 10)
        #expect(scoped.count == 2)

        let query = try await db.retrieveAssistantMemory(scope: "default", query: "sci-fi", limit: 10)
        #expect(query.count == 1)
        #expect(query[0].id == "mem-a")
    }
}
