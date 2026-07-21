import Testing
import Foundation
import GRDB
@testable import DebridStreamer

@Suite("Model serialization and display tests")
struct ModelSerializationAndDisplayTests {
    @Test("Person profile URLs are nil for empty or missing paths")
    func personProfileURLsForEmptyOrMissingPath() {
        let withoutPath = Person(id: 1, name: "No Path")
        #expect(withoutPath.profileURL == nil)
        #expect(withoutPath.profileLargeURL == nil)

        let withBlankPath = Person(
            id: 2,
            name: "Blank",
            profilePath: ""
        )
        #expect(withBlankPath.profileURL == nil)
        #expect(withBlankPath.profileLargeURL == nil)
    }

    @Test("Person profile URLs build expected TMDB endpoints")
    func personProfileURLBuildsExpectedEndpoints() {
        let person = Person(
            id: 3,
            name: "Director",
            profilePath: "/abcdef"
        )

        #expect(person.profileURL?.absoluteString == "https://image.tmdb.org/t/p/w185/abcdef")
        #expect(person.profileLargeURL?.absoluteString == "https://image.tmdb.org/t/p/h632/abcdef")
    }

    @Test("AICurationCacheEntry can round-trip through persistence")
    func aICurationCacheEntryRoundTrip() throws {
        let original = AICurationCacheEntry(
            cacheKey: "plan-key",
            payload: "payload".data(using: .utf8)!,
            model: "gpt-4.1-mini",
            createdAt: Date(timeIntervalSince1970: 1_000),
            expiresAt: Date(timeIntervalSince1970: 2_000)
        )

        let dbQueue = try DatabaseQueue(named: "aicache")
        try dbQueue.write { db in
            try db.create(table: AICurationCacheEntry.databaseTableName) { t in
                t.primaryKey("cacheKey", .text).notNull()
                t.column("payload", .blob).notNull()
                t.column("model", .text)
                t.column("createdAt", .datetime).notNull()
                t.column("expiresAt", .datetime).notNull()
            }
            try original.insert(db)

            let row = try #require(try Row.fetchOne(db, sql: "SELECT * FROM discover_ai_cache WHERE cacheKey = ?", arguments: [original.cacheKey]))
            let decoded = try? AICurationCacheEntry(row: row)
            #expect(decoded != nil)
            if let decoded {
                #expect(decoded == original)
                #expect(decoded.id == original.cacheKey)
            }
        }
    }

    @Test("AICurationCacheEntry exposes stable id alias")
    func aICurationCacheEntryIdIsCacheKeyAlias() {
        let entry = AICurationCacheEntry(
            cacheKey: "cache-key-id",
            payload: Data([0x01, 0x02, 0x03]),
            model: "mini",
            expiresAt: Date(timeIntervalSince1970: 20)
        )
        #expect(entry.id == "cache-key-id")
    }

    @Test("AssistantMemoryChunk decodes persisted JSON and handles missing tag data")
    func assistantMemoryChunkRowDecodingFallbacks() throws {
        let encoded = try JSONEncoder().encode(["mood", "action"])
        let validRow = Row([
            AssistantMemoryChunk.Columns.id.rawValue: "memory-1",
            AssistantMemoryChunk.Columns.scope.rawValue: "scope-a",
            AssistantMemoryChunk.Columns.content.rawValue: "Saved memory",
            AssistantMemoryChunk.Columns.summary.rawValue: "summary",
            AssistantMemoryChunk.Columns.tags.rawValue: encoded,
            AssistantMemoryChunk.Columns.importance.rawValue: 0.5,
            AssistantMemoryChunk.Columns.createdAt.rawValue: Date(timeIntervalSince1970: 10),
            AssistantMemoryChunk.Columns.lastAccessedAt.rawValue: Date(timeIntervalSince1970: 20)
        ])
        let fromValid = try AssistantMemoryChunk(row: validRow)
        #expect(fromValid.tags == ["mood", "action"])

        let missingTagsRow = Row([
            AssistantMemoryChunk.Columns.id.rawValue: "memory-2",
            AssistantMemoryChunk.Columns.scope.rawValue: "scope-b",
            AssistantMemoryChunk.Columns.content.rawValue: "No tags",
            AssistantMemoryChunk.Columns.importance.rawValue: 0.0,
            AssistantMemoryChunk.Columns.createdAt.rawValue: Date(timeIntervalSince1970: 11)
        ])
        let fromMissing = try AssistantMemoryChunk(row: missingTagsRow)
        #expect(fromMissing.tags.isEmpty)

        let original = AssistantMemoryChunk(
            id: "memory-3",
            content: "Chunk",
            tags: ["history", "news"],
            importance: 0.75
        )

        let dbQueue = try DatabaseQueue(named: "assistant-memory")
        try dbQueue.write { db in
            try db.create(table: AssistantMemoryChunk.databaseTableName) { t in
                t.primaryKey("id", .text).notNull()
                t.column("scope", .text).notNull()
                t.column("content", .text).notNull()
                t.column("summary", .text)
                t.column("tags", .blob)
                t.column("importance", .double).notNull()
                t.column("createdAt", .datetime).notNull()
                t.column("lastAccessedAt", .datetime)
            }
            try original.insert(db)
            let row = try #require(try Row.fetchOne(db, sql: "SELECT * FROM assistant_memory_chunks WHERE id = ?", arguments: [original.id]))
            let fetched = try? AssistantMemoryChunk(row: row)
            #expect(fetched?.id == original.id)
            #expect(fetched?.tags == original.tags)
        }
    }

