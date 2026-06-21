import SwiftUI
import AppKit

/// Process-wide image cache for posters/backdrops/headshots.
///
/// Why this exists: plain `AsyncImage(url:)` rides `URLCache.shared`, which is tiny
/// and shared with all JSON API traffic, so posters get evicted constantly and
/// re-download every time you scroll back up a Discover rail. This actor keeps a
/// bounded in-memory set of decoded `NSImage`s keyed by URL, owns its *own* disk-
/// backed `URLSession` (separate from API traffic), and **coalesces** concurrent
/// requests for the same URL — a poster that appears in Trending *and* Popular is
/// fetched and decoded exactly once.
actor ImageLoader {
    static let shared = ImageLoader()

    private let cache = NSCache<NSURL, NSImage>()
    private var inFlight: [URL: Task<NSImage?, Never>] = [:]
    private let session: URLSession

    init() {
        cache.countLimit = 500
        cache.totalCostLimit = 80 * 1024 * 1024 // ~80MB of decoded bitmaps

        let config = URLSessionConfiguration.default
        config.urlCache = URLCache(
            memoryCapacity: 16 * 1024 * 1024,
            diskCapacity: 256 * 1024 * 1024
        )
        config.requestCachePolicy = .returnCacheDataElseLoad
        config.httpMaximumConnectionsPerHost = 6
        self.session = URLSession(configuration: config)
    }

    /// Returns a decoded image for `url`, served from memory when possible and
    /// coalescing duplicate concurrent loads.
    func image(for url: URL) async -> NSImage? {
        if let cached = cache.object(forKey: url as NSURL) { return cached }
        if let existing = inFlight[url] { return await existing.value }

        let task = Task<NSImage?, Never> { [session] in
            guard let (data, response) = try? await session.data(from: url) else { return nil }
            if let http = response as? HTTPURLResponse, !(200...299).contains(http.statusCode) {
                return nil
            }
            return NSImage(data: data)
        }
        inFlight[url] = task
        let image = await task.value
        inFlight[url] = nil

        if let image {
            cache.setObject(image, forKey: url as NSURL, cost: Self.cost(of: image))
        }
        return image
    }

    /// Warm the cache for upcoming posters (e.g. the next rail) without blocking UI.
    func prefetch(_ urls: [URL]) {
        for url in urls where cache.object(forKey: url as NSURL) == nil && inFlight[url] == nil {
            let task = Task<NSImage?, Never> { [session] in
                guard let (data, _) = try? await session.data(from: url) else { return nil }
                return NSImage(data: data)
            }
            inFlight[url] = task
            Task { [weak self] in
                let image = await task.value
                await self?.store(image, for: url)
            }
        }
    }

    private func store(_ image: NSImage?, for url: URL) {
        inFlight[url] = nil
        if let image {
            cache.setObject(image, forKey: url as NSURL, cost: Self.cost(of: image))
        }
    }

    private static func cost(of image: NSImage) -> Int {
        guard let rep = image.representations.first else { return 1 }
        return max(1, rep.pixelsWide * rep.pixelsHigh * 4)
    }
}

/// Drop-in replacement for `AsyncImage(url:content:)` that routes through
/// `ImageLoader` so images are cached + coalesced. Same phase-based API, so call
/// sites keep their existing placeholder/success closures.
struct CachedAsyncImage<Content: View>: View {
    let url: URL?
    @ViewBuilder var content: (AsyncImagePhase) -> Content

    @State private var phase: AsyncImagePhase = .empty
    /// The URL that produced the current `phase`. Used so the "already resolved"
    /// short-circuit only fires for the SAME url — otherwise a recycled view
    /// (hero after a catalog reload, or a card whose posterPath changed) would
    /// keep showing the previous image because its prior `.success` matched.
    @State private var loadedURL: URL?

    init(url: URL?, @ViewBuilder content: @escaping (AsyncImagePhase) -> Content) {
        self.url = url
        self.content = content
    }

    var body: some View {
        content(phase)
            .task(id: url) { await load() }
    }

    private func load() async {
        guard let url else {
            phase = .empty
            loadedURL = nil
            return
        }
        // Don't flash the placeholder if we already resolved THIS exact url.
        if loadedURL == url, case .success = phase { return }
        phase = .empty
        let image = await ImageLoader.shared.image(for: url)
        // The view may have been recycled to a new url while we awaited
        // (.task(id:) cancels the stale run); don't clobber the newer phase.
        guard !Task.isCancelled else { return }
        if let image {
            phase = .success(Image(nsImage: image))
        } else {
            phase = .failure(URLError(.cannotDecodeContentData))
        }
        loadedURL = url
    }
}
