import Foundation

struct AssistantContext: Sendable {
    var candidateTitles: [String]
    var contextNotes: [String]
    var personalizationEnabled: Bool
}

actor AssistantContextAssembler {
    private let database: DatabaseManager?
    private let metadataProvider: (any MetadataProvider)?

    init(database: DatabaseManager?, metadataProvider: (any MetadataProvider)?) {
        self.database = database
        self.metadataProvider = metadataProvider
    }

    func buildContext(
        prompt: String,
        folderId: String?,
        maxCandidates: Int = 100
    ) async -> AssistantContext {
        var titles: [String] = []
        var notes: [String] = []
        var personalizationEnabled = false
        var recencySensitivity = 0.7

        if let database {
            personalizationEnabled = (try? await database.getSetting(key: SettingsKeys.personalizationEnabled)) == "true"
            if let storedSensitivity = try? await database.getSetting(key: SettingsKeys.recencySensitivity),
               let parsed = Double(storedSensitivity) {
                recencySensitivity = min(max(parsed, 0), 1)
            }

            if personalizationEnabled, let profile = try? await database.fetchUserTasteProfile() {
                if !profile.likedGenres.isEmpty {
                    notes.append("Liked genres: \(profile.likedGenres.joined(separator: ", "))")
                }
                if !profile.dislikedGenres.isEmpty {
                    notes.append("Avoid genres: \(profile.dislikedGenres.joined(separator: ", "))")
                }
                if !profile.preferredDecades.isEmpty {
                    let eras = profile.preferredDecades.map(String.init).joined(separator: ", ")
                    notes.append("Preferred eras: \(eras)")
                }
            }

            if let folderId {
                if let folder = try? await database.fetchLibraryFolder(id: folderId) {
                    notes.append("Active folder: \(folder.name)")
                }
                if let media = try? await database.fetchLibraryMedia(folderId: folderId, includeDescendants: true) {
                    titles.append(contentsOf: media.map(\.title))
                }
            }

            if personalizationEnabled, let history = try? await database.fetchAllWatchHistory(limit: 80) {
                let decayWindowDays = 30 + ((1 - recencySensitivity) * 150)
                for entry in history {
                    guard let media = try? await database.fetchMedia(id: entry.mediaId) else { continue }
                    titles.append(media.title)
                    let daysAgo = max(0, Int(Date().timeIntervalSince(entry.lastWatched) / 86_400))
                    let recencyWeight = max(0.1, 1.0 - min(Double(daysAgo) / decayWindowDays, 0.9))
                    let progressPercent = Int((entry.progressPercent * 100).rounded())
                    notes.append(
                        "Watched \(media.title) \(daysAgo)d ago at \(progressPercent)% (recency \(String(format: "%.2f", recencyWeight)))"
                    )
                }
            }

            if personalizationEnabled, let favorites = try? await database.fetchLibrary(listType: .favorites) {
                for entry in favorites {
                    guard let media = try? await database.fetchMedia(id: entry.mediaId) else { continue }
                    titles.append(media.title)
                }
            }

            if personalizationEnabled, let watchlist = try? await database.fetchLibrary(listType: .watchlist) {
                for entry in watchlist {
                    guard let media = try? await database.fetchMedia(id: entry.mediaId) else { continue }
                    titles.append(media.title)
                }
            }

            if personalizationEnabled, let memory = try? await database.fetchAssistantMemoryChunks(scope: "default", limit: 120) {
                let ranked = LocalContextRetriever().retrieve(query: prompt, chunks: memory, limit: 8)
                for chunk in ranked {
                    notes.append(chunk.summary ?? chunk.content)
                }
            }
        }

        if let metadataProvider,
           let trending = try? await metadataProvider.getTrending(type: .movie, timeWindow: .week, page: 1) {
            titles.append(contentsOf: trending.items.prefix(20).map(\.title))
        }

        let uniqueTitles = deduplicated(titles).prefix(maxCandidates).map { $0 }
        let uniqueNotes = deduplicated(notes).prefix(30).map { $0 }
        return AssistantContext(
            candidateTitles: uniqueTitles,
            contextNotes: uniqueNotes,
            personalizationEnabled: personalizationEnabled
        )
    }

    private func deduplicated(_ values: [String]) -> [String] {
        var seen = Set<String>()
        var output: [String] = []
        for raw in values {
            let value = raw.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !value.isEmpty else { continue }
            let key = value.lowercased()
            if seen.insert(key).inserted {
                output.append(value)
            }
        }
        return output
    }
}
