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
