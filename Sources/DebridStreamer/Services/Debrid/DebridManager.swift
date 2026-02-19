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
    /// Returns hash -> (service, status) for the first service that has it cached.
    func checkCacheAll(hashes: [String]) async throws -> [String: (service: DebridServiceType, status: CacheStatus)] {
        guard !hashes.isEmpty else { return [:] }

        var results: [String: (service: DebridServiceType, status: CacheStatus)] = [:]

        // Query all services concurrently
        await withTaskGroup(of: (DebridServiceType, [String: CacheStatus]).self) { group in
            for service in services {
                group.addTask {
                    let cache = (try? await service.checkCache(hashes: hashes)) ?? [:]
                    return (service.serviceType, cache)
                }
            }

            for await (serviceType, cache) in group {
                for (hash, status) in cache {
                    // Prefer first service that has it cached (respects priority order)
                    if results[hash] == nil || (!results[hash]!.status.isCached && status.isCached) {
                        results[hash] = (serviceType, status)
                    }
                }
            }
        }

        return results
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
    func validateAll() async -> [(DebridServiceType, Bool)] {
        var results: [(DebridServiceType, Bool)] = []
        for service in services {
            let valid = (try? await service.validateToken()) ?? false
            results.append((service.serviceType, valid))
        }
        return results
    }
}
