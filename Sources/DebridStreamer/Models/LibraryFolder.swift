import Foundation
import GRDB

/// Hierarchical folder container for user library entries.
struct LibraryFolder: Codable, Sendable, Identifiable, Equatable, FetchableRecord, PersistableRecord {
    static let databaseTableName = "library_folders"

    var id: String
    var name: String
    var parentId: String?
    var listType: UserLibraryEntry.ListType
    var isSystem: Bool
    var createdAt: Date
    var updatedAt: Date

    enum Columns: String, ColumnExpression {
        case id, name, parentId, listType, isSystem, createdAt, updatedAt
    }

    func encode(to container: inout PersistenceContainer) {
        container[Columns.id] = id
        container[Columns.name] = name
        container[Columns.parentId] = parentId
        container[Columns.listType] = listType.rawValue
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
        createdAt = row[Columns.createdAt]
        updatedAt = row[Columns.updatedAt]
    }

    init(
        id: String,
        name: String,
        parentId: String? = nil,
        listType: UserLibraryEntry.ListType,
        isSystem: Bool = false,
        createdAt: Date = Date(),
        updatedAt: Date = Date()
    ) {
        self.id = id
        self.name = name
        self.parentId = parentId
        self.listType = listType
        self.isSystem = isSystem
        self.createdAt = createdAt
        self.updatedAt = updatedAt
    }

    static func systemFolderID(for listType: UserLibraryEntry.ListType) -> String {
        "system-\(listType.rawValue)"
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
