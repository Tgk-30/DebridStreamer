import Testing
import Foundation
@testable import DebridStreamer

@Suite("AssistantContextAssembler Tests")
struct AssistantContextAssemblerTests {
    @Test("Recency sensitivity affects history weighting")
    func recencySensitivityAffectsWeighting() async throws {
        let db = try makeTestDatabase()
        try await db.setSetting(key: SettingsKeys.personalizationEnabled, value: "true")
        try await db.saveMedia(MediaItem(id: "tt-recency", type: .movie, title: "Recency Film", year: 2024))
        try await db.saveWatchHistory(
            WatchHistory(
                id: "wh-recency",
                mediaId: "tt-recency",
                progressSeconds: 100,
                durationSeconds: 3600,
                completed: false,
                lastWatched: Date().addingTimeInterval(-120 * 86_400)
            )
        )

        let assembler = AssistantContextAssembler(database: db, metadataProvider: nil)

        try await db.setSetting(key: SettingsKeys.recencySensitivity, value: "1.0")
        let highSensitivity = await assembler.buildContext(prompt: "test", folderId: nil)
        let highWeight = recencyWeight(from: highSensitivity.contextNotes)

        try await db.setSetting(key: SettingsKeys.recencySensitivity, value: "0.0")
        let lowSensitivity = await assembler.buildContext(prompt: "test", folderId: nil)
        let lowWeight = recencyWeight(from: lowSensitivity.contextNotes)

        #expect(lowWeight > highWeight)
    }

    @Test("Context reports personalization opt-in state")
    func contextIncludesPersonalizationFlag() async throws {
        let db = try makeTestDatabase()
        let assembler = AssistantContextAssembler(database: db, metadataProvider: nil)

        try await db.setSetting(key: SettingsKeys.personalizationEnabled, value: "false")
        let disabled = await assembler.buildContext(prompt: "test", folderId: nil)
        #expect(disabled.personalizationEnabled == false)

        try await db.setSetting(key: SettingsKeys.personalizationEnabled, value: "true")
        let enabled = await assembler.buildContext(prompt: "test", folderId: nil)
        #expect(enabled.personalizationEnabled == true)
    }

    @Test("Context includes full library titles regardless of active folder")
    func contextIncludesFullLibrary() async throws {
        let db = try makeTestDatabase()
        try await db.setSetting(key: SettingsKeys.personalizationEnabled, value: "false")
        let assembler = AssistantContextAssembler(database: db, metadataProvider: nil)

        let rootID = try await db.fetchSystemLibraryFolderID(listType: .favorites)
        let folder = try await db.createLibraryFolder(name: "Focused", listType: .favorites, parentId: rootID)

        try await db.saveMedia(MediaItem(id: "tt-full-1", type: .movie, title: "Folder Title", year: 2026))
        try await db.saveMedia(MediaItem(id: "tt-full-2", type: .movie, title: "Root Title", year: 2025))

        try await db.addToLibrary(UserLibraryEntry(id: "full-1", mediaId: "tt-full-1", folderId: folder.id, listType: .favorites))
        try await db.addToLibrary(UserLibraryEntry(id: "full-2", mediaId: "tt-full-2", folderId: rootID, listType: .favorites))

        let context = await assembler.buildContext(prompt: "recommend", folderId: folder.id)
        #expect(context.candidateTitles.contains("Folder Title"))
        #expect(context.candidateTitles.contains("Root Title"))
        #expect(context.contextNotes.contains(where: { $0.contains("Active folder boost applied") }))
    }

    @Test("Active folder influences recency weighting notes")
    func activeFolderBoostAffectsRecencyNote() async throws {
        let db = try makeTestDatabase()
        try await db.setSetting(key: SettingsKeys.personalizationEnabled, value: "true")
        try await db.setSetting(key: SettingsKeys.recencySensitivity, value: "0.5")
        let assembler = AssistantContextAssembler(database: db, metadataProvider: nil)

        let rootID = try await db.fetchSystemLibraryFolderID(listType: .favorites)
        let folder = try await db.createLibraryFolder(name: "Boosted", listType: .favorites, parentId: rootID)

        try await db.saveMedia(MediaItem(id: "tt-boost", type: .movie, title: "Boosted Movie", year: 2024))
        try await db.addToLibrary(UserLibraryEntry(id: "boost-1", mediaId: "tt-boost", folderId: folder.id, listType: .favorites))
        try await db.saveWatchHistory(
            WatchHistory(
                id: "wh-boost",
                mediaId: "tt-boost",
                progressSeconds: 120,
                durationSeconds: 3600,
                completed: false,
                lastWatched: Date().addingTimeInterval(-7 * 86_400)
            )
        )

        let context = await assembler.buildContext(prompt: "find similar", folderId: folder.id)
        #expect(context.contextNotes.contains(where: { $0.contains("Boosted Movie") && $0.contains("recency") }))
    }

    @Test("Context includes watched and release wait folder signals")
    func contextIncludesWatchedAndReleaseWaitSignals() async throws {
        let db = try makeTestDatabase()
        try await db.setSetting(key: SettingsKeys.personalizationEnabled, value: "true")

        let watchedFolder = try await db.fetchFolderByKind(listType: .favorites, kind: .watched)
        let releaseWaitFolder = try await db.fetchFolderByKind(listType: .favorites, kind: .releaseWait)
        let watchedFolderID = try #require(watchedFolder).id
        let releaseWaitFolderID = try #require(releaseWaitFolder).id

        try await db.saveMedia(MediaItem(id: "tt-watched-context", type: .movie, title: "Watched Context", year: 2024))
        try await db.saveMedia(MediaItem(id: "tt-release-context", type: .series, title: "Release Context", year: 2025))

        _ = try await db.addOrUpsertLibraryEntryPreservingExistingFolders(
            mediaId: "tt-watched-context",
            listType: .favorites,
            folderId: watchedFolderID
        )
        _ = try await db.addOrUpsertLibraryEntryPreservingExistingFolders(
            mediaId: "tt-release-context",
            listType: .favorites,
            folderId: releaseWaitFolderID,
            releaseDateHint: "2027-01-01",
            renewalStatus: "Returning Series"
        )

        let assembler = AssistantContextAssembler(database: db, metadataProvider: nil)
        let context = await assembler.buildContext(prompt: "what next", folderId: nil)

        #expect(context.contextNotes.contains(where: { $0.contains("Watched folder has") }))
        #expect(context.contextNotes.contains(where: { $0.contains("Release Wait has") }))
        #expect(context.contextNotes.contains(where: { $0.contains("Release Context") }))
    }

    private func recencyWeight(from notes: [String]) -> Double {
        for note in notes {
            guard let markerRange = note.range(of: "recency ") else { continue }
            let suffix = note[markerRange.upperBound...]
            let value = suffix
                .prefix { $0.isNumber || $0 == "." }
            if let parsed = Double(value) {
                return parsed
            }
        }
        return 0
    }
}
