import Foundation
import Observation

@MainActor
@Observable
final class SearchViewModel {
    enum Scope: String, CaseIterable, Identifiable {
        case all
        case discover
        case library
        case watchlist
        case folder

        var id: String { rawValue }

        var displayName: String {
            switch self {
            case .all:
                return "All"
            case .discover:
                return "Discover"
            case .library:
                return "Library"
            case .watchlist:
                return "Watchlist"
            case .folder:
                return "Folder"
            }
        }
    }

    var results: [MediaPreview] = []
    var isSearching = false
    private(set) var lastErrorMessage: String?
    private var searchTask: Task<Void, Never>?

    func clearResults() {
        searchTask?.cancel()
        isSearching = false
        results = []
        lastErrorMessage = nil
    }

    func cancelSearch() {
        searchTask?.cancel()
        isSearching = false
    }

    func startSearch(
        query: String,
        type: MediaType?,
        provider: (any MetadataProvider)?,
        scope: Scope = .all,
        folderId: String? = nil,
        database: DatabaseManager? = nil,
        onError: @escaping @MainActor (String) -> Void
    ) {
        searchTask?.cancel()
        let trimmedQuery = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedQuery.isEmpty else {
            clearResults()
            return
        }

        searchTask = Task { [weak self] in
            await self?.performSearch(
                query: trimmedQuery,
                type: type,
                provider: provider,
                scope: scope,
                folderId: folderId,
                database: database,
                onError: onError
            )
        }
    }

    func scheduleDebouncedSearch(
        query: String,
        type: MediaType?,
        provider: (any MetadataProvider)?,
        scope: Scope = .all,
        folderId: String? = nil,
        database: DatabaseManager? = nil,
        delay: Duration = .milliseconds(400),
        onError: @escaping @MainActor (String) -> Void
    ) {
        searchTask?.cancel()
        let trimmedQuery = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedQuery.isEmpty else {
            clearResults()
            return
        }

        searchTask = Task { [weak self] in
            do {
                try await Task.sleep(for: delay)
            } catch {
                return
            }

            guard !Task.isCancelled else { return }
            await self?.performSearch(
                query: trimmedQuery,
                type: type,
                provider: provider,
                scope: scope,
                folderId: folderId,
                database: database,
                onError: onError
            )
        }
    }

    func performSearch(
        query: String,
        type: MediaType?,
        provider: (any MetadataProvider)?,
        scope: Scope = .all,
        folderId: String? = nil,
        database: DatabaseManager? = nil,
        onError: @escaping @MainActor (String) -> Void
    ) async {
        let trimmedQuery = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedQuery.isEmpty else {
            clearResults()
            return
        }

        isSearching = true
        defer { isSearching = false }

        do {
            let scopedResults: [MediaPreview]
            switch scope {
            case .all, .discover:
                guard let provider else {
                    results = []
                    return
                }
                scopedResults = try await provider.search(query: trimmedQuery, type: type, page: 1).items
            case .library, .watchlist, .folder:
                scopedResults = try await localScopedSearch(
                    query: trimmedQuery,
                    type: type,
                    scope: scope,
                    folderId: folderId,
                    database: database
                )
            }

            guard !Task.isCancelled else { return }
            results = scopedResults
            lastErrorMessage = nil
        } catch {
            guard !Task.isCancelled else { return }
            results = []
            let message = "Search failed: \(error.localizedDescription)"
            lastErrorMessage = message
            onError(message)
        }
    }

    func buildRefinePrompt(query: String, scope: Scope) -> String {
        let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
        return "Refine this search into stronger filters and genres: \"\(trimmed)\". Scope: \(scope.displayName)."
    }

    func buildMoodPrompt(mood: String, scope: Scope) -> String {
        let trimmed = mood.trimmingCharacters(in: .whitespacesAndNewlines)
        return "Find movies and series matching this mood: \(trimmed). Prioritize \(scope.displayName.lowercased()) context."
    }

    func buildSimilarPrompt(selected: MediaPreview?, scope: Scope) -> String {
        guard let selected else {
            return "Suggest similar titles based on my recent searches and \(scope.displayName.lowercased()) context."
        }
        return "Suggest titles similar to \(selected.title) with reasons. Scope: \(scope.displayName)."
    }

    func buildFolderPrompt(folderName: String?) -> String {
        let folder = folderName?.trimmingCharacters(in: .whitespacesAndNewlines)
        if let folder, !folder.isEmpty {
            return "Recommend titles that fit my folder '\(folder)' and explain why each matches."
        }
        return "Recommend titles based on my active folder context."
    }

    func buildProfileMatchPrompt(query: String) -> String {
        "Why does this match my profile: \(query). Use my recent watch dates and taste profile."
    }

    private func localScopedSearch(
        query: String,
        type: MediaType?,
        scope: Scope,
        folderId: String?,
        database: DatabaseManager?
    ) async throws -> [MediaPreview] {
        guard let database else { return [] }

        let local = try await database.searchMedia(query: query, limit: 300)
        let typeFiltered = if let type {
            local.filter { $0.type == type }
        } else {
            local
        }
        let allowedIDs: Set<String>

        switch scope {
        case .library:
            let entries = try await database.fetchLibrary(listType: .favorites)
            allowedIDs = Set(entries.map(\.mediaId))
        case .watchlist:
            let entries = try await database.fetchLibrary(listType: .watchlist)
            allowedIDs = Set(entries.map(\.mediaId))
        case .folder:
            guard let folderId else { return [] }
            let entries = try await database.fetchLibrary(folderId: folderId, includeDescendants: true)
            allowedIDs = Set(entries.map(\.mediaId))
        case .all, .discover:
            allowedIDs = Set(typeFiltered.map(\.id))
        }

        return typeFiltered
            .filter { allowedIDs.contains($0.id) }
            .map(\.toPreview)
    }
}

private extension MediaItem {
    var toPreview: MediaPreview {
        MediaPreview(
            id: id,
            type: type,
            title: title,
            year: year,
            posterPath: posterPath,
            imdbRating: imdbRating,
            tmdbId: tmdbId
        )
    }
}
