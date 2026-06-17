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
        guard config.type != .builtIn else {
            // Built-in indexers have no user-configured endpoint to validate.
            return true
        }

        if config.type == .stremioAddon {
            return await testStremioAddon(config: config, session: session)
        }

        // Validate the HTTP layer and require a positive signal (2xx AND a
        // parseable Torznab/RSS feed without an error envelope), rather than
        // merely "the request did not throw". A wrong base URL, bad path, or
        // bad API key typically yields a non-2xx status or an error envelope.
        guard let request = makeTorznabProbeRequest(from: config) else {
            return false
        }

        do {
            let (data, response) = try await session.data(for: request)
            guard let http = response as? HTTPURLResponse,
                  (200...299).contains(http.statusCode) else {
                return false
            }
            return isPositiveTorznabResponse(data)
        } catch {
            return false
        }
    }

    /// Validates a Stremio addon by fetching its `manifest.json`. A valid addon
    /// returns a 2xx JSON manifest carrying at least an `id` field.
    private static func testStremioAddon(config: IndexerConfig, session: URLSession) async -> Bool {
        var base = config.baseURL.trimmingCharacters(in: .whitespacesAndNewlines)
        while base.hasSuffix("/") { base.removeLast() }
        // Accept either a bare base URL or a full `.../manifest.json`.
        let manifestURLString = base.hasSuffix("manifest.json") ? base : "\(base)/manifest.json"
        guard let url = URL(string: manifestURLString) else { return false }

        var request = URLRequest(url: url)
        request.timeoutInterval = 20
        do {
            let (data, response) = try await session.data(for: request)
            guard let http = response as? HTTPURLResponse,
                  (200...299).contains(http.statusCode) else {
                return false
            }
            guard let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
                return false
            }
            return object["id"] != nil || object["resources"] != nil
        } catch {
            return false
        }
    }

    /// Builds a minimal Torznab search probe request for `testConnection`.
    private static func makeTorznabProbeRequest(from config: IndexerConfig) -> URLRequest? {
        guard var components = URLComponents(string: config.baseURL) else { return nil }
        if !config.endpointPath.isEmpty {
            let current = components.path.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
            let append = config.endpointPath.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
            if current.isEmpty {
                components.path = "/\(append)"
            } else if append.isEmpty {
                components.path = "/\(current)"
            } else {
                components.path = "/\(current)/\(append)"
            }
        }

        let sendAPIKeyAsHeader = config.providerSubtype == .prowlarr
        var queryItems: [URLQueryItem] = [
            URLQueryItem(name: "t", value: "search"),
            URLQueryItem(name: "q", value: "test")
        ]
        if let categoryFilter = config.categoryFilter, !categoryFilter.isEmpty {
            queryItems.append(URLQueryItem(name: "cat", value: categoryFilter))
        }
        if let apiKey = config.apiKey, !apiKey.isEmpty, !sendAPIKeyAsHeader {
            queryItems.append(URLQueryItem(name: "apikey", value: apiKey))
        }
        components.queryItems = queryItems

        guard let url = components.url else { return nil }
        var request = URLRequest(url: url)
        request.timeoutInterval = 20
        if let apiKey = config.apiKey, !apiKey.isEmpty, sendAPIKeyAsHeader {
            request.setValue(apiKey, forHTTPHeaderField: "X-Api-Key")
        }
        return request
    }

    /// Returns true only when the body looks like a valid Torznab/RSS feed and
    /// is not a Torznab error envelope (e.g. `<error code="100" .../>`).
    private static func isPositiveTorznabResponse(_ data: Data) -> Bool {
        guard let body = String(data: data, encoding: .utf8) else { return false }
        let lower = body.lowercased()
        // A Torznab error envelope is a negative signal even with HTTP 200.
        if lower.contains("<error") {
            return false
        }
        // Require a recognizable feed root; a valid empty feed still passes.
        return lower.contains("<rss") || lower.contains("<?xml")
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
        case .stremioAddon:
            let baseURL = config.baseURL.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !baseURL.isEmpty, URL(string: baseURL) != nil else { return nil }
            let displayName = config.displayName?.trimmingCharacters(in: .whitespacesAndNewlines)
            let name = (displayName?.isEmpty == false) ? displayName! : config.type.displayName
            return StremioAddonIndexer(name: name, baseURL: baseURL)
        case .builtIn:
            return nil
        }
    }
}
