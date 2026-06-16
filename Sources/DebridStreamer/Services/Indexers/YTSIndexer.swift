import Foundation

/// YTS.mx API indexer for movies.
/// API docs: https://yts.mx/api
/// YTS is a curated movie torrent source with clean, well-structured API responses.
actor YTSIndexer: TorrentIndexer {
    let name = "YTS"
    private let baseURL = "https://yts.torrentbay.st/api/v2"
    private let session: URLSession
    private let decoder: JSONDecoder = {
        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        return decoder
    }()

    init(session: URLSession = AppHTTP.api) {
        self.session = session
    }

    func search(imdbId: String, type: MediaType, season: Int?, episode: Int?) async throws -> [TorrentResult] {
        // YTS only has movies
        guard type == .movie else { return [] }

        let url = URL(string: "\(baseURL)/list_movies.json?query_term=\(imdbId)")!
        var request = URLRequest(url: url)
        request.timeoutInterval = 20
        let (data, response) = try await session.data(for: request)

        guard let httpResponse = response as? HTTPURLResponse,
              (200...299).contains(httpResponse.statusCode) else {
            throw URLError(.badServerResponse)
        }

        let ytsResponse = try decoder.decode(YTSResponse.self, from: data)

        guard let movies = ytsResponse.data.movies, !movies.isEmpty else {
            return []
        }

        var results: [TorrentResult] = []

        for movie in movies {
            guard let torrents = movie.torrents else { continue }
            for torrent in torrents {
                guard let hash = torrent.hash, !hash.isEmpty else { continue }

                let title = "\(movie.titleLong ?? movie.title ?? "Unknown") [\(torrent.quality ?? "?")] [\(torrent.type ?? "")]"
                let sizeBytes = torrent.sizeBytes ?? 0

                results.append(TorrentResult.fromSearch(
                    infoHash: hash,
                    title: title,
                    sizeBytes: sizeBytes,
                    seeders: torrent.seeds ?? 0,
                    leechers: torrent.peers ?? 0,
                    indexerName: name
                ))
            }
        }

        return results
    }

    func searchByQuery(query: String, type: MediaType) async throws -> [TorrentResult] {
        guard type == .movie else { return [] }

        let encodedQuery = query.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? query
        let url = URL(string: "\(baseURL)/list_movies.json?query_term=\(encodedQuery)&limit=20")!
        var request = URLRequest(url: url)
        request.timeoutInterval = 20
        let (data, response) = try await session.data(for: request)

        guard let httpResponse = response as? HTTPURLResponse,
              (200...299).contains(httpResponse.statusCode) else {
            throw URLError(.badServerResponse)
        }

        let ytsResponse = try decoder.decode(YTSResponse.self, from: data)

        guard let movies = ytsResponse.data.movies else { return [] }

        var results: [TorrentResult] = []
        for movie in movies {
            guard let torrents = movie.torrents else { continue }
            for torrent in torrents {
                guard let hash = torrent.hash, !hash.isEmpty else { continue }
                let title = "\(movie.titleLong ?? movie.title ?? "Unknown") [\(torrent.quality ?? "?")] [\(torrent.type ?? "")]"
                results.append(TorrentResult.fromSearch(
                    infoHash: hash,
                    title: title,
                    sizeBytes: torrent.sizeBytes ?? 0,
                    seeders: torrent.seeds ?? 0,
                    leechers: torrent.peers ?? 0,
                    indexerName: name
                ))
            }
        }

        return results
    }
}

// MARK: - YTS API Models

struct YTSResponse: Decodable {
    let status: String
    let data: YTSData
}

struct YTSData: Decodable {
    let movieCount: Int?
    let movies: [YTSMovie]?
}

struct YTSMovie: Decodable {
    let id: Int?
    let title: String?
    let titleLong: String?
    let year: Int?
    let imdbCode: String?
    let torrents: [YTSTorrent]?
}

struct YTSTorrent: Decodable {
    let hash: String?
    let quality: String?
    let type: String?
    let seeds: Int?
    let peers: Int?
    let size: String?
    let sizeBytes: Int64?
}
