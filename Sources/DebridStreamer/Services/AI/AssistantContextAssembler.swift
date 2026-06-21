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
            // These two settings gate / parameterize the other reads, so fetch
            // them first (both cheap key/value lookups).
            personalizationEnabled = (try? await database.getSetting(key: SettingsKeys.personalizationEnabled)) == "true"
            if let storedSensitivity = try? await database.getSetting(key: SettingsKeys.recencySensitivity),
               let parsed = Double(storedSensitivity) {
                recencySensitivity = min(max(parsed, 0), 1)
            }
            let personalization = personalizationEnabled

            // The following reads are mutually independent. Fire them concurrently
            // (GRDB reads are safe to run in parallel against the pool) and then
            // merge the results into titles/notes in a FIXED order below so the
            // deduplicated output is deterministic and stable for tests.
            async let tasteProfileResult: UserTasteProfile? =
                personalization ? (try? await database.fetchUserTasteProfile()) : nil

            async let activeFolderResult: (name: String?, media: [MediaItem])? = {
                guard let folderId else { return nil }
                async let folder = try? await database.fetchLibraryFolder(id: folderId)
                async let media = try? await database.fetchLibraryMedia(folderId: folderId, includeDescendants: true)
                return (name: await folder?.name, media: (await media) ?? [])
            }()

            async let libraryTreeResult: (media: [MediaItem], topFolders: [String])? = {
                guard let libraryRootID = try? await database.fetchSystemLibraryFolderID(listType: .favorites) else {
                    return nil
                }
                async let media = try? await database.fetchLibraryMediaInFolderTree(rootFolderId: libraryRootID)
                async let folders = try? await database.fetchAllLibraryFolders(listType: .favorites)
                let topLevel = ((await folders) ?? [])
                    .filter { !$0.isSystem && $0.parentId == libraryRootID }
                    .map(\.name)
                return (media: (await media) ?? [], topFolders: topLevel)
            }()

            async let watchedMediaResult: [MediaItem] = {
                guard let watchedFolder = try? await database.fetchFolderByKind(listType: .favorites, kind: .watched),
                      let watchedMedia = try? await database.fetchLibraryMedia(folderId: watchedFolder.id, includeDescendants: true)
                else { return [] }
                return watchedMedia
            }()

            async let releaseWaitResult: (count: Int, items: [(media: MediaItem, releaseDateHint: String?, renewalStatus: String?)])? = {
                guard let releaseWaitFolder = try? await database.fetchFolderByKind(listType: .favorites, kind: .releaseWait),
                      let releaseWaitEntries = try? await database.fetchLibrary(folderId: releaseWaitFolder.id, includeDescendants: true),
                      !releaseWaitEntries.isEmpty
                else { return nil }
                let entries = Array(releaseWaitEntries.prefix(8))
                // Bulk fetch instead of N+1 single-id lookups.
                let mediaByID = (try? await database.fetchMedia(ids: entries.map(\.mediaId))) ?? [:]
                let items = entries.compactMap { entry -> (media: MediaItem, releaseDateHint: String?, renewalStatus: String?)? in
                    guard let media = mediaByID[entry.mediaId] else { return nil }
                    return (media: media, releaseDateHint: entry.releaseDateHint, renewalStatus: entry.renewalStatus)
                }
                return (count: releaseWaitEntries.count, items: items)
            }()

            async let watchlistMediaResult: [MediaItem] = {
                guard let watchlistRootID = try? await database.fetchSystemLibraryFolderID(listType: .watchlist),
                      let watchlistMedia = try? await database.fetchLibraryMediaInFolderTree(rootFolderId: watchlistRootID)
                else { return [] }
                return watchlistMedia
            }()

            async let tasteEventsResult: (events: [TasteEvent], mediaByID: [String: MediaItem])? = {
                guard personalization,
                      let tasteEvents = try? await database.fetchTasteEvents(limit: 140),
                      !tasteEvents.isEmpty
                else { return nil }
                let mediaByID = (try? await database.fetchMedia(ids: tasteEvents.compactMap(\.mediaId))) ?? [:]
                return (events: tasteEvents, mediaByID: mediaByID)
            }()

            async let historyResult: (history: [WatchHistory], mediaByID: [String: MediaItem])? = {
                guard let history = try? await database.fetchAllWatchHistory(limit: 80) else { return nil }
                let mediaByID = (try? await database.fetchMedia(ids: history.map(\.mediaId))) ?? [:]
                return (history: history, mediaByID: mediaByID)
            }()

            async let memoryResult: [AssistantMemoryChunk] =
                personalization ? ((try? await database.fetchAssistantMemoryChunks(scope: "default", limit: 120)) ?? []) : []

            // --- Merge in a fixed, deterministic order (matches prior sequence) ---

            if personalization, let profile = await tasteProfileResult {
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

            if let activeFolder = await activeFolderResult {
                if let name = activeFolder.name {
                    notes.append("Active folder: \(name)")
                }
                titles.append(contentsOf: activeFolder.media.map(\.title))
                activeFolderMediaIDs.formUnion(activeFolder.media.map(\.id))
                notes.append("Active folder boost applied to \(activeFolder.media.count) titles.")
            }

            if let libraryTree = await libraryTreeResult {
                titles.append(contentsOf: libraryTree.media.map(\.title))
                notes.append("Library context includes \(libraryTree.media.count) titles.")
                if !libraryTree.topFolders.isEmpty {
                    notes.append("Top library folders: \(libraryTree.topFolders.joined(separator: ", "))")
                }
            }

            let watchedMedia = await watchedMediaResult
            if !watchedMedia.isEmpty {
                titles.append(contentsOf: watchedMedia.map(\.title))
                notes.append("Watched folder has \(watchedMedia.count) titles.")
            }

            if let releaseWait = await releaseWaitResult {
                notes.append("Release Wait has \(releaseWait.count) series being tracked.")
                for item in releaseWait.items {
                    titles.append(item.media.title)
                    var detail = "Release wait: \(item.media.title)"
                    if let releaseDateHint = item.releaseDateHint {
                        detail += " (next: \(releaseDateHint))"
                    }
                    if let renewalStatus = item.renewalStatus {
                        detail += " [\(renewalStatus)]"
                    }
                    notes.append(detail)
                }
            }

            let watchlistMedia = await watchlistMediaResult
            if !watchlistMedia.isEmpty {
                titles.append(contentsOf: watchlistMedia.map(\.title))
                notes.append("Watchlist context includes \(watchlistMedia.count) titles.")
            }

            if let tasteEventsData = await tasteEventsResult {
                let decayWindowDays = 30 + ((1 - recencySensitivity) * 150)
                let mediaByID = tasteEventsData.mediaByID
                for event in tasteEventsData.events.prefix(40) {
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

            if let historyData = await historyResult {
                let mediaByID = historyData.mediaByID
                let decayWindowDays = 30 + ((1 - recencySensitivity) * 150)
                for entry in historyData.history {
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

            let memory = await memoryResult
            if personalization, !memory.isEmpty {
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
