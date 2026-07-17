import Foundation

/// APIBay (The Pirate Bay proxy) indexer for movies and TV shows.
/// Provides broad coverage for both movies and TV including anime.
/// API: https://apibay.org
actor APIBayIndexer: TorrentIndexer {
    let name = "APIBay"
    private let baseURL = "https://apibay.org"
    private let session: URLSession
    private let decoder = JSONDecoder()

    init(session: URLSession = AppHTTP.api) {
        self.session = session
    }

    // Category IDs for video content
    private enum Category: String {
        case video = "200"       // All video
        case movies = "201"      // Movies
        case tvShows = "205"     // TV Shows
        case hdMovies = "207"    // HD Movies
        case hdTV = "208"        // HD TV Shows
    }

    private func buildSearchCategories(for type: MediaType) -> [Category] {
        type == .movie
            ? [.hdMovies, .movies, .video]
            : [.hdTV, .tvShows, .video]
    }

    private func buildFallbackIMDbIDs(_ imdbId: String) -> [String] {
        let trimmed = imdbId.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return [] }

        var ids = [trimmed]
        if trimmed.lowercased().hasPrefix("tt") && trimmed.count > 2 {
            let numeric = String(trimmed.dropFirst(2))
            ids.append(numeric)
        }

        var seen = Set<String>()
        return ids.filter {
            guard !seen.contains($0) else { return false }
            seen.insert($0)
            return true
        }
    }

    private func buildSeasonEpisodeRegexes(season: Int, episode: Int) -> [String] {
        let seasonPattern = String(season)
        let episodePattern = String(episode)
        let season2 = String(format: "%02d", season)
        let episode2 = String(format: "%02d", episode)

        return [
            "\\bS\\s*" + seasonPattern + "\\s*[._\\-]?\\s*E\\s*" + episodePattern,
            "\\bS\\s*" + seasonPattern + "\\s*[._\\-]?\\s*EP\\s*" + episodePattern,
            "\\bS\\s*" + season2 + "\\s*[._\\-]?\\s*E\\s*" + episode2,
            "\\bS\\s*" + season2 + "\\s*[._\\-]?\\s*[xX]\\s*" + episode2,
            "\\b0?" + seasonPattern + "\\s*[xX]\\s*0?" + episodePattern + "(?!\\d)",
        ]
    }

    private func titleMatchesSeasonEpisode(
        title: String,
        season: Int,
        episode: Int,
    ) -> Bool {
        let regexes = buildSeasonEpisodeRegexes(season: season, episode: episode)
        return regexes.contains { pattern in
            title.range(
                of: pattern,
                options: [.regularExpression, .caseInsensitive],
            ) != nil
        }
    }

    private func buildSearchURL(_ query: String, category: Category) -> URL {
        // Keep search tolerant of trailing whitespace in callers.
        let encodedQuery =
            query.trimmingCharacters(in: .whitespacesAndNewlines)
            .addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed)
            ?? query

        return URL(string: "\(baseURL)/q.php?q=\(encodedQuery)&cat=\(category.rawValue)")!
    }

    private func fetchItems(url: URL) async throws -> [APIBayItem]? {
        var request = URLRequest(url: url)
        request.timeoutInterval = 20
        let (data, response) = try await session.data(for: request)

        guard let httpResponse = response as? HTTPURLResponse,
              (200...299).contains(httpResponse.statusCode) else {
            throw URLError(.badServerResponse)
        }

        let items = try decoder.decode([APIBayItem].self, from: data)
        if items.isEmpty || items.first?.name == "No results returned" {
            return nil
        }

        return items
    }

    func search(imdbId: String, type: MediaType, season: Int?, episode: Int?) async throws -> [TorrentResult] {
        let queries = buildFallbackIMDbIDs(imdbId)
        if queries.isEmpty {
            return []
        }

        var seen = Set<String>()

        for category in buildSearchCategories(for: type) {
            var results: [TorrentResult] = []
            for query in queries {
                let url = buildSearchURL(query, category: category)
                let items = try await fetchItems(url: url)
                guard let items else { continue }

                for item in items {
                    let hash = item.infoHash
                    if hash.isEmpty || hash == "0000000000000000000000000000000000000000" {
                        continue
                    }

                    if type == .series, let season, let episode,
                       !titleMatchesSeasonEpisode(title: item.name, season: season, episode: episode) {
                        continue
                    }

                    let seeders = Int(item.seeders) ?? 0
                    let leechers = Int(item.leechers) ?? 0
                    let sizeBytes = Int64(item.size) ?? 0

                    guard seeders > 0 else { continue }

                    let normalizedHash = hash.lowercased()
                    if seen.contains(normalizedHash) {
                        continue
                    }
                    seen.insert(normalizedHash)

                    results.append(
                        TorrentResult.fromSearch(
                            infoHash: hash,
                            title: item.name,
                            sizeBytes: sizeBytes,
                            seeders: seeders,
                            leechers: leechers,
                            indexerName: name,
                        )
                    )
                }

                if !results.isEmpty {
                    return results
                }
            }
        }

        return []
    }

    func searchByQuery(query: String, type: MediaType) async throws -> [TorrentResult] {
        let trimmedQuery = query.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmedQuery.isEmpty { return [] }

        var seen = Set<String>()
        var results: [TorrentResult] = []

        for category in buildSearchCategories(for: type) {
            let url = buildSearchURL(trimmedQuery, category: category)
            let items = try await fetchItems(url: url)
            guard let items else { continue }

            for item in items {
                let hash = item.infoHash
                if hash.isEmpty || hash == "0000000000000000000000000000000000000000" {
                    continue
                }

                let seeders = Int(item.seeders) ?? 0
                let leechers = Int(item.leechers) ?? 0
                let sizeBytes = Int64(item.size) ?? 0

                guard seeders > 0 else { continue }

                let normalizedHash = hash.lowercased()
                if seen.contains(normalizedHash) {
                    continue
                }
                seen.insert(normalizedHash)

                results.append(
                    TorrentResult.fromSearch(
                        infoHash: hash,
                        title: item.name,
                        sizeBytes: sizeBytes,
                        seeders: seeders,
                        leechers: leechers,
                        indexerName: name,
                    )
                )
            }

            if !results.isEmpty {
                return results
            }
        }

        return results
    }
}

// MARK: - APIBay API Models

struct APIBayItem: Decodable {
    let id: String
    let name: String
    let infoHash: String
    let leechers: String
    let seeders: String
    let size: String
    let numFiles: String?
    let username: String?
    let added: String?
    let status: String?
    let category: String?
    let imdb: String?

    enum CodingKeys: String, CodingKey {
        case id, name, leechers, seeders, size, username, added, status, category, imdb
        case infoHash = "info_hash"
        case numFiles = "num_files"
    }
}
