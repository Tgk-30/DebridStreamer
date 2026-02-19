import Foundation

/// APIBay (The Pirate Bay proxy) indexer for movies and TV shows.
/// Provides broad coverage for both movies and TV including anime.
/// API: https://apibay.org
actor APIBayIndexer: TorrentIndexer {
    let name = "APIBay"
    private let baseURL = "https://apibay.org"
    private let session: URLSession

    init(session: URLSession = .shared) {
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

    func search(imdbId: String, type: MediaType, season: Int?, episode: Int?) async throws -> [TorrentResult] {
        // APIBay search endpoint — use IMDB ID as query
        let cat = type == .movie ? Category.hdMovies.rawValue : Category.hdTV.rawValue
        let url = URL(string: "\(baseURL)/q.php?q=\(imdbId)&cat=\(cat)")!

        let (data, response) = try await session.data(from: url)

        guard let httpResponse = response as? HTTPURLResponse,
              (200...299).contains(httpResponse.statusCode) else {
            return []
        }

        let items = try JSONDecoder().decode([APIBayItem].self, from: data)

        // Filter out the "no results" placeholder
        guard !items.isEmpty, items.first?.name != "No results returned" else {
            return []
        }

        var results: [TorrentResult] = []
        for item in items {
            let hash = item.infoHash
            guard !hash.isEmpty, hash != "0000000000000000000000000000000000000000" else { continue }

            // Filter by season/episode for TV shows
            if type == .series, let season = season, let episode = episode {
                let seasonEpPattern = formatSeasonEpisode(season: season, episode: episode)
                let titleUpper = item.name.uppercased()
                // Check for S01E01 pattern
                if !titleUpper.contains(seasonEpPattern.uppercased()) {
                    // Also check for "Season 1 Episode 1" pattern
                    let altPattern1 = "S\(String(format: "%02d", season))"
                    let altPattern2 = "E\(String(format: "%02d", episode))"
                    if !(titleUpper.contains(altPattern1) && titleUpper.contains(altPattern2)) {
                        continue
                    }
                }
            }

            let seeders = Int(item.seeders) ?? 0
            let leechers = Int(item.leechers) ?? 0
            let sizeBytes = Int64(item.size) ?? 0

            // Skip dead torrents
            guard seeders > 0 else { continue }

            results.append(TorrentResult.fromSearch(
                infoHash: hash,
                title: item.name,
                sizeBytes: sizeBytes,
                seeders: seeders,
                leechers: leechers,
                indexerName: name
            ))
        }

        return results
    }

    func searchByQuery(query: String, type: MediaType) async throws -> [TorrentResult] {
        let encodedQuery = query.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? query
        let cat = type == .movie ? Category.movies.rawValue : Category.tvShows.rawValue
        let url = URL(string: "\(baseURL)/q.php?q=\(encodedQuery)&cat=\(cat)")!

        let (data, response) = try await session.data(from: url)

        guard let httpResponse = response as? HTTPURLResponse,
              (200...299).contains(httpResponse.statusCode) else {
            return []
        }

        let items = try JSONDecoder().decode([APIBayItem].self, from: data)

        guard !items.isEmpty, items.first?.name != "No results returned" else {
            return []
        }

        var results: [TorrentResult] = []
        for item in items {
            let hash = item.infoHash
            guard !hash.isEmpty, hash != "0000000000000000000000000000000000000000" else { continue }

            let seeders = Int(item.seeders) ?? 0
            let leechers = Int(item.leechers) ?? 0
            let sizeBytes = Int64(item.size) ?? 0

            guard seeders > 0 else { continue }

            results.append(TorrentResult.fromSearch(
                infoHash: hash,
                title: item.name,
                sizeBytes: sizeBytes,
                seeders: seeders,
                leechers: leechers,
                indexerName: name
            ))
        }

        return results
    }

    private func formatSeasonEpisode(season: Int, episode: Int) -> String {
        "S\(String(format: "%02d", season))E\(String(format: "%02d", episode))"
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
