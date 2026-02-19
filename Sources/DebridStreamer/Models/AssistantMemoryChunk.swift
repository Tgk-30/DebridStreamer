import Foundation
import GRDB

/// Long-term assistant memory chunk used for retrieval-augmented prompts.
struct AssistantMemoryChunk: Codable, Sendable, Identifiable, Equatable, FetchableRecord, PersistableRecord {
    static let databaseTableName = "assistant_memory_chunks"

    var id: String
    var scope: String
    var content: String
    var summary: String?
    var tags: [String]
    var importance: Double
    var createdAt: Date
    var lastAccessedAt: Date?

    enum Columns: String, ColumnExpression {
        case id, scope, content, summary, tags, importance, createdAt, lastAccessedAt
    }

    func encode(to container: inout PersistenceContainer) {
        container[Columns.id] = id
        container[Columns.scope] = scope
        container[Columns.content] = content
        container[Columns.summary] = summary
        container[Columns.tags] = try? JSONEncoder().encode(tags)
        container[Columns.importance] = importance
        container[Columns.createdAt] = createdAt
        container[Columns.lastAccessedAt] = lastAccessedAt
    }

    init(row: Row) throws {
        id = row[Columns.id]
        scope = row[Columns.scope]
        content = row[Columns.content]
        summary = row[Columns.summary]
        if let tagsData = row[Columns.tags] as Data? {
            tags = (try? JSONDecoder().decode([String].self, from: tagsData)) ?? []
        } else {
            tags = []
        }
        importance = row[Columns.importance] ?? 0
        createdAt = row[Columns.createdAt]
        lastAccessedAt = row[Columns.lastAccessedAt]
    }

    init(
        id: String,
        scope: String = "default",
        content: String,
        summary: String? = nil,
        tags: [String] = [],
        importance: Double = 0,
        createdAt: Date = Date(),
        lastAccessedAt: Date? = nil
    ) {
        self.id = id
        self.scope = scope
        self.content = content
        self.summary = summary
        self.tags = tags
        self.importance = importance
        self.createdAt = createdAt
        self.lastAccessedAt = lastAccessedAt
    }
}
