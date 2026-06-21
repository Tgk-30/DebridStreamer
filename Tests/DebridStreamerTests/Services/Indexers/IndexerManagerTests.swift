import Testing
import Foundation
@testable import DebridStreamer

/// Tests for `IndexerManager`'s aggregation behavior: deduplicating by infoHash
/// (keeping the higher-seeder copy), ordering by quality-then-seeders, and
/// capturing per-indexer errors into `lastSearchErrors` without aborting the
/// merged results from the indexers that succeeded.
@Suite("IndexerManager dedup/sort tests")
struct IndexerManagerDedupSortTests {

    // MARK: - Fixtures

    /// A canned `TorrentResult` built via the memberwise initializer so the test
    /// controls `quality` and `seeders` exactly (rather than parsing a title).
    private func makeResult(
        infoHash: String,
        title: String = "Some.Release.1080p",
        quality: VideoQuality,
        seeders: Int,
        indexerName: String
    ) -> TorrentResult {
        TorrentResult(
            infoHash: infoHash,
            title: title,
            sizeBytes: 1_000_000,
            quality: quality,
            codec: .unknown,
            audio: .unknown,
            source: .unknown,
            seeders: seeders,
            leechers: 0,
            indexerName: indexerName,
            magnetURI: nil
        )
    }

    /// A configurable stub indexer: returns its canned results for both
    /// `search` and `searchByQuery`, or throws a fixed error when `error` is set.
    private struct StubIndexer: TorrentIndexer {
        let name: String
        var results: [TorrentResult] = []
        var error: (any Error)? = nil

        func search(imdbId: String, type: MediaType, season: Int?, episode: Int?) async throws -> [TorrentResult] {
            if let error { throw error }
            return results
        }

        func searchByQuery(query: String, type: MediaType) async throws -> [TorrentResult] {
            if let error { throw error }
            return results
        }
    }

    private struct StubIndexerError: Error, Equatable {
        let message: String
    }

    // MARK: - Deduplication

    @Test("searchAll keeps the higher-seeder copy of a duplicate infoHash")
    func deduplicateKeepsHigherSeeders() async {
        let dupHash = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
        // Same infoHash from two indexers, different seeder counts.
        let lowSeed = makeResult(infoHash: dupHash, quality: .hd1080p, seeders: 5, indexerName: "Low")
        let highSeed = makeResult(infoHash: dupHash, quality: .hd1080p, seeders: 42, indexerName: "High")

        let manager = IndexerManager()
        await manager.setIndexers([
            StubIndexer(name: "Low", results: [lowSeed]),
            StubIndexer(name: "High", results: [highSeed])
        ])

        let merged = await manager.searchAll(imdbId: "tt0001", type: .movie)

        // Only one survivor for the shared hash, and it must be the 42-seeder copy.
        #expect(merged.count == 1)
        #expect(merged.first?.infoHash == dupHash)
        #expect(merged.first?.seeders == 42)
        #expect(merged.first?.indexerName == "High")
    }

    // MARK: - Ordering

    @Test("searchAll orders by quality first, then seeders within a quality tier")
    func ordersByQualityThenSeeders() async {
        // Distinct infoHashes so nothing is deduplicated.
        let uhd = makeResult(infoHash: "1111111111111111111111111111111111111111", quality: .uhd4k, seeders: 1, indexerName: "A")
        let hd1080Low = makeResult(infoHash: "2222222222222222222222222222222222222222", quality: .hd1080p, seeders: 3, indexerName: "A")
        let hd1080High = makeResult(infoHash: "3333333333333333333333333333333333333333", quality: .hd1080p, seeders: 99, indexerName: "A")
        let hd720 = makeResult(infoHash: "4444444444444444444444444444444444444444", quality: .hd720p, seeders: 500, indexerName: "A")

        let manager = IndexerManager()
        // Provide them out of order to prove the sort actually runs.
        await manager.setIndexers([
            StubIndexer(name: "A", results: [hd720, hd1080Low, uhd, hd1080High])
        ])

        let merged = await manager.searchAll(imdbId: "tt0002", type: .movie)

        #expect(merged.count == 4)
        // 4K beats everything regardless of its low seeder count.
        #expect(merged[0].quality == .uhd4k)
        // Within 1080p, the higher-seeder copy comes first.
        #expect(merged[1].quality == .hd1080p)
        #expect(merged[1].seeders == 99)
        #expect(merged[2].quality == .hd1080p)
        #expect(merged[2].seeders == 3)
        // 720p comes last even though it has the most seeders overall.
        #expect(merged[3].quality == .hd720p)
        #expect(merged[3].seeders == 500)
    }

