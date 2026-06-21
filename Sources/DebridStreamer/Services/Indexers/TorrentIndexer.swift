import Foundation

/// Protocol for torrent indexers/scrapers.
protocol TorrentIndexer: Sendable {
    /// A human-readable name for this indexer.
    var name: String { get }

    /// Search for torrents matching an IMDB ID.
    func search(imdbId: String, type: MediaType, season: Int?, episode: Int?) async throws -> [TorrentResult]

    /// Search for torrents by text query (fallback when no IMDB ID).
    func searchByQuery(query: String, type: MediaType) async throws -> [TorrentResult]
}

/// Default implementation for searchByQuery (optional override).
extension TorrentIndexer {
    func searchByQuery(query: String, type: MediaType) async throws -> [TorrentResult] {
        return []
    }
}

/// Manages multiple indexers and aggregates results.
actor IndexerManager {
    private var indexers: [TorrentIndexer] = []

    /// Errors from the last search (for diagnostics).
    private(set) var lastSearchErrors: [(indexer: String, error: String)] = []

    init(configs: [IndexerConfig] = []) {
        indexers = IndexerFactory.buildIndexers(from: configs)
    }

    func addIndexer(_ indexer: TorrentIndexer) {
        indexers.append(indexer)
    }

    func setIndexers(_ newIndexers: [TorrentIndexer]) {
        indexers = newIndexers
    }

    func configure(with configs: [IndexerConfig]) {
        indexers = IndexerFactory.buildIndexers(from: configs)
    }

    var activeIndexers: [String] {
        indexers.map(\.name)
    }

    /// Search all active indexers concurrently and merge results.
    func searchAll(imdbId: String, type: MediaType, season: Int? = nil, episode: Int? = nil) async -> [TorrentResult] {
        var allResults: [TorrentResult] = []
        var errors: [(indexer: String, error: String)] = []

        await withTaskGroup(of: (String, Result<[TorrentResult], Error>).self) { group in
            for indexer in indexers {
                group.addTask {
                    do {
                        let results = try await indexer.search(
                            imdbId: imdbId,
                            type: type,
                            season: season,
                            episode: episode
                        )
                        return (indexer.name, .success(results))
                    } catch {
                        return (indexer.name, .failure(error))
                    }
                }
            }

            for await (indexerName, result) in group {
                switch result {
                case .success(let results):
                    allResults.append(contentsOf: results)
                case .failure(let error):
                    errors.append((indexer: indexerName, error: error.localizedDescription))
                    #if DEBUG
                    print("[IndexerManager] \(indexerName) error: \(error)")
                    #endif
                }
            }
        }

        lastSearchErrors = errors

        if allResults.isEmpty {
            #if DEBUG
            print("[IndexerManager] IMDB search returned 0, errors: \(errors.map(\.indexer))")
            #endif
        }

        return deduplicateAndSort(allResults)
    }

    /// Search by text query across all indexers.
    func searchByQuery(_ query: String, type: MediaType) async -> [TorrentResult] {
        var allResults: [TorrentResult] = []
        var errors: [(indexer: String, error: String)] = []

        await withTaskGroup(of: (String, Result<[TorrentResult], Error>).self) { group in
            for indexer in indexers {
                group.addTask {
                    do {
                        let results = try await indexer.searchByQuery(query: query, type: type)
                        return (indexer.name, .success(results))
                    } catch {
                        return (indexer.name, .failure(error))
                    }
                }
            }

            for await (indexerName, result) in group {
                switch result {
                case .success(let results):
                    allResults.append(contentsOf: results)
                case .failure(let error):
                    errors.append((indexer: indexerName, error: error.localizedDescription))
                    #if DEBUG
                    print("[IndexerManager] \(indexerName) searchByQuery error: \(error)")
                    #endif
                }
            }
        }

        lastSearchErrors = errors
        return deduplicateAndSort(allResults)
    }

    /// Deduplicate by infoHash (preferring higher seeders) and sort by quality then seeders.
    private func deduplicateAndSort(_ results: [TorrentResult]) -> [TorrentResult] {
        let grouped = Dictionary(grouping: results, by: \.infoHash)
        return grouped.values.compactMap { group in
            group.max(by: { $0.seeders < $1.seeders })
        }.sorted { lhs, rhs in
            if lhs.quality != rhs.quality {
                return lhs.quality > rhs.quality
            }
            return lhs.seeders > rhs.seeders
        }
    }
}
