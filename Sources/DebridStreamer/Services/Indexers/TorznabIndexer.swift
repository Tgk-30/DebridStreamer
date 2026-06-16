import Foundation

actor TorznabIndexer: TorrentIndexer {
    let name: String
    private let baseURL: String
    private let endpointPath: String
    private let apiKey: String?
    private let categoryFilter: String?
    private let sendAPIKeyAsHeader: Bool
    private let session: URLSession

    init(
        name: String,
        baseURL: String,
        endpointPath: String,
        apiKey: String?,
        categoryFilter: String? = nil,
        sendAPIKeyAsHeader: Bool = false,
        session: URLSession = AppHTTP.api
    ) {
        self.name = name
        self.baseURL = baseURL
        self.endpointPath = endpointPath
        self.apiKey = apiKey
        self.categoryFilter = categoryFilter
        self.sendAPIKeyAsHeader = sendAPIKeyAsHeader
        self.session = session
    }

    func search(imdbId: String, type: MediaType, season: Int?, episode: Int?) async throws -> [TorrentResult] {
        var params: [String: String] = [
            "t": "search",
            "imdbid": imdbId
        ]
        if let season {
            params["season"] = String(season)
        }
        if let episode {
            params["ep"] = String(episode)
        }
        return try await execute(params: params)
    }

    func searchByQuery(query: String, type: MediaType) async throws -> [TorrentResult] {
        let params: [String: String] = [
            "t": "search",
            "q": query
        ]
        return try await execute(params: params)
    }

    private func execute(params: [String: String]) async throws -> [TorrentResult] {
        let request = try makeRequest(params: params)
        let (data, response) = try await session.data(for: request)
        // Throw on non-2xx (consistent with the built-in indexers) so that a
        // misconfigured endpoint / bad key surfaces as a recorded indexer failure
        // instead of an indistinguishable empty result. IndexerManager.searchAll
        // catches per-indexer, so this never aborts sibling indexers.
        guard let http = response as? HTTPURLResponse,
              (200...299).contains(http.statusCode) else {
            throw URLError(.badServerResponse)
        }

        let items = try TorznabFeedParser.parse(data: data)
        return items.compactMap { item in
            let hash = item.infoHash ?? extractInfoHash(from: item.magnetURL)
            guard let hash, !hash.isEmpty else { return nil }
            return TorrentResult.fromSearch(
                infoHash: hash,
                title: item.title,
                sizeBytes: item.size,
                seeders: item.seeders,
                leechers: item.peers,
                indexerName: name,
                magnetURI: item.magnetURL
            )
        }
    }

    private func makeRequest(params: [String: String]) throws -> URLRequest {
        guard var baseComponents = URLComponents(string: baseURL) else {
            throw URLError(.badURL)
        }
        if !endpointPath.isEmpty {
            baseComponents.path = normalizedPath(baseComponents.path, endpointPath)
        }

        var queryItems = params.map { URLQueryItem(name: $0.key, value: $0.value) }
        if let categoryFilter, !categoryFilter.isEmpty {
            queryItems.append(URLQueryItem(name: "cat", value: categoryFilter))
        }
        if let apiKey, !apiKey.isEmpty, !sendAPIKeyAsHeader {
            queryItems.append(URLQueryItem(name: "apikey", value: apiKey))
        }
        baseComponents.queryItems = queryItems

        guard let url = baseComponents.url else {
            throw URLError(.badURL)
        }

        var request = URLRequest(url: url)
        request.timeoutInterval = 20
        if let apiKey, !apiKey.isEmpty, sendAPIKeyAsHeader {
            request.setValue(apiKey, forHTTPHeaderField: "X-Api-Key")
        }
        return request
    }

    private func normalizedPath(_ currentPath: String, _ endpoint: String) -> String {
        let current = currentPath.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        let append = endpoint.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        if current.isEmpty {
            return "/\(append)"
        }
        if append.isEmpty {
            return "/\(current)"
        }
        return "/\(current)/\(append)"
    }

    private func extractInfoHash(from magnetURL: String?) -> String? {
        guard let magnetURL, let components = URLComponents(string: magnetURL) else { return nil }
        guard let xt = components.queryItems?.first(where: { $0.name.lowercased() == "xt" })?.value else {
            return nil
        }
        let prefix = "urn:btih:"
        guard xt.lowercased().hasPrefix(prefix) else { return nil }
        return String(xt.dropFirst(prefix.count))
    }
}

private struct TorznabFeedItem {
    var title: String
    var magnetURL: String?
    var infoHash: String?
    var size: Int64
    var seeders: Int
    var peers: Int
}

private enum TorznabFeedParser {
    static func parse(data: Data) throws -> [TorznabFeedItem] {
        let delegate = TorznabXMLDelegate()
        let parser = XMLParser(data: data)
        parser.delegate = delegate
        guard parser.parse() else {
            throw parser.parserError ?? URLError(.cannotParseResponse)
        }
        return delegate.items
    }
}

private final class TorznabXMLDelegate: NSObject, XMLParserDelegate {
    private(set) var items: [TorznabFeedItem] = []

    private var currentItem: CurrentItem?
    private var currentText = ""

    func parser(_ parser: XMLParser, didStartElement elementName: String, namespaceURI: String?, qualifiedName qName: String?, attributes attributeDict: [String: String] = [:]) {
        let element = elementName.lowercased()
        currentText = ""

        if element == "item" {
            currentItem = CurrentItem()
            return
        }

        guard currentItem != nil else { return }

        if element == "enclosure", let url = attributeDict["url"] {
            currentItem?.magnetURL = url
        } else if element == "torznab:attr" {
            let name = attributeDict["name"]?.lowercased() ?? ""
            let value = attributeDict["value"] ?? ""
            switch name {
            case "seeders":
                currentItem?.seeders = Int(value) ?? currentItem?.seeders ?? 0
            case "peers":
                currentItem?.peers = Int(value) ?? currentItem?.peers ?? 0
            case "size":
                currentItem?.size = Int64(value) ?? currentItem?.size ?? 0
            case "infohash":
                currentItem?.infoHash = value
            case "magneturl":
                currentItem?.magnetURL = value
            default:
                break
            }
        }
    }

    func parser(_ parser: XMLParser, foundCharacters string: String) {
        currentText += string
    }

    func parser(_ parser: XMLParser, didEndElement elementName: String, namespaceURI: String?, qualifiedName qName: String?) {
        let element = elementName.lowercased()
        guard var item = currentItem else { return }
        let value = currentText.trimmingCharacters(in: .whitespacesAndNewlines)

        switch element {
        case "title":
            item.title = value
        case "guid", "link":
            if value.lowercased().hasPrefix("magnet:?") {
                item.magnetURL = value
            }
        case "size":
            item.size = Int64(value) ?? item.size
        case "item":
            let title = item.title.isEmpty ? "Unknown" : item.title
            items.append(
                TorznabFeedItem(
                    title: title,
                    magnetURL: item.magnetURL,
                    infoHash: item.infoHash,
                    size: item.size,
                    seeders: item.seeders,
                    peers: item.peers
                )
            )
            currentItem = nil
        default:
            break
        }

        if element != "item" {
            currentItem = item
        }
    }

    private struct CurrentItem {
        var title = ""
        var magnetURL: String?
        var infoHash: String?
        var size: Int64 = 0
        var seeders: Int = 0
        var peers: Int = 0
    }
}