    @Test("UserTasteProfile decodes json blobs and falls back when data is missing")
    func userTasteProfileRowDecodingFallbacks() throws {
        let validRow = Row([
            UserTasteProfile.Columns.userId.rawValue: "u-1",
            UserTasteProfile.Columns.likedGenres.rawValue: try JSONEncoder().encode(["Drama"]),
            UserTasteProfile.Columns.dislikedGenres.rawValue: try JSONEncoder().encode(["Horror"]),
            UserTasteProfile.Columns.preferredDecades.rawValue: try JSONEncoder().encode([1990, 2000]),
            UserTasteProfile.Columns.preferredLanguages.rawValue: try JSONEncoder().encode(["en", "es"]),
            UserTasteProfile.Columns.eventCount.rawValue: 7,
            UserTasteProfile.Columns.updatedAt.rawValue: Date(timeIntervalSince1970: 12)
        ])
        let decoded = try UserTasteProfile(row: validRow)
        #expect(decoded.likedGenres == ["Drama"])
        #expect(decoded.dislikedGenres == ["Horror"])
        #expect(decoded.preferredDecades == [1990, 2000])
        #expect(decoded.preferredLanguages == ["en", "es"])
        #expect(decoded.eventCount == 7)

        let fallbackRow = Row([
            UserTasteProfile.Columns.userId.rawValue: "u-2",
            UserTasteProfile.Columns.eventCount.rawValue: 0,
            UserTasteProfile.Columns.updatedAt.rawValue: Date(timeIntervalSince1970: 12)
        ])
        let fallback = try UserTasteProfile(row: fallbackRow)
        #expect(fallback.userId == "u-2")
        #expect(fallback.likedGenres.isEmpty)
        #expect(fallback.dislikedGenres.isEmpty)
        #expect(fallback.preferredDecades.isEmpty)
        #expect(fallback.preferredLanguages.isEmpty)

        let defaultEntry = UserTasteProfile(userId: "u-default", eventCount: 2)
        let dbQueue = try DatabaseQueue(named: "taste-profile")
        try dbQueue.write { db in
            try db.create(table: UserTasteProfile.databaseTableName) { t in
                t.primaryKey("userId", .text).notNull()
                t.column("likedGenres", .blob)
                t.column("dislikedGenres", .blob)
                t.column("preferredDecades", .blob)
                t.column("preferredLanguages", .blob)
                t.column("eventCount", .integer).notNull().defaults(to: 0)
                t.column("updatedAt", .datetime).notNull()
            }
            try defaultEntry.insert(db)
            let row = try #require(try Row.fetchOne(db, sql: "SELECT * FROM user_taste_profile WHERE userId = ?", arguments: [defaultEntry.userId]))
            let fetched = try? UserTasteProfile(row: row)
            #expect(fetched?.userId == defaultEntry.userId)
        }
    }

