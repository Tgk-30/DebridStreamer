import Testing
import Foundation
@testable import DebridStreamer

// MARK: - FeedbackScaleMode

@Suite("FeedbackScaleMode Tests")
struct FeedbackScaleModeTests {
    @Test("All cases present with stable raw values")
    func allCasesRawValues() {
        #expect(FeedbackScaleMode.allCases.count == 4)
        #expect(FeedbackScaleMode.none.rawValue == "none")
        #expect(FeedbackScaleMode.likeDislike.rawValue == "like_dislike")
        #expect(FeedbackScaleMode.scale1to10.rawValue == "scale_1_10")
        #expect(FeedbackScaleMode.scale1to100.rawValue == "scale_1_100")
    }

    @Test("Raw value round-trips back to case")
    func rawValueRoundTrip() {
        for mode in FeedbackScaleMode.allCases {
            #expect(FeedbackScaleMode(rawValue: mode.rawValue) == mode)
        }
    }

    @Test("Unknown raw value yields nil")
    func unknownRawValue() {
        #expect(FeedbackScaleMode(rawValue: "scale_1_5") == nil)
    }

    @Test("Identifiable id mirrors raw value")
    func identifiableID() {
        for mode in FeedbackScaleMode.allCases {
            #expect(mode.id == mode.rawValue)
        }
    }

    @Test("Display names map correctly")
    func displayNames() {
        #expect(FeedbackScaleMode.none.displayName == "None")
        #expect(FeedbackScaleMode.likeDislike.displayName == "Like / Dislike")
        #expect(FeedbackScaleMode.scale1to10.displayName == "1 to 10")
        #expect(FeedbackScaleMode.scale1to100.displayName == "1 to 100")
    }

    @Test("Codable round-trip preserves case")
    func codableRoundTrip() throws {
        let encoder = JSONEncoder()
        let decoder = JSONDecoder()
        for mode in FeedbackScaleMode.allCases {
            let data = try encoder.encode(mode)
            let decoded = try decoder.decode(FeedbackScaleMode.self, from: data)
            #expect(decoded == mode)
        }
    }

    @Test("Encodes to its string raw value")
    func encodesToRawValueString() throws {
        let data = try JSONEncoder().encode(FeedbackScaleMode.likeDislike)
        let json = String(decoding: data, as: UTF8.self)
        #expect(json == "\"like_dislike\"")
    }
}

// MARK: - WatchedState

@Suite("WatchedState Tests")
struct WatchedStateTests {
    @Test("All cases present with stable raw values")
    func allCasesRawValues() {
        #expect(WatchedState.allCases.count == 2)
        #expect(WatchedState.watched.rawValue == "watched")
        #expect(WatchedState.notWatched.rawValue == "not_watched")
    }

    @Test("Raw value round-trips back to case")
    func rawValueRoundTrip() {
        #expect(WatchedState(rawValue: "watched") == .watched)
        #expect(WatchedState(rawValue: "not_watched") == .notWatched)
        #expect(WatchedState(rawValue: "maybe") == nil)
    }

    @Test("Codable round-trip preserves case")
    func codableRoundTrip() throws {
        let encoder = JSONEncoder()
        let decoder = JSONDecoder()
        for state in WatchedState.allCases {
            let data = try encoder.encode(state)
            let decoded = try decoder.decode(WatchedState.self, from: data)
            #expect(decoded == state)
        }
    }
}

// MARK: - FeedbackSource

@Suite("FeedbackSource Tests")
struct FeedbackSourceTests {
    @Test("Raw values are stable")
    func rawValues() {
        #expect(FeedbackSource.manual.rawValue == "manual")
        #expect(FeedbackSource.auto.rawValue == "auto")
    }

    @Test("Raw value round-trips back to case")
    func rawValueRoundTrip() {
        #expect(FeedbackSource(rawValue: "manual") == .manual)
        #expect(FeedbackSource(rawValue: "auto") == .auto)
        #expect(FeedbackSource(rawValue: "system") == nil)
    }

    @Test("Codable round-trip preserves case")
    func codableRoundTrip() throws {
        let manualData = try JSONEncoder().encode(FeedbackSource.manual)
        let decodedManual = try JSONDecoder().decode(FeedbackSource.self, from: manualData)
        #expect(decodedManual == .manual)

        let autoData = try JSONEncoder().encode(FeedbackSource.auto)
        let decodedAuto = try JSONDecoder().decode(FeedbackSource.self, from: autoData)
        #expect(decodedAuto == .auto)
    }
}

// MARK: - TasteEvent

