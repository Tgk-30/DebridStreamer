import Foundation

/// EZTV API indexer for TV shows.
/// API docs: https://eztv.re/api/
/// EZTV is a curated TV show torrent source.
actor EZTVIndexer: TorrentIndexer {
    let name = "EZTV"
    private let baseURL = "https://eztvx.to/api"
    private let session: URLSession

    init(session: URLSession = .shared) {
        self.session = session
    }

    func search(imdbId: String, type: MediaType, season: Int?, episode: Int?) async throws -> [TorrentResult] {
        // EZTV only has TV shows
        guard type == .series else { return [] }

        // EZTV uses IMDB numeric ID without "tt" prefix
        let numericId = imdbId.replacingOccurrences(of: "tt", with: "")
        guard !numericId.isEmpty else { return [] }

        var results: [TorrentResult] = []
        var page = 1
        let maxPages = 3 // Limit pages to avoid excessive requests

        while page <= maxPages {
            let url = URL(string: "\(baseURL)/get-torrents?imdb_id=\(numericId)&page=\(page)&limit=100")!
            var request = URLRequest(url: url)
            request.timeoutInterval = 20
            let (data, response) = try await session.data(for: request)

            guard let httpResponse = response as? HTTPURLResponse,
                  (200...299).contains(httpResponse.statusCode) else {
                throw URLError(.badServerResponse)
            }

            let decoder = JSONDecoder()
            decoder.keyDecodingStrategy = .convertFromSnakeCase
            let eztvResponse = try decoder.decode(EZTVResponse.self, from: data)

            guard let torrents = eztvResponse.torrents, !torrents.isEmpty else { break }

            for torrent in torrents {
                guard let hash = torrent.hash, !hash.isEmpty else { continue }

                // Filter by season/episode if specified
                if let season = season, let torrentSeason = torrent.season {
                    let seasonStr = String(torrentSeason)
                    guard seasonStr == String(season) else { continue }
                }
                if let episode = episode, let torrentEpisode = torrent.episode {
                    let episodeStr = String(torrentEpisode)
                    guard episodeStr == String(episode) else { continue }
                }

                let title = torrent.title ?? torrent.filename ?? "Unknown"
                let sizeBytes = torrent.sizeBytes.flatMap { Int64($0) } ?? 0

                results.append(TorrentResult.fromSearch(
                    infoHash: hash,
                    title: title,
                    sizeBytes: sizeBytes,
                    seeders: torrent.seeds ?? 0,
                    leechers: torrent.peers ?? 0,
                    indexerName: name,
                    magnetURI: torrent.magnetUrl
                ))
            }

            // Check if there are more pages
            if torrents.count < 100 {
                break
            }
            page += 1
        }

        return results
    }
    func searchByQuery(query: String, type: MediaType) async throws -> [TorrentResult] {
        guard type == .series else { return [] }

        let encodedQuery = query.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? query
        let url = URL(string: "\(baseURL)/get-torrents?search=\(encodedQuery)&limit=100")!

        var request = URLRequest(url: url)
        request.timeoutInterval = 20
        let (data, response) = try await session.data(for: request)

        guard let httpResponse = response as? HTTPURLResponse,
              (200...299).contains(httpResponse.statusCode) else {
            throw URLError(.badServerResponse)
        }

        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        let eztvResponse = try decoder.decode(EZTVResponse.self, from: data)

        guard let torrents = eztvResponse.torrents, !torrents.isEmpty else { return [] }

        var results: [TorrentResult] = []
        for torrent in torrents {
            guard let hash = torrent.hash, !hash.isEmpty else { continue }

            let title = torrent.title ?? torrent.filename ?? "Unknown"
            let sizeBytes = torrent.sizeBytes.flatMap { Int64($0) } ?? 0

            results.append(TorrentResult.fromSearch(
                infoHash: hash,
                title: title,
                sizeBytes: sizeBytes,
                seeders: torrent.seeds ?? 0,
                leechers: torrent.peers ?? 0,
                indexerName: name,
                magnetURI: torrent.magnetUrl
            ))
        }

        return results
    }
}

// MARK: - EZTV API Models

struct EZTVResponse: Decodable {
    let torrentsCount: Int?
    let page: Int?
    let torrents: [EZTVTorrent]?
}

struct EZTVTorrent: Decodable {
    let id: Int?
    let hash: String?
    let filename: String?
    let title: String?
    let season: String?
    let episode: String?
    let seeds: Int?
    let peers: Int?
    let sizeBytes: String?
    let magnetUrl: String?
}
