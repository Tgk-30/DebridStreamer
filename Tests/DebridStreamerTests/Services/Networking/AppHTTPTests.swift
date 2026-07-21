import Testing
import Foundation
@testable import DebridStreamer

@Suite("AppHTTP Tests")
struct AppHTTPTests {
    @Test("api session uses the shared JSON tuning profile")
    func apiSessionDefaults() {
        let config = AppHTTP.api.configuration
        let cache = config.urlCache

        #expect(config.requestCachePolicy == .useProtocolCachePolicy)
        #expect(config.timeoutIntervalForRequest == 30)
        #expect(config.timeoutIntervalForResource == 120)
        #expect(config.httpMaximumConnectionsPerHost == 6)
        #expect(config.waitsForConnectivity == true)
        #expect(cache?.memoryCapacity == 8 * 1024 * 1024)
        #expect(cache?.diskCapacity == 64 * 1024 * 1024)
    }
}
