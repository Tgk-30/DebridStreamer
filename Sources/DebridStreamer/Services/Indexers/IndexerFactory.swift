import Foundation

enum IndexerFactory {
    static func buildIndexers(from configs: [IndexerConfig]) -> [TorrentIndexer] {
        var result: [TorrentIndexer] = []

        let builtInEnabled = configs.first(where: { $0.type == .builtIn })?.isActive ?? true
        if builtInEnabled {
            result.append(APIBayIndexer())
            result.append(YTSIndexer())
            result.append(EZTVIndexer())
        }

        let activeExternal = configs
            .filter { $0.isActive && $0.type != .builtIn }
            .sorted { $0.priority < $1.priority }

        for config in activeExternal {
            guard let indexer = makeExternalIndexer(from: config) else { continue }
            result.append(indexer)
        }

        return result
    }

    static func testConnection(config: IndexerConfig, session: URLSession = .shared) async -> Bool {
        guard let indexer = makeExternalIndexer(from: config, session: session) as? TorznabIndexer else {
            return config.type == .builtIn
        }

        do {
            _ = try await indexer.searchByQuery(query: "test", type: .movie)
            return true
        } catch {
            return false
        }
    }

    private static func makeExternalIndexer(from config: IndexerConfig, session: URLSession = .shared) -> (any TorrentIndexer)? {
        switch config.type {
        case .jackett, .prowlarr, .torznab, .zilean:
            let displayName = config.displayName?.trimmingCharacters(in: .whitespacesAndNewlines)
            let name = (displayName?.isEmpty == false) ? displayName! : config.type.displayName
            let sendAPIKeyAsHeader = config.providerSubtype == .prowlarr
            return TorznabIndexer(
                name: name,
                baseURL: config.baseURL,
                endpointPath: config.endpointPath,
                apiKey: config.apiKey,
                categoryFilter: config.categoryFilter,
                sendAPIKeyAsHeader: sendAPIKeyAsHeader,
                session: session
            )
        case .builtIn:
            return nil
        }
    }
}
