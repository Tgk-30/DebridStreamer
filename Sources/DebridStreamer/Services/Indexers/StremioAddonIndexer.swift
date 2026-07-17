import Foundation

/// Indexer that resolves streams from a Stremio addon (the Torrentio-compatible
/// ecosystem). A Stremio addon is configured by its base URL (the manifest URL,
/// e.g. `https://torrentio.strem.fun/...`); for a given content type + media id
/// it exposes `GET /stream/{type}/{id}.json` which returns a list of streams.
///
/// This maps those streams into `TorrentResult` defensively:
/// - `infoHash` is taken from the stream's `infoHash` field, or extracted from a
///   `magnet:` URL / `xt=urn:btih:` parameter when only a URL is present.
/// - `title` / quality / seeders are parsed from the stream's `title` (or `name`)
///   text, following the Torrentio convention where the title is a multi-line
///   blob like `Movie Name 1080p\n👤 42 💾 2.1 GB ⚙️ provider`.
///
/// A malformed base URL or any network/decoding failure degrades gracefully to an
/// empty result (the request throws, which `IndexerManager.searchAll` catches and
/// records per-indexer without aborting sibling indexers).
actor StremioAddonIndexer: TorrentIndexer {
    let name: String
    private let baseURL: String
    private let session: URLSession
    private let decoder = JSONDecoder()

    init(name: String, baseURL: String, session: URLSession = AppHTTP.api) {
        self.name = name
        self.baseURL = baseURL
        self.session = session
    }

    func search(imdbId: String, type: MediaType, season: Int?, episode: Int?) async throws -> [TorrentResult] {
        // Stremio addons key on IMDb ids only; bail cleanly on anything else
        // (e.g. a `tmdb-123` synthesized id) so we don't fire a doomed request.
        let trimmedId = imdbId.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmedId.lowercased().hasPrefix("tt") else { return [] }

        let stremioType = stremioContentType(for: type)
        // For series Stremio expects `tt1234567:season:episode`.
        let streamId: String
        if type == .series, let season, let episode {
            streamId = "\(trimmedId):\(season):\(episode)"
        } else {
            streamId = trimmedId
        }

        let request = try makeStreamRequest(type: stremioType, id: streamId)
        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse,
              (200...299).contains(http.statusCode) else {
            throw URLError(.badServerResponse)
        }

        let payload = try decoder.decode(StremioStreamResponse.self, from: data)
        return mapStreams(payload.streams ?? [])
    }

    func searchByQuery(query: String, type: MediaType) async throws -> [TorrentResult] {
        // Stremio addons resolve by IMDb id, not free-text query, so there is no
        // meaningful text-search path. Return empty rather than guessing.
        return []
    }

    // MARK: - Request building

    private func stremioContentType(for type: MediaType) -> String {
        switch type {
        case .movie: return "movie"
        case .series: return "series"
        }
    }

    /// Builds `{baseURL}/stream/{type}/{id}.json`, normalizing slashes so a base
    /// URL with or without a trailing slash both resolve correctly. If users pass
    /// a `manifest.json` URL, strip that suffix before appending `stream/...`
    /// so we don't generate `.../manifest.json/stream/...`.
    private func makeStreamRequest(type: String, id: String) throws -> URLRequest {
        var trimmedBase = baseURL.trimmingCharacters(in: .whitespacesAndNewlines)
        while trimmedBase.hasSuffix("/") {
            trimmedBase.removeLast()
        }
        if trimmedBase.lowercased().hasSuffix("/manifest.json") {
            trimmedBase.removeLast("/manifest.json".count)
            while trimmedBase.hasSuffix("/") {
                trimmedBase.removeLast()
            }
        }
        // Stremio stream ids can contain ':' (series) which must be percent-encoded.
        let encodedId = id.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed.subtracting(CharacterSet(charactersIn: ":"))) ?? id
        let urlString = "\(trimmedBase)/stream/\(type)/\(encodedId).json"
        guard let url = URL(string: urlString) else {
            throw URLError(.badURL)
        }
        var request = URLRequest(url: url)
        request.timeoutInterval = 25
        return request
    }

    // MARK: - Mapping

    private func mapStreams(_ streams: [StremioStream]) -> [TorrentResult] {
        var results: [TorrentResult] = []
        for stream in streams {
            guard let hash = resolveInfoHash(from: stream) else { continue }

            // Prefer the descriptive multi-line `title`, falling back to `name`
            // and finally the bare hash so parsing always has something to work on.
            let rawTitle = (stream.title ?? stream.name)?.trimmingCharacters(in: .whitespacesAndNewlines)
            let displayTitle = (rawTitle?.isEmpty == false) ? rawTitle! : hash
            // Quality/codec/source parsing keys off the whole blob; collapse the
            // newlines so multi-line Torrentio titles still match the parsers.
            let parseSource = displayTitle.replacingOccurrences(of: "\n", with: " ")

            let seeders = extractSeeders(from: displayTitle) ?? 0
            let sizeBytes = extractSize(from: displayTitle) ?? 0
            // Use the first non-empty line as the human-facing title; the rest is metadata.
            let primaryTitle = displayTitle
                .split(separator: "\n", omittingEmptySubsequences: true)
                .first
                .map { String($0).trimmingCharacters(in: .whitespacesAndNewlines) } ?? displayTitle

            let magnetURI = stream.url?.hasPrefix("magnet:") == true ? stream.url : makeMagnet(hash: hash, title: primaryTitle)

            results.append(
                TorrentResult.fromSearch(
                    infoHash: hash,
                    title: parseSource.isEmpty ? primaryTitle : "\(primaryTitle) \(parseSource)",
                    sizeBytes: sizeBytes,
                    seeders: seeders,
                    leechers: 0,
                    indexerName: name,
                    magnetURI: magnetURI
                )
            )
        }
        return results
    }

    /// Resolves a 40-char btih info hash from a Stremio stream, trying (in order):
    /// the explicit `infoHash` field, an `xt=urn:btih:` parameter in a magnet/url,
    /// and the first 40-hex run anywhere in the `url`.
    private func resolveInfoHash(from stream: StremioStream) -> String? {
        if let direct = stream.infoHash?.trimmingCharacters(in: .whitespacesAndNewlines),
           isValidInfoHash(direct) {
            return direct.lowercased()
        }
        if let url = stream.url, let fromMagnet = extractInfoHash(fromMagnet: url) {
            return fromMagnet
        }
        return nil
    }

    private func extractInfoHash(fromMagnet urlString: String) -> String? {
        // Try a structured magnet parse first.
        if let components = URLComponents(string: urlString),
           let xt = components.queryItems?.first(where: { $0.name.lowercased() == "xt" })?.value {
            let prefix = "urn:btih:"
            if xt.lowercased().hasPrefix(prefix) {
                let candidate = String(xt.dropFirst(prefix.count))
                if isValidInfoHash(candidate) { return candidate.lowercased() }
            }
        }
        // Fall back to the first 40-hex run anywhere in the string.
        if let range = urlString.range(of: "[A-Fa-f0-9]{40}", options: .regularExpression) {
            return String(urlString[range]).lowercased()
        }
        return nil
    }

    private func isValidInfoHash(_ value: String) -> Bool {
        guard value.count == 40 else { return false }
        return value.range(of: "^[A-Fa-f0-9]{40}$", options: .regularExpression) != nil
    }

    private func makeMagnet(hash: String, title: String) -> String {
        let encodedName = title.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? title
        return "magnet:?xt=urn:btih:\(hash)&dn=\(encodedName)"
    }

    /// Parses the seeder count from a Torrentio-style title line, e.g.
    /// `👤 42` / `Seeders: 42` / `S:42`.
    private func extractSeeders(from title: String) -> Int? {
        let patterns = [
            "👤\\s*(\\d+)",
            "(?i)seeders?\\s*[:=]?\\s*(\\d+)",
            "(?i)\\bS\\s*[:=]\\s*(\\d+)"
        ]
        for pattern in patterns {
            if let value = firstCapturedInt(in: title, pattern: pattern) {
                return value
            }
        }
        return nil
    }

    /// Parses a human size like `💾 2.1 GB` / `Size: 700 MB` into bytes.
    private func extractSize(from title: String) -> Int64? {
        let pattern = "(?i)(\\d+(?:\\.\\d+)?)\\s*(TB|GB|MB|KB)"
        guard let regex = try? NSRegularExpression(pattern: pattern) else { return nil }
        let range = NSRange(title.startIndex..<title.endIndex, in: title)
        guard let match = regex.firstMatch(in: title, range: range),
              let numberRange = Range(match.range(at: 1), in: title),
              let unitRange = Range(match.range(at: 2), in: title),
              let value = Double(title[numberRange]) else {
            return nil
        }
        let unit = title[unitRange].uppercased()
        let multiplier: Double
        switch unit {
        case "TB": multiplier = 1_000_000_000_000
        case "GB": multiplier = 1_000_000_000
        case "MB": multiplier = 1_000_000
        case "KB": multiplier = 1_000
        default: multiplier = 1
        }
        return Int64(value * multiplier)
    }

    private func firstCapturedInt(in text: String, pattern: String) -> Int? {
        guard let regex = try? NSRegularExpression(pattern: pattern) else { return nil }
        let range = NSRange(text.startIndex..<text.endIndex, in: text)
        guard let match = regex.firstMatch(in: text, range: range),
              match.numberOfRanges > 1,
              let captureRange = Range(match.range(at: 1), in: text) else {
            return nil
        }
        return Int(text[captureRange])
    }
}

// MARK: - Stremio API Models

/// Top-level `/stream/...json` response. The `streams` array is optional so an
/// empty / error body decodes to no results rather than throwing.
struct StremioStreamResponse: Decodable, Sendable {
    let streams: [StremioStream]?
}

/// A single Stremio stream entry. All fields are optional because addons vary
/// widely in which they populate (Torrentio sets `infoHash` + `title`; others may
/// only provide a `url`).
struct StremioStream: Decodable, Sendable {
    let name: String?
    let title: String?
    let infoHash: String?
    let fileIdx: Int?
    let url: String?
    let behaviorHints: BehaviorHints?

    struct BehaviorHints: Decodable, Sendable {
        let bingeGroup: String?
        let filename: String?
    }
}
