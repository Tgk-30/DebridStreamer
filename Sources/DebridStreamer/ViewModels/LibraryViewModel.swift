import Foundation
import Observation

@MainActor
@Observable
final class LibraryViewModel {
    enum SortOption: String, CaseIterable, Identifiable {
        case recentlyAdded
        case recentlyWatched
        case rating
        case year

        var id: String { rawValue }

        var displayName: String {
            switch self {
            case .recentlyAdded:
                return "Recently Added"
            case .recentlyWatched:
                return "Recently Watched"
            case .rating:
                return "Rating"
            case .year:
                return "Year"
            }
        }
    }

    struct FolderNode: Identifiable, Equatable {
        var folder: LibraryFolder
        var children: [FolderNode]
        var id: String { folder.id }
        var displayChildren: [FolderNode]? {
            children.isEmpty ? nil : children
        }
    }

    struct MediaCardItem: Identifiable, Equatable {
        var entry: UserLibraryEntry
        var media: MediaItem
        var history: WatchHistory?
        var id: String { entry.id }
    }

    let listType: UserLibraryEntry.ListType
    var supportsFolders: Bool { listType.supportsFolders }

    var rootFolder: LibraryFolder?
    var selectedFolderId: String?
    var folderTree: [FolderNode] = []
    var breadcrumbs: [LibraryFolder] = []
    var items: [MediaCardItem] = []
    var folderBadgeCounts: [String: Int] = [:]
    var sortOption: SortOption = .recentlyAdded
    var isLoading = false
    var statusMessage: String?

    init(listType: UserLibraryEntry.ListType) {
        self.listType = listType
    }

    func load(
        database: DatabaseManager,
        preferredFolderId: String? = nil,
        metadataProvider: (any MetadataProvider)? = nil
    ) async {
        isLoading = true
        defer { isLoading = false }

        do {
            if supportsFolders, let preferredFolderId, !preferredFolderId.isEmpty {
                selectedFolderId = preferredFolderId
            }
            try await refreshFolderTree(database: database)
            try await loadItems(database: database, metadataProvider: metadataProvider)
            statusMessage = nil
        } catch {
            statusMessage = "Failed to load \(listType.rawValue): \(error.localizedDescription)"
        }
    }

    func refresh(database: DatabaseManager, metadataProvider: (any MetadataProvider)? = nil) async {
        await load(database: database, metadataProvider: metadataProvider)
    }

    func selectFolder(
        _ folderId: String,
        database: DatabaseManager,
        metadataProvider: (any MetadataProvider)? = nil
    ) async {
        guard supportsFolders else {
            selectedFolderId = rootFolder?.id
            return
        }
        selectedFolderId = folderId
        do {
            try await refreshFolderTree(database: database)
            try await loadItems(database: database, metadataProvider: metadataProvider)
            statusMessage = nil
        } catch {
            statusMessage = "Failed to open folder: \(error.localizedDescription)"
        }
    }

    func createFolder(
        name: String,
        parentId: String?,
        database: DatabaseManager
    ) async {
        guard supportsFolders else {
            statusMessage = "Watchlist does not support folders."
            return
        }
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            statusMessage = "Folder name is required."
            return
        }

