import Foundation
import GRDB

/// Hierarchical folder container for user library entries.
struct LibraryFolder: Codable, Sendable, Identifiable, Equatable, FetchableRecord, PersistableRecord {
    static let databaseTableName = "library_folders"

    enum FolderKind: String, Codable, Sendable, CaseIterable {
        case systemRoot = "system_root"
        case manual
        case watched
        case releaseWait = "release_wait"
    }

    var id: String
    var name: String
    var parentId: String?
    var listType: UserLibraryEntry.ListType
    var folderKind: FolderKind
    var isSystem: Bool
    var createdAt: Date
    var updatedAt: Date

    enum Columns: String, ColumnExpression {
        case id, name, parentId, listType, folderKind, isSystem, createdAt, updatedAt
    }

    func encode(to container: inout PersistenceContainer) {
        container[Columns.id] = id
        container[Columns.name] = name
        container[Columns.parentId] = parentId
        container[Columns.listType] = listType.rawValue
        container[Columns.folderKind] = folderKind.rawValue
        container[Columns.isSystem] = isSystem
        container[Columns.createdAt] = createdAt
        container[Columns.updatedAt] = updatedAt
    }

    init(row: Row) throws {
        id = row[Columns.id]
        name = row[Columns.name]
        parentId = row[Columns.parentId]
        listType = UserLibraryEntry.ListType(rawValue: row[Columns.listType] as String) ?? .custom
        isSystem = row[Columns.isSystem]
        let storedKind: String? = row[Columns.folderKind]
        folderKind = storedKind.flatMap(FolderKind.init(rawValue:)) ?? (isSystem ? .systemRoot : .manual)
        createdAt = row[Columns.createdAt]
        updatedAt = row[Columns.updatedAt]
    }

    init(
        id: String,
        name: String,
        parentId: String? = nil,
        listType: UserLibraryEntry.ListType,
        folderKind: FolderKind = .manual,
        isSystem: Bool = false,
        createdAt: Date = Date(),
        updatedAt: Date = Date()
    ) {
        self.id = id
        self.name = name
        self.parentId = parentId
        self.listType = listType
        self.folderKind = folderKind
        self.isSystem = isSystem
        self.createdAt = createdAt
        self.updatedAt = updatedAt
    }

    static func systemFolderID(for listType: UserLibraryEntry.ListType) -> String {
        "system-\(listType.rawValue)"
    }

    static let watchedFolderID = "system-favorites-watched"
    static let releaseWaitFolderID = "system-favorites-release-wait"

    static func behaviorFolderID(for kind: FolderKind) -> String {
        switch kind {
        case .watched:
            return watchedFolderID
        case .releaseWait:
            return releaseWaitFolderID
        case .systemRoot, .manual:
            return systemFolderID(for: .favorites)
        }
    }

    static func behaviorFolderName(for kind: FolderKind) -> String {
        switch kind {
        case .watched:
            return "Watched"
        case .releaseWait:
            return "Release Wait"
        case .systemRoot:
            return "Library"
        case .manual:
            return "Folder"
        }
    }

    static func systemFolderName(for listType: UserLibraryEntry.ListType) -> String {
        switch listType {
        case .watchlist:
            return "Watchlist"
        case .favorites:
            return "Library"
        case .custom:
            return "Custom"
        }
    }
}
