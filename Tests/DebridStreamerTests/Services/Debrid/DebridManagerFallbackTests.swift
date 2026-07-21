import Testing
import Foundation
@testable import DebridStreamer

// MARK: - Stub

/// A fileprivate stub debrid service that returns a canned StreamInfo or throws,
/// and records the calls made against it. Used to drive DebridManager's
/// resolveStream priority/preferred/fallback selection and validateAll behavior
/// without touching the network or the concrete service implementations.
private final class StubDebridService: DebridServiceProtocol, @unchecked Sendable {
    let serviceType: DebridServiceType

    /// When non-nil, getStreamURL returns this; otherwise it throws `streamError`.
    private let cannedStream: StreamInfo?
    /// Error thrown from getStreamURL when `cannedStream` is nil.
    private let streamError: DebridError
    /// Result returned from validateToken (nil => throw `validateError`).
    private let tokenValid: Bool?
    private let validateError: DebridError

    /// Recorded interactions (for asserting which service was selected).
    private(set) var addMagnetCalls: [String] = []
    private(set) var selectFilesCalls: [(String, [Int])] = []
    private(set) var getStreamURLCalls: [String] = []
    private(set) var validateTokenCallCount = 0

    init(
        serviceType: DebridServiceType,
        stream: StreamInfo? = nil,
        streamError: DebridError = .downloadFailed("stub failure"),
        tokenValid: Bool? = true,
        validateError: DebridError = .invalidToken
    ) {
        self.serviceType = serviceType
        self.cannedStream = stream
        self.streamError = streamError
        self.tokenValid = tokenValid
        self.validateError = validateError
    }

    /// Convenience factory for a canned StreamInfo tagged with this service.
    static func stream(for serviceType: DebridServiceType) -> StreamInfo {
        StreamInfo(
            streamURL: "https://example.com/\(serviceType.rawValue).mkv",
            quality: .unknown,
            codec: .unknown,
            audio: .unknown,
            source: .unknown,
            sizeBytes: 1_000,
            fileName: "\(serviceType.rawValue).mkv",
            debridService: serviceType.displayName
        )
    }

    func checkCache(hashes: [String]) async throws -> [String: CacheStatus] {
        [:]
    }

    func addMagnet(hash: String) async throws -> String {
        addMagnetCalls.append(hash)
        return "torrent-\(serviceType.rawValue)"
    }

    func selectFiles(torrentId: String, fileIds: [Int]) async throws {
        selectFilesCalls.append((torrentId, fileIds))
    }

    func getStreamURL(torrentId: String) async throws -> StreamInfo {
        getStreamURLCalls.append(torrentId)
        if let cannedStream {
            return cannedStream
        }
        throw streamError
    }

    func unrestrict(link: String) async throws -> URL {
        throw DebridError.networkError("not implemented in stub")
    }

    func validateToken() async throws -> Bool {
        validateTokenCallCount += 1
        if let tokenValid {
            return tokenValid
        }
        throw validateError
    }

    func getAccountInfo() async throws -> DebridAccountInfo {
        DebridAccountInfo(username: "stub", email: nil, premiumExpiry: nil, isPremium: true, points: nil)
    }
}

private final class StubDebridServiceWithCache: DebridServiceProtocol, @unchecked Sendable {
    let serviceType: DebridServiceType
    private let cacheResult: Result<[String: CacheStatus], Error>

    private(set) var checkCacheCalls: Int = 0
    private(set) var addMagnetCalls: [String] = []
    private(set) var selectFilesCalls: [(String, [Int])] = []
    private(set) var getStreamURLCalls: [String] = []

    init(serviceType: DebridServiceType, cacheResult: Result<[String: CacheStatus], Error>) {
        self.serviceType = serviceType
        self.cacheResult = cacheResult
    }

    func checkCache(hashes: [String]) async throws -> [String: CacheStatus] {
        checkCacheCalls += 1
        switch cacheResult {
        case .success(let cache):
            return cache.filter { key, _ in hashes.contains(key) }
        case .failure(let error):
            throw error
        }
    }

    func addMagnet(hash: String) async throws -> String {
        addMagnetCalls.append(hash)
        return "torrent-\(serviceType.rawValue)"
    }

    func selectFiles(torrentId: String, fileIds: [Int]) async throws {
        selectFilesCalls.append((torrentId, fileIds))
    }

    func getStreamURL(torrentId: String) async throws -> StreamInfo {
        getStreamURLCalls.append(torrentId)
        throw DebridError.noFilesAvailable
    }

    func unrestrict(link: String) async throws -> URL {
        throw DebridError.networkError("not implemented in stub")
    }

    func validateToken() async throws -> Bool {
        return true
    }