@Suite("TasteEvent Tests")
struct TasteEventTests {
    @Test("EventType raw values include snake_case overrides")
    func eventTypeRawValues() {
        #expect(TasteEvent.EventType.allCases.count == 9)
        #expect(TasteEvent.EventType.watched.rawValue == "watched")
        #expect(TasteEvent.EventType.completed.rawValue == "completed")
        #expect(TasteEvent.EventType.liked.rawValue == "liked")
        #expect(TasteEvent.EventType.disliked.rawValue == "disliked")
        #expect(TasteEvent.EventType.addedToWatchlist.rawValue == "added_to_watchlist")
        #expect(TasteEvent.EventType.removedFromWatchlist.rawValue == "removed_from_watchlist")
        #expect(TasteEvent.EventType.searched.rawValue == "searched")
        #expect(TasteEvent.EventType.rated.rawValue == "rated")
        #expect(TasteEvent.EventType.notInterested.rawValue == "not_interested")
    }

    @Test("Convenience init applies defaults")
    func initDefaults() {
        let event = TasteEvent(id: "evt-1", eventType: .liked)
        #expect(event.id == "evt-1")
        #expect(event.userId == "default")
        #expect(event.mediaId == nil)
        #expect(event.episodeId == nil)
        #expect(event.eventType == .liked)
        #expect(event.signalStrength == 1.0)
        #expect(event.watchedState == nil)
        #expect(event.feedbackScale == nil)
        #expect(event.feedbackValue == nil)
        #expect(event.source == nil)
        #expect(event.metadata.isEmpty)
    }

    @Test("Identifiable id is the event id")
    func identifiable() {
        let event = TasteEvent(id: "evt-42", eventType: .rated)
        #expect(event.id == "evt-42")
    }

    @Test("Codable round-trip preserves all populated fields")
    func codableRoundTripFull() throws {
        let created = Date(timeIntervalSince1970: 1_700_000_000)
        let original = TasteEvent(
            id: "evt-full",
            userId: "user-7",
            mediaId: "tt1234567",
            episodeId: "tt1234567:s1e2",
            eventType: .rated,
            signalStrength: 0.75,
            watchedState: .watched,
            feedbackScale: .scale1to10,
            feedbackValue: 8.0,
            source: .manual,
            metadata: ["genre": "drama", "mood": "calm"],
            createdAt: created
        )

        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601

        let data = try encoder.encode(original)
        let decoded = try decoder.decode(TasteEvent.self, from: data)

        #expect(decoded == original)
        #expect(decoded.feedbackScale == .scale1to10)
        #expect(decoded.feedbackValue == 8.0)
        #expect(decoded.watchedState == .watched)
        #expect(decoded.source == .manual)
        #expect(decoded.metadata["genre"] == "drama")
        #expect(decoded.metadata["mood"] == "calm")
    }

    @Test("Codable round-trip preserves nil optionals")
    func codableRoundTripNilOptionals() throws {
        let original = TasteEvent(
            id: "evt-min",
            eventType: .searched,
            metadata: [:]
        )
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601

        let data = try encoder.encode(original)
        let decoded = try decoder.decode(TasteEvent.self, from: data)

        // Note: don't compare `== original` - the timestamp loses sub-second
        // precision through .iso8601, so equate the stable fields instead.
        #expect(decoded.id == original.id)
        #expect(decoded.eventType == original.eventType)
        #expect(decoded.mediaId == nil)
        #expect(decoded.feedbackScale == nil)
        #expect(decoded.source == nil)
        #expect(decoded.metadata.isEmpty)
    }

    @Test("Equality differs when a field changes")
    func equalityDiscriminates() {
        let created = Date(timeIntervalSince1970: 1_700_000_000)
        let base = TasteEvent(
            id: "evt-eq",
            eventType: .liked,
            signalStrength: 1.0,
            createdAt: created
        )
        let same = TasteEvent(
            id: "evt-eq",
            eventType: .liked,
            signalStrength: 1.0,
            createdAt: created
        )
        let different = TasteEvent(
            id: "evt-eq",
            eventType: .disliked,
            signalStrength: 1.0,
            createdAt: created
        )
        #expect(base == same)
        #expect(base != different)
    }
}

// MARK: - UserTasteProfile

@Suite("UserTasteProfile Tests")
struct UserTasteProfileTests {
    @Test("Convenience init applies defaults")
    func initDefaults() {
        let profile = UserTasteProfile()
        #expect(profile.userId == "default")
        #expect(profile.likedGenres.isEmpty)
        #expect(profile.dislikedGenres.isEmpty)
        #expect(profile.preferredDecades.isEmpty)
        #expect(profile.preferredLanguages.isEmpty)
        #expect(profile.eventCount == 0)
    }

