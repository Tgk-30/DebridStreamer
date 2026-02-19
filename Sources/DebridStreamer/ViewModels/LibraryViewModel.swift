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
    var sortOption: SortOption = .recentlyAdded
    var isLoading = false
    var statusMessage: String?

    init(listType: UserLibraryEntry.ListType) {
        self.listType = listType
    }

    func load(database: DatabaseManager, preferredFolderId: String? = nil) async {
        isLoading = true
        defer { isLoading = false }

        do {
            if supportsFolders, let preferredFolderId, !preferredFolderId.isEmpty {
                selectedFolderId = preferredFolderId
            }
            try await refreshFolderTree(database: database)
            try await loadItems(database: database)
            statusMessage = nil
        } catch {
            statusMessage = "Failed to load \(listType.rawValue): \(error.localizedDescription)"
        }
    }

    func refresh(database: DatabaseManager) async {
        await load(database: database)
    }

    func selectFolder(_ folderId: String, database: DatabaseManager) async {
        guard supportsFolders else {
            selectedFolderId = rootFolder?.id
            return
        }
        selectedFolderId = folderId
        do {
            try await refreshFolderTree(database: database)
            try await loadItems(database: database)
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
            try await loadItems(database: database)
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
            try await loadItems(database: database)
            statusMessage = "Folder deleted."
        } catch {
            statusMessage = "Folder delete failed: \(error.localizedDescription)"
        }
    }

    func remove(_ item: MediaCardItem, database: DatabaseManager) async {
        do {
            try await database.removeFromLibrary(id: item.entry.id)
            try await loadItems(database: database)
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

    private func loadItems(database: DatabaseManager) async throws {
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
        items = sorted(next)
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
