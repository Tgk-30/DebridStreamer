import Foundation

/// Shared, tuned `URLSession`s for the app's network traffic.
///
/// Before V2 every service defaulted to `URLSession.shared`, which means no
/// process-level cache sizing or timeout policy and image bytes competing with
/// JSON in the same tiny default cache. `AppHTTP.api` is a single session with a
/// modest disk-backed `URLCache` (so idempotent GET metadata can be served from
/// cache) and sane per-host timeouts. Images deliberately use a *separate* session
/// in `ImageLoader` so large poster bitmaps never evict API responses.
enum AppHTTP {
    static let api: URLSession = {
        let config = URLSessionConfiguration.default
        config.urlCache = URLCache(memoryCapacity: 8 * 1024 * 1024, diskCapacity: 64 * 1024 * 1024)
        config.requestCachePolicy = .useProtocolCachePolicy
        config.timeoutIntervalForRequest = 30
        config.timeoutIntervalForResource = 120
        config.httpMaximumConnectionsPerHost = 6
        config.waitsForConnectivity = true
        return URLSession(configuration: config)
    }()
}
