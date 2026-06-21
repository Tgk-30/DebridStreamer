import Foundation

/// Manages multiple debrid services and routes requests to the best available one.
actor DebridManager {
    private var services: [DebridServiceProtocol] = []
    private let secretStore: any SecretStore

    init(secretStore: any SecretStore = KeychainSecretStore()) {
        self.secretStore = secretStore
    }

    /// Configure services from stored configs.
    func configure(configs: [DebridConfig]) async {
        let activeConfigs = configs
            .filter { $0.isActive }
            .sorted { $0.priority < $1.priority }

        var resolvedServices: [DebridServiceProtocol] = []
        for config in activeConfigs {
            guard let token = await resolveToken(for: config), !token.isEmpty else {
                continue
            }

            switch config.service {
            case .realDebrid:
                resolvedServices.append(RealDebridService(apiToken: token))
            case .allDebrid:
                resolvedServices.append(AllDebridService(apiToken: token))
            case .premiumize:
                resolvedServices.append(PremiumizeService(apiToken: token))
            case .torBox:
                resolvedServices.append(TorBoxService(apiToken: token))
            }
        }

        services = resolvedServices
    }

    private func resolveToken(for config: DebridConfig) async -> String? {
        guard let secretKey = SecretReference.decode(config.apiToken) else {
            return config.apiToken
        }

        do {
            return try await secretStore.getSecret(for: secretKey)
        } catch {
            #if DEBUG
            print("[DebridManager] Failed to resolve secret for \(config.service.rawValue): \(error)")
            #endif
            return nil
        }
    }

    /// Add a single service.
    func addService(_ service: DebridServiceProtocol) {
        services.append(service)
    }

    /// Get all active service types.
    var activeServiceTypes: [DebridServiceType] {
        services.map(\.serviceType)
    }

    var hasServices: Bool {
        !services.isEmpty
    }

    /// Check cache across all active debrid services.
    ///
    /// For each hash the result binds the highest-priority service that actually
    /// reports the hash as CACHED (so `resolveStream` is never routed to a service
    /// that does not have it cached). Hashes that no service has cached still get a
    /// reported status (so callers can sort/display them), bound to the
    /// highest-priority service that returned a status for them. The merge is fully
    /// deterministic regardless of task completion order, driven by each service's
    /// configured priority index.
    func checkCacheAll(hashes: [String]) async throws -> [String: (service: DebridServiceType, status: CacheStatus)] {
        guard !hashes.isEmpty else { return [:] }

        // Query all services concurrently, carrying each service's priority index so
        // the merge can be made order-independent (services is sorted by priority).
        var collected: [(index: Int, serviceType: DebridServiceType, cache: [String: CacheStatus])] = []
        await withTaskGroup(of: (Int, DebridServiceType, [String: CacheStatus]).self) { group in
            for (index, service) in services.enumerated() {
                group.addTask {
                    let cache = (try? await service.checkCache(hashes: hashes)) ?? [:]
                    return (index, service.serviceType, cache)
                }
            }

            for await result in group {
                collected.append((result.0, result.1, result.2))
            }
        }

        // Deterministic merge by priority index. A cached entry always beats a
        // non-cached one; among entries of equal cached-ness the lower index wins.
        var results: [String: (index: Int, service: DebridServiceType, status: CacheStatus)] = [:]
        for entry in collected.sorted(by: { $0.index < $1.index }) {
            for (hash, status) in entry.cache {
                if let existing = results[hash] {
                    let beatsCacheState = status.isCached && !existing.status.isCached
                    let sameCacheStateLowerIndex = status.isCached == existing.status.isCached && entry.index < existing.index
                    if beatsCacheState || sameCacheStateLowerIndex {
                        results[hash] = (entry.index, entry.serviceType, status)
                    }
                } else {
                    results[hash] = (entry.index, entry.serviceType, status)
                }
            }
        }

        return results.mapValues { (service: $0.service, status: $0.status) }
    }

    /// Resolve a torrent hash to a stream URL using the specified (or first available) service.
    func resolveStream(hash: String, preferredService: DebridServiceType? = nil) async throws -> StreamInfo {
        let service: DebridServiceProtocol

        if let preferred = preferredService {
            guard let found = services.first(where: { $0.serviceType == preferred }) else {
                throw DebridError.networkError("Service \(preferred.displayName) not configured")
            }
            service = found
        } else {
            guard let first = services.first else {
                throw DebridError.networkError("No debrid services configured")
            }
            service = first
        }

        // For Real-Debrid, use the smart resolve flow
        if let rdService = service as? RealDebridService {
            return try await resolveWithRealDebrid(rdService, hash: hash)
        }

        // Generic flow for other services
        let torrentId = try await service.addMagnet(hash: hash)
        try await service.selectFiles(torrentId: torrentId, fileIds: [])
        return try await service.getStreamURL(torrentId: torrentId)
    }

    /// Smart Real-Debrid resolve flow:
    /// 1. Check if torrent already exists in user's list
    /// 2. If not, add magnet
    /// 3. Select files if needed
    /// 4. Poll for "downloaded" status
    /// 5. Unrestrict and return stream URL
    private func resolveWithRealDebrid(_ service: RealDebridService, hash: String) async throws -> StreamInfo {
        var torrentId: String

        // Step 1: Check if already in user's torrents
        if let existingId = try? await service.findExistingTorrent(hash: hash) {
            #if DEBUG
            print("[DebridManager] Found existing torrent: \(existingId)")
            #endif
            torrentId = existingId
        } else {
            // Step 2: Add magnet (with retry logic built into RealDebridService)
            torrentId = try await service.addMagnet(hash: hash)
            #if DEBUG
            print("[DebridManager] Added magnet, torrent ID: \(torrentId)")
            #endif
        }

        // Step 3-5: Select files and get stream URL (with polling)
        return try await service.getStreamURL(torrentId: torrentId)
    }

    /// Validate all configured services and return status.
    ///
    /// Services are validated concurrently (mirroring `checkCacheAll`) instead of
    /// in a serial loop, so total latency is bounded by the slowest service rather
    /// than their sum. Each task carries its `services` index so the returned array
    /// preserves the original service order regardless of completion order — the
    /// return shape/semantics are unchanged from the serial version.
    func validateAll() async -> [(DebridServiceType, Bool)] {
        var collected: [(index: Int, serviceType: DebridServiceType, valid: Bool)] = []
        await withTaskGroup(of: (Int, DebridServiceType, Bool).self) { group in
            for (index, service) in services.enumerated() {
                group.addTask {
                    let valid = (try? await service.validateToken()) ?? false
                    return (index, service.serviceType, valid)
                }
            }
            for await result in group {
                collected.append((result.0, result.1, result.2))
            }
        }
        return collected
            .sorted { $0.index < $1.index }
            .map { ($0.serviceType, $0.valid) }
    }
}
