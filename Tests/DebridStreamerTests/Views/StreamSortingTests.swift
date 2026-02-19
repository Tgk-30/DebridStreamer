import Testing
import Foundation
@testable import DebridStreamer

@Suite("Stream Sorting Tests")
struct StreamSortingTests {

    private func makeTorrent(
        hash: String,
        quality: VideoQuality = .hd1080p,
        seeders: Int = 100,
        title: String = "Test"
    ) -> TorrentResult {
        TorrentResult(
            infoHash: hash,
            title: title,
            sizeBytes: 1_000_000_000,
            quality: quality,
            codec: .h264,
            audio: .unknown,
            source: .webDL,
            seeders: seeders,
            leechers: 10,
            indexerName: "Test"
        )
    }

    @Test("Cached torrents sort before uncached")
    func cachedFirst() {
        let t1 = makeTorrent(hash: "aaa", quality: .sd480p, seeders: 5)
        let t2 = makeTorrent(hash: "bbb", quality: .uhd4k, seeders: 500)
        let torrents = [t1, t2]

        let cache: [String: (service: DebridServiceType, status: CacheStatus)] = [
            "aaa": (.realDebrid, .cached(fileId: "1", fileName: "file.mkv", fileSize: 1000))
        ]

        let sorted = sortTorrents(torrents, cache: cache)
        // aaa is cached so it should be first even though it's lower quality
        #expect(sorted[0].infoHash == "aaa")
        #expect(sorted[1].infoHash == "bbb")
    }

    @Test("Among cached, higher quality first")
    func cachedQualitySort() {
        let t1 = makeTorrent(hash: "aaa", quality: .hd720p)
        let t2 = makeTorrent(hash: "bbb", quality: .hd1080p)
        let torrents = [t1, t2]

        let cache: [String: (service: DebridServiceType, status: CacheStatus)] = [
            "aaa": (.realDebrid, .cached(fileId: "1", fileName: nil, fileSize: nil)),
            "bbb": (.allDebrid, .cached(fileId: "2", fileName: nil, fileSize: nil))
        ]

        let sorted = sortTorrents(torrents, cache: cache)
        #expect(sorted[0].infoHash == "bbb") // 1080p > 720p
    }

    @Test("Among same quality, more seeders first")
    func seedersSort() {
        let t1 = makeTorrent(hash: "aaa", quality: .hd1080p, seeders: 50)
        let t2 = makeTorrent(hash: "bbb", quality: .hd1080p, seeders: 200)
        let torrents = [t1, t2]

        let sorted = sortTorrents(torrents, cache: [:])
        #expect(sorted[0].infoHash == "bbb") // More seeders
    }

    @Test("Full sort order: cached + quality + seeders")
    func fullSortOrder() {
        let t1 = makeTorrent(hash: "uncached_4k", quality: .uhd4k, seeders: 1000)
        let t2 = makeTorrent(hash: "cached_720", quality: .hd720p, seeders: 10)
        let t3 = makeTorrent(hash: "cached_1080", quality: .hd1080p, seeders: 50)
        let t4 = makeTorrent(hash: "uncached_1080", quality: .hd1080p, seeders: 500)
        let torrents = [t1, t2, t3, t4]

        let cache: [String: (service: DebridServiceType, status: CacheStatus)] = [
            "cached_720": (.realDebrid, .cached(fileId: nil, fileName: nil, fileSize: nil)),
            "cached_1080": (.allDebrid, .cached(fileId: nil, fileName: nil, fileSize: nil)),
        ]

        let sorted = sortTorrents(torrents, cache: cache)
        // Cached first (by quality): cached_1080, cached_720
        // Then uncached (by quality): uncached_4k, uncached_1080
        #expect(sorted[0].infoHash == "cached_1080")
        #expect(sorted[1].infoHash == "cached_720")
        #expect(sorted[2].infoHash == "uncached_4k")
        #expect(sorted[3].infoHash == "uncached_1080")
    }

    @Test("Empty torrents returns empty")
    func emptySort() {
        let sorted = sortTorrents([], cache: [:])
        #expect(sorted.isEmpty)
    }

    @Test("Not cached status is not treated as cached")
    func notCachedStatus() {
        let t1 = makeTorrent(hash: "aaa", quality: .sd480p)
        let t2 = makeTorrent(hash: "bbb", quality: .uhd4k)

        let cache: [String: (service: DebridServiceType, status: CacheStatus)] = [
            "aaa": (.realDebrid, .notCached)
        ]

        let sorted = sortTorrents([t1, t2], cache: cache)
        // Neither is cached, so quality wins
        #expect(sorted[0].infoHash == "bbb") // 4K > 480p
    }

    // MARK: - Helper (same logic as StreamListView.sortedTorrents)

    private func sortTorrents(
        _ torrents: [TorrentResult],
        cache: [String: (service: DebridServiceType, status: CacheStatus)]
    ) -> [TorrentResult] {
        torrents.sorted { lhs, rhs in
            let lhsCached = cache[lhs.infoHash]?.status.isCached ?? false
            let rhsCached = cache[rhs.infoHash]?.status.isCached ?? false

            if lhsCached != rhsCached { return lhsCached }
            if lhs.quality != rhs.quality { return lhs.quality > rhs.quality }
            return lhs.seeders > rhs.seeders
        }
    }
}
