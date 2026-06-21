import Foundation

struct IMDbCSVEntry: Sendable, Equatable {
    var imdbID: String?
    var title: String
    var year: Int?
    var listType: UserLibraryEntry.ListType
}

struct IMDbImportResult: Sendable, Equatable {
    var added: Int
    var skippedDuplicates: Int
}

actor IMDbCSVSyncService {
    /// Builds a stable, diacritic/case-insensitive slug from a title for use as a
    /// synthesized media id when no IMDb const is present. Collapses runs of
    /// non-alphanumeric characters to single hyphens and strips diacritics, so the
    /// raw title text never leaks into the id and casing/accents don't fork ids.
    nonisolated func normalizedSlug(_ s: String) -> String {
        s.folding(options: [.diacriticInsensitive, .caseInsensitive], locale: nil)
            .components(separatedBy: CharacterSet.alphanumerics.inverted)
            .filter { !$0.isEmpty }
            .joined(separator: "-")
    }

    nonisolated func parseCSV(_ contents: String, listType: UserLibraryEntry.ListType) -> [IMDbCSVEntry] {
        let rows = CSVParser.parse(contents: contents)
        guard let header = rows.first else { return [] }
        let headerIndex = Dictionary(uniqueKeysWithValues: header.enumerated().map { ($1.lowercased(), $0) })

        let idxConst = headerIndex["const"]
        let idxTitle = headerIndex["title"]
        let idxYear = headerIndex["year"]

        return rows.dropFirst().compactMap { row in
            guard let idxTitle, idxTitle < row.count else { return nil }
            let title = row[idxTitle].trimmingCharacters(in: .whitespacesAndNewlines)
            guard !title.isEmpty else { return nil }

            var imdbID: String?
            if let idxConst, idxConst < row.count {
                let value = row[idxConst].trimmingCharacters(in: .whitespacesAndNewlines)
                imdbID = value.isEmpty ? nil : value
            }

            var year: Int?
            if let idxYear, idxYear < row.count {
                year = Int(row[idxYear].trimmingCharacters(in: .whitespacesAndNewlines))
            }

            return IMDbCSVEntry(imdbID: imdbID, title: title, year: year, listType: listType)
        }
    }

    func importCSV(
        _ contents: String,
        listType: UserLibraryEntry.ListType,
        folderId: String,
        database: DatabaseManager
    ) async throws -> IMDbImportResult {
        let entries = parseCSV(contents, listType: listType)
        var added = 0
        var skipped = 0

        // Pre-compute the synthesized media id for every row once, so the bulk reads
        // below and the per-row inserts agree on a single id per entry.
        let mediaIDs = entries.map { entry in
            entry.imdbID ?? "imdb-\(normalizedSlug(entry.title))-\(entry.year ?? 0)"
        }

        // Bulk read: which of these media already exist in the cache. Replaces the
        // per-row fetchMedia(id:) round-trips with one batched query.
        let uniqueIDs = Array(Set(mediaIDs))
        let existingMedia = try await database.fetchMedia(ids: uniqueIDs)

        // Track media inserted earlier in this same import so we don't re-save them,
        // mirroring the original per-row "fetchMedia == nil" guard within the batch.
        var savedMediaIDs = Set(existingMedia.keys)

        for (index, entry) in entries.enumerated() {
            let mediaID = mediaIDs[index]
            let libraryID = "\(mediaID)-\(folderId)"

            // Preserve the original dedup semantics exactly: check against the raw
            // folderId per row (same as the previous isInLibrary(mediaId:folderId:)).
            let exists = try await database.isInLibrary(mediaId: mediaID, folderId: folderId)
            if exists {
                skipped += 1
                continue
            }

            if !savedMediaIDs.contains(mediaID) {
                let media = MediaItem(
                    id: mediaID,
                    type: .movie,
                    title: entry.title,
                    year: entry.year,
                    lastFetched: Date()
                )
                try await database.saveMedia(media)
                savedMediaIDs.insert(mediaID)
            }

            let libraryEntry = UserLibraryEntry(
                id: libraryID,
                mediaId: mediaID,
                folderId: folderId,
                listType: listType,
                addedAt: Date()
            )
            try await database.addToLibrary(libraryEntry)
            added += 1
        }

        return IMDbImportResult(added: added, skippedDuplicates: skipped)
    }

    func importCSV(
        _ contents: String,
        listType: UserLibraryEntry.ListType,
        database: DatabaseManager
    ) async throws -> IMDbImportResult {
        let folderId = try await database.fetchSystemLibraryFolderID(listType: listType)
        return try await importCSV(
            contents,
            listType: listType,
            folderId: folderId,
            database: database
        )
    }

    nonisolated func exportCSV(mediaItems: [MediaItem]) -> String {
        var rows: [[String]] = [["Const", "Title", "Year"]]
        rows.append(contentsOf: mediaItems.map { item in
            [item.id, item.title, item.year.map(String.init) ?? ""]
        })
        return CSVParser.serialize(rows: rows)
    }

    func exportCSV(
        database: DatabaseManager,
        folderId: String,
        includeDescendants: Bool = true
    ) async throws -> String {
        let mediaItems = try await database.fetchLibraryMedia(
            folderId: folderId,
            includeDescendants: includeDescendants
        )
        return exportCSV(mediaItems: mediaItems)
    }

    func exportCSVAllFolders(
        database: DatabaseManager,
        rootFolderId: String? = nil
    ) async throws -> String {
        let mediaItems = try await database.fetchLibraryMediaInFolderTree(rootFolderId: rootFolderId)
        return exportCSV(mediaItems: mediaItems)
    }
}

private enum CSVParser {
    static func parse(contents: String) -> [[String]] {
        var rows: [[String]] = []
        var row: [String] = []
        var cell = ""
        var inQuotes = false

        let chars = Array(contents)
        var i = 0
        while i < chars.count {
            let ch = chars[i]
            if ch == "\"" {
                if inQuotes, i + 1 < chars.count, chars[i + 1] == "\"" {
                    cell.append("\"")
                    i += 1
                } else {
                    inQuotes.toggle()
                }
            } else if ch == "," && !inQuotes {
                row.append(cell)
                cell = ""
            } else if (ch == "\n" || ch == "\r") && !inQuotes {
                if ch == "\r", i + 1 < chars.count, chars[i + 1] == "\n" {
                    i += 1
                }
                row.append(cell)
                if !row.allSatisfy({ $0.isEmpty }) {
                    rows.append(row)
                }
                row = []
                cell = ""
            } else {
                cell.append(ch)
            }
            i += 1
        }

        if !cell.isEmpty || !row.isEmpty {
            row.append(cell)
            if !row.allSatisfy({ $0.isEmpty }) {
                rows.append(row)
            }
        }

        return rows
    }

    static func serialize(rows: [[String]]) -> String {
        rows.map { row in
            row.map(escape).joined(separator: ",")
        }.joined(separator: "\n")
    }

    private static func escape(_ value: String) -> String {
        if value.contains(",") || value.contains("\"") || value.contains("\n") {
            return "\"\(value.replacingOccurrences(of: "\"", with: "\"\""))\""
        }
        return value
    }
}