        do {
            let folder = try await database.createLibraryFolder(
                name: trimmed,
                listType: listType,
                parentId: parentId ?? selectedFolderId
            )
            selectedFolderId = folder.id
            try await refreshFolderTree(database: database)
            try await loadItems(database: database, metadataProvider: nil)
            statusMessage = "Created folder \"\(folder.name)\"."
        } catch {
            statusMessage = "Folder create failed: \(error.localizedDescription)"
        }
    }

    func renameFolder(id: String, name: String, database: DatabaseManager) async {
        guard supportsFolders else {
            statusMessage = "Watchlist does not support folders."
            return
        }
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            statusMessage = "Folder name is required."
            return
        }

        do {
            try await database.renameLibraryFolder(id: id, name: trimmed)
            try await refreshFolderTree(database: database)
            statusMessage = "Folder renamed."
        } catch {
            statusMessage = "Folder rename failed: \(error.localizedDescription)"
        }
    }

    func deleteFolder(id: String, database: DatabaseManager) async {
        guard supportsFolders else {
            statusMessage = "Watchlist does not support folders."
            return
        }
        do {
            try await database.deleteLibraryFolder(id: id)
            if selectedFolderId == id {
                selectedFolderId = rootFolder?.id
            }
            try await refreshFolderTree(database: database)
            try await loadItems(database: database, metadataProvider: nil)
            statusMessage = "Folder deleted."
        } catch {
            statusMessage = "Folder delete failed: \(error.localizedDescription)"
        }
    }

    func remove(_ item: MediaCardItem, database: DatabaseManager) async {
        do {
            try await database.removeFromLibrary(id: item.entry.id)
            try await loadItems(database: database, metadataProvider: nil)
            statusMessage = "Removed \(item.media.title)."
        } catch {
            statusMessage = "Remove failed: \(error.localizedDescription)"
        }
    }

    func folder(for folderId: String) -> LibraryFolder? {
        flatFolders.first { $0.id == folderId }
    }

    private var flatFolders: [LibraryFolder] = []

    private func refreshFolderTree(database: DatabaseManager) async throws {
        let root = try await database.fetchSystemLibraryFolder(listType: listType)
        let folders: [LibraryFolder]
        if supportsFolders {
            folders = try await database.fetchAllLibraryFolders(listType: listType)
        } else {
            folders = [root]
        }

        rootFolder = root
        flatFolders = folders
        folderBadgeCounts = Dictionary(
            grouping: try await database.fetchLibrary(listType: listType),
            by: { $0.folderId ?? root.id }
        ).mapValues(\.count)

        if selectedFolderId == nil || folders.contains(where: { $0.id == selectedFolderId }) == false {
            selectedFolderId = root.id
        }

        var byID: [String: LibraryFolder] = [:]
        var childrenByParent: [String?: [LibraryFolder]] = [:]
        for folder in folders {
            byID[folder.id] = folder
            childrenByParent[folder.parentId, default: []].append(folder)
        }
        for key in childrenByParent.keys {
            childrenByParent[key]?.sort {
                if $0.isSystem != $1.isSystem {
                    return $0.isSystem && !$1.isSystem
                }
                return $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending
            }
        }

        func buildNode(_ folder: LibraryFolder) -> FolderNode {
            let children = (childrenByParent[folder.id] ?? []).map(buildNode)
            return FolderNode(folder: folder, children: children)
        }
        if supportsFolders {
            folderTree = (childrenByParent[root.id] ?? []).map(buildNode)
        } else {
            folderTree = [buildNode(root)]
        }

        if let selectedFolderId {
            breadcrumbs = breadcrumbsFor(folderId: selectedFolderId, byID: byID)
        } else {
            breadcrumbs = [root]
        }
    }

    func isLibraryRootSelected() -> Bool {
        selectedFolderId == rootFolder?.id
    }

    func badgeCount(for folderId: String) -> Int {
        folderBadgeCounts[folderId] ?? 0
    }

    private func breadcrumbsFor(folderId: String, byID: [String: LibraryFolder]) -> [LibraryFolder] {
        var result: [LibraryFolder] = []
        var cursor: LibraryFolder? = byID[folderId]
        var visited = Set<String>()
        while let folder = cursor, visited.insert(folder.id).inserted {
            result.append(folder)
            if let parentId = folder.parentId {
                cursor = byID[parentId]
            } else {
                cursor = nil
            }
        }
        return result.reversed()
    }

    private func loadItems(
        database: DatabaseManager,
        metadataProvider: (any MetadataProvider)?
    ) async throws {
        guard let selectedFolderId else {
            items = []
            return
        }

        let entries = try await database.fetchLibrary(
            folderId: selectedFolderId,
            includeDescendants: supportsFolders
        )
        var next: [MediaCardItem] = []
        for entry in entries {
            guard let media = try await database.fetchMedia(id: entry.mediaId) else { continue }
            let history = try await database.fetchWatchHistory(mediaId: entry.mediaId)
            next.append(MediaCardItem(entry: entry, media: media, history: history))
        }
        let enriched = await enrichMissingArtwork(
            in: next,
            database: database,
            metadataProvider: metadataProvider
        )
        items = sorted(enriched)
    }

    private func enrichMissingArtwork(
        in values: [MediaCardItem],
        database: DatabaseManager,
        metadataProvider: (any MetadataProvider)?
    ) async -> [MediaCardItem] {
        guard let metadataProvider else { return values }
        guard !values.isEmpty else { return values }

        var output = values
        let missingIndices = output.indices.filter { output[$0].media.posterPath == nil }
        guard !missingIndices.isEmpty else { return output }

        for index in missingIndices.prefix(24) {
            let item = output[index]
            let query = item.media.title.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !query.isEmpty else { continue }
            guard let preview = await bestPreview(
                for: item.media,
                provider: metadataProvider
            ) else { continue }

            var media = item.media
            media.posterPath = preview.posterPath ?? media.posterPath
            media.backdropPath = media.backdropPath ?? preview.posterPath
            media.tmdbId = media.tmdbId ?? preview.tmdbId
            if media.year == nil {
                media.year = preview.year
            }
            media.lastFetched = Date()
            output[index] = MediaCardItem(entry: item.entry, media: media, history: item.history)
            try? await database.saveMedia(media)
        }

        return output
    }

    private func bestPreview(
        for media: MediaItem,
        provider: any MetadataProvider
    ) async -> MediaPreview? {
        let query = media.title.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !query.isEmpty else { return nil }

        var items = (try? await provider.search(
            query: query,
            type: media.type,
            page: 1
        ).items) ?? []

        let shouldUseBroadSearch = items.isEmpty || items.allSatisfy { $0.posterPath == nil }
        if shouldUseBroadSearch {
            let broadItems = (try? await provider.search(
                query: query,
                type: nil,
                page: 1
            ).items) ?? []
            for candidate in broadItems where items.contains(where: { $0.id == candidate.id }) == false {
                items.append(candidate)
            }
        }

        guard !items.isEmpty else { return nil }
        if let year = media.year,
           let exact = items.first(where: { $0.year == year && $0.posterPath != nil }) {
            return exact
        }
        if let titled = items.first(where: { normalizedTitle($0.title) == normalizedTitle(media.title) && $0.posterPath != nil }) {
            return titled
        }
        return items.first(where: { $0.posterPath != nil }) ?? items.first
    }

    private func normalizedTitle(_ value: String) -> String {
        value
            .folding(options: [.diacriticInsensitive, .caseInsensitive], locale: .current)
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .lowercased()
    }

    private func sorted(_ values: [MediaCardItem]) -> [MediaCardItem] {
        switch sortOption {
        case .recentlyAdded:
            return values.sorted { $0.entry.addedAt > $1.entry.addedAt }
        case .recentlyWatched:
            return values.sorted { lhs, rhs in
                let left = lhs.history?.lastWatched ?? .distantPast
                let right = rhs.history?.lastWatched ?? .distantPast
                return left > right
            }
        case .rating:
            return values.sorted { ($0.media.imdbRating ?? 0) > ($1.media.imdbRating ?? 0) }
        case .year:
            return values.sorted { ($0.media.year ?? 0) > ($1.media.year ?? 0) }
        }
    }
}