    @Test("TasteEvent decodes raw values and defaults invalid enum values")
    func tasteEventRowDecodingDefaultsAndCustom() throws {
        let validRow = Row([
            TasteEvent.Columns.id.rawValue: "evt-1",
            TasteEvent.Columns.userId.rawValue: "u-1",
            TasteEvent.Columns.mediaId.rawValue: "m-1",
            TasteEvent.Columns.eventType.rawValue: TasteEvent.EventType.liked.rawValue,
            TasteEvent.Columns.signalStrength.rawValue: 0.5,
            TasteEvent.Columns.watchedState.rawValue: WatchedState.watched.rawValue,
            TasteEvent.Columns.feedbackScale.rawValue: FeedbackScaleMode.likeDislike.rawValue,
            TasteEvent.Columns.feedbackValue.rawValue: 0.2,
            TasteEvent.Columns.source.rawValue: FeedbackSource.manual.rawValue,
            TasteEvent.Columns.metadata.rawValue: try JSONEncoder().encode(["foo": "bar"]),
            TasteEvent.Columns.createdAt.rawValue: Date(timeIntervalSince1970: 30)
        ])

        let decoded = try TasteEvent(row: validRow)
        #expect(decoded.eventType == .liked)
        #expect(decoded.watchedState == .watched)
        #expect(decoded.feedbackScale == .likeDislike)
        #expect(decoded.source == .manual)
        #expect(decoded.metadata == ["foo": "bar"])

        let invalidRow = Row([
            TasteEvent.Columns.id.rawValue: "evt-2",
            TasteEvent.Columns.userId.rawValue: "u-2",
            TasteEvent.Columns.eventType.rawValue: "unknown",
            TasteEvent.Columns.signalStrength.rawValue: 1.0,
            TasteEvent.Columns.createdAt.rawValue: Date(timeIntervalSince1970: 31)
        ])
        let fallback = try TasteEvent(row: invalidRow)
        #expect(fallback.eventType == .watched)
        #expect(fallback.watchedState == nil)
        #expect(fallback.feedbackScale == nil)
        #expect(fallback.source == nil)
        #expect(fallback.metadata == [:])

        let original = TasteEvent(
            id: "evt-3",
            userId: "u-3",
            eventType: .completed,
            signalStrength: 1.3,
            metadata: ["note": "ok"]
        )

        let dbQueue = try DatabaseQueue(named: "taste-event")
        try dbQueue.write { db in
            try db.create(table: TasteEvent.databaseTableName) { t in
                t.primaryKey("id", .text).notNull()
                t.column("userId", .text).notNull()
                t.column("mediaId", .text)
                t.column("episodeId", .text)
                t.column("eventType", .text).notNull()
                t.column("signalStrength", .double).notNull()
                t.column("watchedState", .text)
                t.column("feedbackScale", .text)
                t.column("feedbackValue", .double)
                t.column("source", .text)
                t.column("metadata", .blob)
                t.column("createdAt", .datetime).notNull()
            }
            try original.insert(db)
            let row = try #require(try Row.fetchOne(db, sql: "SELECT * FROM taste_events WHERE id = ?", arguments: [original.id]))
            let fetched = try? TasteEvent(row: row)
            #expect(fetched?.eventType == .completed)
            #expect(fetched?.metadata == ["note": "ok"])
        }
    }

    @Test("Player runtime and engine display names are stable")
    func playerRuntimeAndEngineDisplayNames() {
        #expect(PlayerRuntimeState.preparing.displayName == "Preparing")
        #expect(PlayerRuntimeState.buffering.displayName == "Buffering")
        #expect(PlayerRuntimeState.playing.displayName == "Playing")
        #expect(PlayerRuntimeState.stalled.displayName == "Stalled")
        #expect(PlayerRuntimeState.failed.displayName == "Failed")
        #expect(PlayerRuntimeState.fallbackLaunched.displayName == "Fallback Launched")

        #expect(PlayerEngineKind.avPlayer.displayName == "AVPlayer")
        #expect(PlayerEngineKind.vlc.displayName == "VLC")
    }

    @Test("Player engine errors generate expected descriptions")
    func playerEngineErrorsFormatMessages() {
        #expect(PlayerEngineError.invalidStreamURL("bad").localizedDescription == "Invalid stream URL: bad")
        #expect(PlayerEngineError.streamHTTPStatus(404).localizedDescription == "Stream returned HTTP 404.")
        #expect(PlayerEngineError.network("offline").localizedDescription == "Network check failed: offline")
        #expect(PlayerEngineError.unsupported("not supported").localizedDescription == "not supported")
        #expect(PlayerEngineError.vlcKitUnavailable.errorDescription == "VLCKit is not bundled in this build.")
    }
}