    func getAccountInfo() async throws -> DebridAccountInfo {
        DebridAccountInfo(username: "stub", email: nil, premiumExpiry: nil, isPremium: true, points: nil)
    }
}

// MARK: - Tests

@Suite("DebridManager Fallback Tests")
struct DebridManagerFallbackTests {
    @Test("resolveStream picks the first (highest-priority) service when no preference given")
    func resolvePicksByPriority() async throws {
        let first = StubDebridService(
            serviceType: .allDebrid,
            stream: StubDebridService.stream(for: .allDebrid)
        )
        let second = StubDebridService(
            serviceType: .premiumize,
            stream: StubDebridService.stream(for: .premiumize)
        )

        // addService preserves insertion order; the manager treats services[0]
        // as the highest priority for resolveStream when no preference is given.
        let manager = DebridManager()
        await manager.addService(first)
        await manager.addService(second)

        let info = try await manager.resolveStream(hash: "deadbeef")

        // The first service resolved it; the second was never touched.
        #expect(info.debridService == DebridServiceType.allDebrid.displayName)
        #expect(first.getStreamURLCalls.count == 1)
        #expect(first.addMagnetCalls == ["deadbeef"])
        #expect(second.addMagnetCalls.isEmpty)
        #expect(second.getStreamURLCalls.isEmpty)
    }

    @Test("resolveStream honors preferredService over priority order")
    func resolveHonorsPreferred() async throws {
        let first = StubDebridService(
            serviceType: .allDebrid,
            stream: StubDebridService.stream(for: .allDebrid)
        )
        let second = StubDebridService(
            serviceType: .premiumize,
            stream: StubDebridService.stream(for: .premiumize)
        )

        let manager = DebridManager()
        await manager.addService(first)
        await manager.addService(second)

        // Even though `first` is higher priority, requesting `.premiumize`
        // routes to the second service.
        let info = try await manager.resolveStream(hash: "cafef00d", preferredService: .premiumize)

        #expect(info.debridService == DebridServiceType.premiumize.displayName)
        #expect(second.getStreamURLCalls.count == 1)
        #expect(second.addMagnetCalls == ["cafef00d"])
        #expect(first.addMagnetCalls.isEmpty)
        #expect(first.getStreamURLCalls.isEmpty)
    }

