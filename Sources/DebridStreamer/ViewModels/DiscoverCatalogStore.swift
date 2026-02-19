import Foundation
import Observation

@MainActor
@Observable
final class DiscoverCatalogStore {
    var trendingMovies: [MediaPreview] = []
    var trendingShows: [MediaPreview] = []
    var popularMovies: [MediaPreview] = []
    var topRatedMovies: [MediaPreview] = []
    var continueWatching: [MediaPreview] = []
    var isLoading = false
    private(set) var isLoaded = false
    private(set) var lastErrorMessage: String?

    func reset() {
        trendingMovies = []
        trendingShows = []
        popularMovies = []
        topRatedMovies = []
        continueWatching = []
        isLoading = false
        isLoaded = false
        lastErrorMessage = nil
    }

    func preloadIfNeeded(
        provider: (any MetadataProvider)?,
        database: DatabaseManager?,
        onError: @escaping @MainActor (String) -> Void
    ) async {
        guard !isLoaded else { return }
        await load(
            provider: provider,
            database: database,
            forceRefresh: false,
            onError: onError
        )
    }

    func load(
        provider: (any MetadataProvider)?,
        database: DatabaseManager?,
        forceRefresh: Bool,
        onError: @escaping @MainActor (String) -> Void
    ) async {
        if isLoading { return }
        if isLoaded && !forceRefresh { return }

        isLoading = true
        defer { isLoading = false }

        await loadContinueWatching(database: database)

        guard let provider else {
            isLoaded = false
            return
        }

        async let trendingMoviesResponse = provider.getTrending(type: .movie, timeWindow: .week, page: 1)
        async let trendingShowsResponse = provider.getTrending(type: .series, timeWindow: .week, page: 1)
        async let popularMoviesResponse = provider.getCategory(.popular, type: .movie, page: 1)
        async let topRatedMoviesResponse = provider.getCategory(.topRated, type: .movie, page: 1)

        var errors: [String] = []

        do {
            trendingMovies = try await trendingMoviesResponse.items
        } catch {
            trendingMovies = []
            errors.append("Trending movies failed: \(error.localizedDescription)")
        }

        do {
            trendingShows = try await trendingShowsResponse.items
        } catch {
            trendingShows = []
            errors.append("Trending TV failed: \(error.localizedDescription)")
        }

        do {
            popularMovies = try await popularMoviesResponse.items
        } catch {
            popularMovies = []
            errors.append("Popular movies failed: \(error.localizedDescription)")
        }

        do {
            topRatedMovies = try await topRatedMoviesResponse.items
        } catch {
            topRatedMovies = []
            errors.append("Top rated movies failed: \(error.localizedDescription)")
        }

        if !errors.isEmpty {
            let message = errors.joined(separator: " ")
            lastErrorMessage = message
            onError(message)
        } else {
            lastErrorMessage = nil
        }

        isLoaded = true
    }

    private func loadContinueWatching(database: DatabaseManager?) async {
        guard let database else {
            continueWatching = []
            return
        }

        do {
            let history = try await database.fetchRecentWatchHistory(limit: 20)
            var previews: [MediaPreview] = []
            for entry in history {
                guard let media = try await database.fetchMedia(id: entry.mediaId) else { continue }
                previews.append(media.toPreview())
            }
            continueWatching = uniqueByID(previews)
        } catch {
            continueWatching = []
        }
    }

    private func uniqueByID(_ items: [MediaPreview]) -> [MediaPreview] {
        var seen = Set<String>()
        var result: [MediaPreview] = []
        for item in items where seen.insert(item.id).inserted {
            result.append(item)
        }
        return result
    }
}

private extension MediaItem {
    func toPreview() -> MediaPreview {
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
