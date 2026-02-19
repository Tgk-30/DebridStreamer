import Foundation
import Observation

@MainActor
@Observable
final class DiscoverViewModel {
    var trendingMovies: [MediaPreview] = []
    var trendingShows: [MediaPreview] = []
    var popularMovies: [MediaPreview] = []
    var topRatedMovies: [MediaPreview] = []
    var isLoading = false
    private(set) var lastErrorMessage: String?

    var hasLoadedContent: Bool {
        !trendingMovies.isEmpty || !trendingShows.isEmpty || !popularMovies.isEmpty || !topRatedMovies.isEmpty
    }

    func loadContentIfNeeded(
        provider: (any MetadataProvider)?,
        onError: @escaping @MainActor (String) -> Void
    ) async {
        guard !hasLoadedContent else { return }
        await loadContent(provider: provider, onError: onError)
    }

    func loadContent(
        provider: (any MetadataProvider)?,
        onError: @escaping @MainActor (String) -> Void
    ) async {
        guard let provider else { return }

        isLoading = true
        defer { isLoading = false }

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
    }
}