    @Test("resolveStream with a preferred service that is not configured throws")
    func resolvePreferredMissingThrows() async {
        let only = StubDebridService(
            serviceType: .allDebrid,
            stream: StubDebridService.stream(for: .allDebrid)
        )

        let manager = DebridManager()
        await manager.addService(only)

        await #expect(throws: DebridError.self) {
            _ = try await manager.resolveStream(hash: "abc", preferredService: .torBox)
        }
        // The configured service was never invoked for the unmatched preference.
        #expect(only.addMagnetCalls.isEmpty)
    }

    @Test("resolveStream propagates the selected service's error (no silent cross-service fallback)")
    func resolveSelectedServiceErrorPropagates() async {
        // The first/selected service throws while resolving; resolveStream must
        // surface that error rather than silently swallowing it.
        let failing = StubDebridService(
            serviceType: .allDebrid,
            stream: nil,
            streamError: .downloadFailed("boom")
        )
        let healthy = StubDebridService(
            serviceType: .premiumize,
            stream: StubDebridService.stream(for: .premiumize)
        )

        let manager = DebridManager()
        await manager.addService(failing)
        await manager.addService(healthy)

        do {
            _ = try await manager.resolveStream(hash: "xyz")
            #expect(Bool(false), "Expected resolveStream to throw the selected service's error")
        } catch let error as DebridError {
            #expect(error == .downloadFailed("boom"))
        } catch {
            #expect(Bool(false), "Expected DebridError, got \(error)")
        }

        // resolveStream selects exactly one service (services.first); it does not
        // fall through to the healthy service within a single call.
        #expect(failing.getStreamURLCalls.count == 1)
        #expect(healthy.addMagnetCalls.isEmpty)
        #expect(healthy.getStreamURLCalls.isEmpty)
    }

    @Test("validateAll returns a result for every configured service, in order")
    func validateAllPreservesOrder() async {
        let s1 = StubDebridService(serviceType: .realDebrid, tokenValid: true)
        let s2 = StubDebridService(serviceType: .allDebrid, tokenValid: false)
        let s3 = StubDebridService(serviceType: .premiumize, tokenValid: nil) // throws -> false

        let manager = DebridManager()
        await manager.addService(s1)
        await manager.addService(s2)
        await manager.addService(s3)

        let results = await manager.validateAll()

        #expect(results.count == 3)
        // Order is preserved despite concurrent validation (V2 made it concurrent).
        #expect(results.map(\.0) == [.realDebrid, .allDebrid, .premiumize])
        #expect(results.map(\.1) == [true, false, false])

        // Every service's token was actually checked.
        #expect(s1.validateTokenCallCount == 1)
        #expect(s2.validateTokenCallCount == 1)
        #expect(s3.validateTokenCallCount == 1)
    }

    @Test("validateAll on an empty manager returns no results")
    func validateAllEmpty() async {
        let manager = DebridManager()
        let results = await manager.validateAll()
        #expect(results.isEmpty)
    }

    @Test("checkCacheAll favors cached status over non-cached status")
    func checkCacheAllPrefersCachedStatus() async throws {
        let cached = CacheStatus.cached(fileId: "shared-file", fileName: "movie.mkv", fileSize: 1_000_000)
        let fast = StubDebridServiceWithCache(
            serviceType: .torBox,
            cacheResult: .success(["hash1": .notCached])
        )
        let smart = StubDebridServiceWithCache(
            serviceType: .premiumize,
            cacheResult: .success(["hash1": cached, "hash2": cached])
        )

        let manager = DebridManager()
        await manager.addService(fast)
        await manager.addService(smart)

        let result = try await manager.checkCacheAll(hashes: ["hash1", "hash2"])

        #expect(result["hash1"]?.service == .premiumize)
        #expect(result["hash1"]?.status == cached)
        #expect(result["hash2"]?.service == .premiumize)
        #expect(result["hash2"]?.status == cached)
    }

    @Test("checkCacheAll keeps service order when cache states are equal")
    func checkCacheAllUsesPriorityForEqualCacheState() async throws {
        let cached = CacheStatus.cached(fileId: "shared-file", fileName: "movie.mkv", fileSize: 1_000_000)
        let first = StubDebridServiceWithCache(
            serviceType: .allDebrid,
            cacheResult: .success(["shared": cached])
        )
        let second = StubDebridServiceWithCache(
            serviceType: .realDebrid,
            cacheResult: .success(["shared": cached])
        )

        let manager = DebridManager()
        await manager.addService(first)
        await manager.addService(second)

        let result = try await manager.checkCacheAll(hashes: ["shared"])

        #expect(result["shared"]?.service == .allDebrid)
    }

    @Test("checkCacheAll preserves service order when both report non-cached status")
    func checkCacheAllUsesPriorityWhenAllStatusesAreNonCached() async throws {
        let first = StubDebridServiceWithCache(
            serviceType: .allDebrid,
            cacheResult: .success(["shared": .notCached])
        )
        let second = StubDebridServiceWithCache(
            serviceType: .realDebrid,
            cacheResult: .success(["shared": .notCached])
        )

        let manager = DebridManager()
        await manager.addService(first)
        await manager.addService(second)

        let result = try await manager.checkCacheAll(hashes: ["shared"])

        #expect(result["shared"]?.service == .allDebrid)
        #expect(result["shared"]?.status == .notCached)
    }

    @Test("checkCacheAll ignores services that throw while checking cache")
    func checkCacheAllIgnoresThrownCacheChecks() async throws {
        let cached = CacheStatus.cached(fileId: "cached-file", fileName: "movie.mkv", fileSize: 1_000_000)
        let failing = StubDebridServiceWithCache(
            serviceType: .allDebrid,
            cacheResult: .failure(DebridError.networkError("network unavailable"))
        )
        let healthy = StubDebridServiceWithCache(
            serviceType: .torBox,
            cacheResult: .success(["hash": cached])
        )

        let manager = DebridManager()
        await manager.addService(failing)
        await manager.addService(healthy)

        let result = try await manager.checkCacheAll(hashes: ["hash"])

        #expect(result["hash"]?.service == .torBox)
        #expect(result["hash"]?.status == cached)
        #expect(failing.getStreamURLCalls.isEmpty)
    }

    @Test("checkCacheAll propagates no result when every check fails")
    func checkCacheAllReturnsEmptyWhenAllChecksFail() async throws {
        let first = StubDebridServiceWithCache(
            serviceType: .allDebrid,
            cacheResult: .failure(DebridError.networkError("network unavailable"))
        )
        let second = StubDebridServiceWithCache(
            serviceType: .realDebrid,
            cacheResult: .failure(DebridError.networkError("service down"))
        )

        let manager = DebridManager()
        await manager.addService(first)
        await manager.addService(second)

        let result = try await manager.checkCacheAll(hashes: ["missing"])

        #expect(result.isEmpty)
        #expect(first.getStreamURLCalls.isEmpty)
        #expect(second.getStreamURLCalls.isEmpty)
    }
}