    // MARK: - Error capture without aborting

    @Test("searchAll records a throwing indexer in lastSearchErrors without dropping good results")
    func throwingIndexerIsCapturedButResultsSurvive() async {
        let good = makeResult(infoHash: "5555555555555555555555555555555555555555", quality: .hd1080p, seeders: 10, indexerName: "Good")

        let manager = IndexerManager()
        await manager.setIndexers([
            StubIndexer(name: "Good", results: [good]),
            StubIndexer(name: "Broken", error: StubIndexerError(message: "boom"))
        ])

        let merged = await manager.searchAll(imdbId: "tt0003", type: .movie)

        // The good indexer's result must still come through.
        #expect(merged.count == 1)
        #expect(merged.first?.indexerName == "Good")

        // The failure must be recorded against the failing indexer's name.
        let errors = await manager.lastSearchErrors
        #expect(errors.count == 1)
        #expect(errors.first?.indexer == "Broken")
        #expect(errors.first?.error.isEmpty == false)
    }

    @Test("a fully successful searchAll clears lastSearchErrors")
    func successfulSearchHasNoErrors() async {
        let good = makeResult(infoHash: "6666666666666666666666666666666666666666", quality: .hd720p, seeders: 7, indexerName: "Good")

        let manager = IndexerManager()
        await manager.setIndexers([StubIndexer(name: "Good", results: [good])])

        _ = await manager.searchAll(imdbId: "tt0004", type: .movie)

        let errors = await manager.lastSearchErrors
        #expect(errors.isEmpty)
    }

    // MARK: - searchByQuery

    @Test("searchByQuery dedups, sorts, and captures errors just like searchAll")
    func searchByQueryDedupSortAndErrors() async {
        let dupHash = "7777777777777777777777777777777777777777"
        let lowSeed = makeResult(infoHash: dupHash, quality: .hd1080p, seeders: 2, indexerName: "Low")
        let highSeed = makeResult(infoHash: dupHash, quality: .hd1080p, seeders: 80, indexerName: "High")
        let uniqueUHD = makeResult(infoHash: "8888888888888888888888888888888888888888", quality: .uhd4k, seeders: 1, indexerName: "High")

        let manager = IndexerManager()
        await manager.setIndexers([
            StubIndexer(name: "Low", results: [lowSeed]),
            StubIndexer(name: "High", results: [highSeed, uniqueUHD]),
            StubIndexer(name: "Broken", error: StubIndexerError(message: "kaput"))
        ])

        let merged = await manager.searchByQuery("the matrix", type: .movie)

        // Two survivors: deduped 1080p (higher seeders kept) + the 4K.
        #expect(merged.count == 2)
        // 4K sorts ahead of 1080p.
        #expect(merged[0].quality == .uhd4k)
        #expect(merged[1].quality == .hd1080p)
        #expect(merged[1].seeders == 80)

        let errors = await manager.lastSearchErrors
        #expect(errors.count == 1)
        #expect(errors.first?.indexer == "Broken")
    }

    // MARK: - setIndexers seam

    @Test("setIndexers replaces the active indexer set")
    func setIndexersReplacesActiveSet() async {
        let manager = IndexerManager()
        await manager.setIndexers([
            StubIndexer(name: "First"),
            StubIndexer(name: "Second")
        ])

        let active = await manager.activeIndexers
        #expect(active == ["First", "Second"])
    }
}