    @Test("Identifiable id mirrors userId")
    func identifiable() {
        let profile = UserTasteProfile(userId: "user-9")
        #expect(profile.id == "user-9")
    }

    @Test("Codable round-trip preserves populated arrays")
    func codableRoundTrip() throws {
        let updated = Date(timeIntervalSince1970: 1_690_000_000)
        let original = UserTasteProfile(
            userId: "user-3",
            likedGenres: ["Action", "Sci-Fi"],
            dislikedGenres: ["Horror"],
            preferredDecades: [1990, 2000, 2010],
            preferredLanguages: ["en", "ja"],
            eventCount: 12,
            updatedAt: updated
        )

        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601

        let data = try encoder.encode(original)
        let decoded = try decoder.decode(UserTasteProfile.self, from: data)

        #expect(decoded == original)
        #expect(decoded.likedGenres == ["Action", "Sci-Fi"])
        #expect(decoded.dislikedGenres == ["Horror"])
        #expect(decoded.preferredDecades == [1990, 2000, 2010])
        #expect(decoded.preferredLanguages == ["en", "ja"])
        #expect(decoded.eventCount == 12)
    }

    @Test("Equality discriminates on liked genres")
    func equalityDiscriminates() {
        let updated = Date(timeIntervalSince1970: 1_690_000_000)
        let a = UserTasteProfile(userId: "u", likedGenres: ["Action"], updatedAt: updated)
        let b = UserTasteProfile(userId: "u", likedGenres: ["Action"], updatedAt: updated)
        let c = UserTasteProfile(userId: "u", likedGenres: ["Comedy"], updatedAt: updated)
        #expect(a == b)
        #expect(a != c)
    }
}

// MARK: - LibraryFolder

@Suite("LibraryFolder Tests")
struct LibraryFolderModelTests {
    @Test("FolderKind raw values are stable")
    func folderKindRawValues() {
        #expect(LibraryFolder.FolderKind.allCases.count == 4)
        #expect(LibraryFolder.FolderKind.systemRoot.rawValue == "system_root")
        #expect(LibraryFolder.FolderKind.manual.rawValue == "manual")
        #expect(LibraryFolder.FolderKind.watched.rawValue == "watched")
        #expect(LibraryFolder.FolderKind.releaseWait.rawValue == "release_wait")
    }

    @Test("Convenience init applies defaults")
    func initDefaults() {
        let folder = LibraryFolder(id: "f1", name: "My Folder", listType: .favorites)
        #expect(folder.parentId == nil)
        #expect(folder.folderKind == .manual)
        #expect(folder.isSystem == false)
    }

    @Test("System folder id derived from list type")
    func systemFolderID() {
        #expect(LibraryFolder.systemFolderID(for: .watchlist) == "system-watchlist")
        #expect(LibraryFolder.systemFolderID(for: .favorites) == "system-favorites")
        #expect(LibraryFolder.systemFolderID(for: .custom) == "system-custom")
    }

    @Test("Behavior folder id maps by kind")
    func behaviorFolderID() {
        #expect(LibraryFolder.behaviorFolderID(for: .watched) == LibraryFolder.watchedFolderID)
        #expect(LibraryFolder.behaviorFolderID(for: .watched) == "system-favorites-watched")
        #expect(LibraryFolder.behaviorFolderID(for: .releaseWait) == LibraryFolder.releaseWaitFolderID)
        #expect(LibraryFolder.behaviorFolderID(for: .releaseWait) == "system-favorites-release-wait")
        #expect(LibraryFolder.behaviorFolderID(for: .systemRoot) == "system-favorites")
        #expect(LibraryFolder.behaviorFolderID(for: .manual) == "system-favorites")
    }

    @Test("Behavior folder name maps by kind")
    func behaviorFolderName() {
        #expect(LibraryFolder.behaviorFolderName(for: .watched) == "Watched")
        #expect(LibraryFolder.behaviorFolderName(for: .releaseWait) == "Release Wait")
        #expect(LibraryFolder.behaviorFolderName(for: .systemRoot) == "Library")
        #expect(LibraryFolder.behaviorFolderName(for: .manual) == "Folder")
    }

    @Test("System folder name maps by list type")
    func systemFolderName() {
        #expect(LibraryFolder.systemFolderName(for: .watchlist) == "Watchlist")
        #expect(LibraryFolder.systemFolderName(for: .favorites) == "Library")
        #expect(LibraryFolder.systemFolderName(for: .custom) == "Custom")
    }

