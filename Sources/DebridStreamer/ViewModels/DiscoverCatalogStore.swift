import Foundation
import Observation

/// One Continue-Watching entry: the media preview plus the resume progress that
/// drives the inset progress bar + label on `ContinueWatchingCard`.
struct ContinueWatchingItem: Identifiable, Equatable {
    let preview: MediaPreview
    /// 0.0 – 1.0 resume fraction.
    let progress: Double
    /// Formatted "1:23:45 / 2:01:30" string (or just elapsed when no duration).
    let progressString: String
    let isInProgress: Bool

    var id: String { preview.id }
}

/// One genre-driven rail (e.g. "Action", "Comedy") populated via `discover`.
struct GenreRail: Identifiable, Equatable {
    let id: Int
    let name: String
    let items: [MediaPreview]
}

@MainActor
@Observable
final class DiscoverCatalogStore {
    var trendingMovies: [MediaPreview] = []
    var trendingShows: [MediaPreview] = []
    var popularMovies: [MediaPreview] = []
    var topRatedMovies: [MediaPreview] = []
    var nowPlayingMovies: [MediaPreview] = []
    var upcomingMovies: [MediaPreview] = []
    var airingTodayShows: [MediaPreview] = []
    var onTheAirShows: [MediaPreview] = []
    var genreRails: [GenreRail] = []
    var continueWatching: [ContinueWatchingItem] = []
    var isLoading = false
    private(set) var isLoaded = false
    private(set) var lastErrorMessage: String?
    /// Bumps each time a load completes, so views can drive a single
    /// `.onChange` re-sync instead of observing every rail individually.
    private(set) var catalogRevision: Int = 0

    /// Genres surfaced as their own rails. A small curated set keeps the page
    /// feature-packed without firing a dozen `discover` requests.
    private static let featuredGenreIDs: [Int] = [
        28,    // Action
        35,    // Comedy
        878,   // Science Fiction
        27,    // Horror
        18,    // Drama
        16     // Animation
    ]

    func reset() {
        trendingMovies = []
        trendingShows = []
        popularMovies = []
        topRatedMovies = []
        nowPlayingMovies = []
        upcomingMovies = []
        airingTodayShows = []
        onTheAirShows = []
        genreRails = []
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

        // Core category rails — each is independently fault-tolerant so one
        // failing request only empties its own rail, never the whole page.
        async let trendingMoviesResponse = provider.getTrending(type: .movie, timeWindow: .week, page: 1)
        async let trendingShowsResponse = provider.getTrending(type: .series, timeWindow: .week, page: 1)
        async let popularMoviesResponse = provider.getCategory(.popular, type: .movie, page: 1)
        async let topRatedMoviesResponse = provider.getCategory(.topRated, type: .movie, page: 1)
        async let nowPlayingResponse = provider.getCategory(.nowPlaying, type: .movie, page: 1)
        async let upcomingResponse = provider.getCategory(.upcoming, type: .movie, page: 1)
        async let airingTodayResponse = provider.getCategory(.airingToday, type: .series, page: 1)
        async let onTheAirResponse = provider.getCategory(.onTheAir, type: .series, page: 1)

        var errors: [String] = []

        do { trendingMovies = try await trendingMoviesResponse.items }
        catch { trendingMovies = []; errors.append("Trending movies failed: \(error.localizedDescription)") }

        do { trendingShows = try await trendingShowsResponse.items }
        catch { trendingShows = []; errors.append("Trending TV failed: \(error.localizedDescription)") }

        do { popularMovies = try await popularMoviesResponse.items }
        catch { popularMovies = []; errors.append("Popular movies failed: \(error.localizedDescription)") }

        do { topRatedMovies = try await topRatedMoviesResponse.items }
        catch { topRatedMovies = []; errors.append("Top rated movies failed: \(error.localizedDescription)") }

        do { nowPlayingMovies = try await nowPlayingResponse.items }
        catch { nowPlayingMovies = []; errors.append("Now playing failed: \(error.localizedDescription)") }

        do { upcomingMovies = try await upcomingResponse.items }
        catch { upcomingMovies = []; errors.append("Upcoming failed: \(error.localizedDescription)") }

        do { airingTodayShows = try await airingTodayResponse.items }
        catch { airingTodayShows = []; errors.append("Airing today failed: \(error.localizedDescription)") }

        do { onTheAirShows = try await onTheAirResponse.items }
        catch { onTheAirShows = []; errors.append("On the air failed: \(error.localizedDescription)") }

        // Genre rails enrich the page; a failure here must never surface as an
        // error or block the core rails, so they load best-effort and silently.
        genreRails = await loadGenreRails(provider: provider)

        if !errors.isEmpty {
            let message = errors.joined(separator: " ")
            lastErrorMessage = message
            onError(message)
        } else {
            lastErrorMessage = nil
        }

        isLoaded = true
        catalogRevision &+= 1
    }

    /// Resolve the featured genre names, then fetch each genre rail concurrently.
    /// Independently fault-tolerant: any genre that fails is simply dropped.
    private func loadGenreRails(provider: any MetadataProvider) async -> [GenreRail] {
        let genres = (try? await provider.getGenres(type: .movie)) ?? []
        guard !genres.isEmpty else { return [] }

        let featured = Self.featuredGenreIDs.compactMap { id in
            genres.first(where: { $0.id == id })
        }
        guard !featured.isEmpty else { return [] }

        let rails = await withTaskGroup(of: GenreRail?.self) { group in
            for genre in featured {
                group.addTask {
                    let filters = DiscoverFilters(genreId: genre.id, sortBy: .popularityDesc)
                    guard let result = try? await provider.discover(type: .movie, filters: filters),
                          !result.items.isEmpty else {
                        return nil
                    }
                    return GenreRail(id: genre.id, name: genre.name, items: result.items)
                }
            }
            var collected: [GenreRail] = []
            for await rail in group {
                if let rail { collected.append(rail) }
            }
            return collected
        }

        // Preserve the curated featured order (task group completes out of order).
        let order = Dictionary(uniqueKeysWithValues: Self.featuredGenreIDs.enumerated().map { ($1, $0) })
        return rails.sorted { (order[$0.id] ?? Int.max) < (order[$1.id] ?? Int.max) }
    }

    /// Continue-Watching rail: ONE bulk media fetch (no N+1), carrying resume
    /// progress, filtered to genuinely in-progress entries, original order kept.
    private func loadContinueWatching(database: DatabaseManager?) async {
        guard let database else {
            continueWatching = []
            return
        }

        do {
            let history = try await database.fetchRecentWatchHistory(limit: 20)
            // De-dupe by media (most recent entry wins) while keeping order.
            var seenMedia = Set<String>()
            let orderedHistory = history.filter { seenMedia.insert($0.mediaId).inserted }

            let mediaByID = try await database.fetchMedia(ids: orderedHistory.map(\.mediaId))

            var items: [ContinueWatchingItem] = []
            for entry in orderedHistory {
                guard entry.hasResumePoint, let media = mediaByID[entry.mediaId] else { continue }
                items.append(
                    ContinueWatchingItem(
                        preview: media.toPreview(),
                        progress: entry.progressPercent,
                        progressString: entry.progressString,
                        isInProgress: entry.hasResumePoint
                    )
                )
            }
            continueWatching = items
        } catch {
            continueWatching = []
        }
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
            tmdbId: tmdbId,
            backdropPath: backdropPath
        )
    }
}
