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
        var activeFolderMediaIDs = Set<String>()

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
                    activeFolderMediaIDs.formUnion(media.map(\.id))
                    notes.append("Active folder boost applied to \(media.count) titles.")
                }
            }

            if let libraryRootID = try? await database.fetchSystemLibraryFolderID(listType: .favorites) {
                if let allLibraryMedia = try? await database.fetchLibraryMediaInFolderTree(rootFolderId: libraryRootID) {
                    titles.append(contentsOf: allLibraryMedia.map(\.title))
                    notes.append("Library context includes \(allLibraryMedia.count) titles.")
                }
                if let folders = try? await database.fetchAllLibraryFolders(listType: .favorites) {
                    let topLevel = folders
                        .filter { !$0.isSystem && $0.parentId == libraryRootID }
                        .map(\.name)
                    if !topLevel.isEmpty {
                        notes.append("Top library folders: \(topLevel.joined(separator: ", "))")
                    }
                }
            }

            if let watchedFolder = try? await database.fetchFolderByKind(listType: .favorites, kind: .watched),
               let watchedMedia = try? await database.fetchLibraryMedia(folderId: watchedFolder.id, includeDescendants: true),
               !watchedMedia.isEmpty {
                titles.append(contentsOf: watchedMedia.map(\.title))
                notes.append("Watched folder has \(watchedMedia.count) titles.")
            }

            if let releaseWaitFolder = try? await database.fetchFolderByKind(listType: .favorites, kind: .releaseWait),
               let releaseWaitEntries = try? await database.fetchLibrary(folderId: releaseWaitFolder.id, includeDescendants: true),
               !releaseWaitEntries.isEmpty {
                notes.append("Release Wait has \(releaseWaitEntries.count) series being tracked.")
                for entry in releaseWaitEntries.prefix(8) {
                    if let media = try? await database.fetchMedia(id: entry.mediaId) {
                        titles.append(media.title)
                        var detail = "Release wait: \(media.title)"
                        if let releaseDateHint = entry.releaseDateHint {
                            detail += " (next: \(releaseDateHint))"
                        }
                        if let renewalStatus = entry.renewalStatus {
                            detail += " [\(renewalStatus)]"
                        }
                        notes.append(detail)
                    }
                }
            }

            if let watchlistRootID = try? await database.fetchSystemLibraryFolderID(listType: .watchlist),
               let watchlistMedia = try? await database.fetchLibraryMediaInFolderTree(rootFolderId: watchlistRootID) {
                titles.append(contentsOf: watchlistMedia.map(\.title))
                notes.append("Watchlist context includes \(watchlistMedia.count) titles.")
            }

            if personalizationEnabled, let tasteEvents = try? await database.fetchTasteEvents(limit: 140), !tasteEvents.isEmpty {
                let decayWindowDays = 30 + ((1 - recencySensitivity) * 150)
                let mediaByID = (try? await database.fetchMedia(
                    ids: tasteEvents.compactMap(\.mediaId)
                )) ?? [:]

                for event in tasteEvents.prefix(40) {
                    let daysAgo = max(0, Int(Date().timeIntervalSince(event.createdAt) / 86_400))
                    let recencyWeight = max(0.1, 1.0 - min(Double(daysAgo) / decayWindowDays, 0.9))
                    let title = event.mediaId.flatMap { mediaByID[$0]?.title } ?? event.metadata["title"] ?? "Unknown title"
                    let feedback = event.feedbackValue.map { String(format: "%.0f", $0) } ?? "-"
                    if let watchedState = event.watchedState {
                        notes.append(
                            "Feedback \(title): \(watchedState.rawValue) (\(event.feedbackScale?.displayName ?? "none")=\(feedback)) \(daysAgo)d ago (recency \(String(format: "%.2f", recencyWeight)))."
                        )
                    } else if event.eventType == .liked || event.eventType == .disliked {
                        notes.append(
                            "Preference \(title): \(event.eventType.rawValue) \(daysAgo)d ago (recency \(String(format: "%.2f", recencyWeight)))."
                        )
                    }
                }
            }

            if let history = try? await database.fetchAllWatchHistory(limit: 80) {
                let mediaIDs = history.map(\.mediaId)
                let mediaByID = (try? await database.fetchMedia(ids: mediaIDs)) ?? [:]
                let decayWindowDays = 30 + ((1 - recencySensitivity) * 150)
                for entry in history {
                    guard let media = mediaByID[entry.mediaId] else { continue }
                    titles.append(media.title)
                    let daysAgo = max(0, Int(Date().timeIntervalSince(entry.lastWatched) / 86_400))
                    let recencyWeight = max(0.1, 1.0 - min(Double(daysAgo) / decayWindowDays, 0.9))
                    let folderBoost = activeFolderMediaIDs.contains(entry.mediaId) ? 1.25 : 1.0
                    let weightedRecency = min(1.0, recencyWeight * folderBoost)
                    let progressPercent = Int((entry.progressPercent * 100).rounded())
                    notes.append(
                        "Watched \(media.title) \(daysAgo)d ago at \(progressPercent)% (recency \(String(format: "%.2f", weightedRecency)))"
                    )
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

        let uniqueTitles = Array(deduplicated(titles).prefix(maxCandidates))
        let uniqueNotes = Array(deduplicated(notes).prefix(30))
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