    @Test("Codable round-trip preserves fields")
    func codableRoundTrip() throws {
        let created = Date(timeIntervalSince1970: 1_600_000_000)
        let updated = Date(timeIntervalSince1970: 1_600_001_000)
        let original = LibraryFolder(
            id: "folder-7",
            name: "Sci-Fi Gems",
            parentId: "folder-root",
            listType: .custom,
            folderKind: .manual,
            isSystem: false,
            createdAt: created,
            updatedAt: updated
        )

        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601

        let data = try encoder.encode(original)
        let decoded = try decoder.decode(LibraryFolder.self, from: data)

        #expect(decoded == original)
        #expect(decoded.parentId == "folder-root")
        #expect(decoded.folderKind == .manual)
    }
}

// MARK: - LibraryFoldering (tree / path traversal helpers)

@Suite("LibraryFoldering Tests")
struct LibraryFolderingTests {
    @Test("Static labels")
    func labels() {
        #expect(LibraryFoldering.allFoldersLabel == "All Folders")
        #expect(LibraryFoldering.unsortedLabel == "Unsorted")
    }

    @Test("Entry id combines media id and list type")
    func entryID() {
        let id = LibraryFoldering.entryID(mediaId: "tt100", listType: .favorites)
        #expect(id == "tt100-favorites")
    }

    @Test("Normalize collapses separators, trims, and drops empties")
    func normalizeStoredFolder() {
        #expect(LibraryFoldering.normalizeStoredFolder("Movies/Sci-Fi") == "Movies/Sci-Fi")
        #expect(LibraryFoldering.normalizeStoredFolder("Movies\\Sci-Fi") == "Movies/Sci-Fi")
        #expect(LibraryFoldering.normalizeStoredFolder("  Movies // Sci-Fi /") == "Movies/Sci-Fi")
        #expect(LibraryFoldering.normalizeStoredFolder("/leading/") == "leading")
    }

    @Test("Normalize returns nil for empty-ish input")
    func normalizeEmpty() {
        #expect(LibraryFoldering.normalizeStoredFolder(nil) == nil)
        #expect(LibraryFoldering.normalizeStoredFolder("") == nil)
        #expect(LibraryFoldering.normalizeStoredFolder("   ") == nil)
        #expect(LibraryFoldering.normalizeStoredFolder("//") == nil)
    }

    @Test("Display name falls back to Unsorted")
    func displayName() {
        #expect(LibraryFoldering.displayName(for: "Movies/Action") == "Movies/Action")
        #expect(LibraryFoldering.displayName(for: nil) == "Unsorted")
        #expect(LibraryFoldering.displayName(for: "  ") == "Unsorted")
    }

    @Test("Matches exact selection path")
    func matchesExact() {
        #expect(LibraryFoldering.matches(storedFolder: "Movies/Action", selectionPath: "Movies/Action"))
    }

    @Test("Matches descendant of selection path")
    func matchesDescendant() {
        #expect(LibraryFoldering.matches(storedFolder: "Movies/Action/Heist", selectionPath: "Movies"))
        #expect(LibraryFoldering.matches(storedFolder: "Movies/Action/Heist", selectionPath: "Movies/Action"))
    }

    @Test("Does not match sibling or partial prefix")
    func matchesRejectsSiblings() {
        // Partial segment prefix must NOT match (boundary requires a '/').
        #expect(!LibraryFoldering.matches(storedFolder: "MoviesArchive", selectionPath: "Movies"))
        // Sibling subtree.
        #expect(!LibraryFoldering.matches(storedFolder: "Movies/Comedy", selectionPath: "Movies/Action"))
        // Ancestor is not a descendant of its child.
        #expect(!LibraryFoldering.matches(storedFolder: "Movies", selectionPath: "Movies/Action"))
    }

    @Test("Matches returns false for unsorted (nil) entries")
    func matchesNilFolder() {
        #expect(!LibraryFoldering.matches(storedFolder: nil, selectionPath: "Movies"))
        #expect(!LibraryFoldering.matches(storedFolder: "   ", selectionPath: "Movies"))
    }

    @Test("Folder segments split the normalized path")
    func folderSegments() {
        #expect(LibraryFoldering.folderSegments(from: "Movies/Action/Heist") == ["Movies", "Action", "Heist"])
        #expect(LibraryFoldering.folderSegments(from: "Movies\\Action") == ["Movies", "Action"])
        #expect(LibraryFoldering.folderSegments(from: "  Solo  ") == ["Solo"])
    }

    @Test("Folder segments empty for nil or blank")
    func folderSegmentsEmpty() {
        #expect(LibraryFoldering.folderSegments(from: nil).isEmpty)
        #expect(LibraryFoldering.folderSegments(from: "").isEmpty)
        #expect(LibraryFoldering.folderSegments(from: "  ").isEmpty)
    }
}
