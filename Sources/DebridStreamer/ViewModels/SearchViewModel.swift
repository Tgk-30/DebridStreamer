import Foundation
import Observation

@MainActor
@Observable
final class SearchViewModel {
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

    func scheduleDebouncedSearch(
        query: String,
        type: MediaType?,
        provider: (any MetadataProvider)?,
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
                onError: onError
            )
        }
    }

    func performSearch(
        query: String,
        type: MediaType?,
        provider: (any MetadataProvider)?,
        onError: @escaping @MainActor (String) -> Void
    ) async {
        let trimmedQuery = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let provider, !trimmedQuery.isEmpty else {
            clearResults()
            return
        }

        isSearching = true
        defer { isSearching = false }

        do {
            let result = try await provider.search(query: trimmedQuery, type: type, page: 1)
            guard !Task.isCancelled else { return }
            results = result.items
            lastErrorMessage = nil
        } catch {
            guard !Task.isCancelled else { return }
            results = []
            let message = "Search failed: \(error.localizedDescription)"
            lastErrorMessage = message
            onError(message)
        }
    }
}
