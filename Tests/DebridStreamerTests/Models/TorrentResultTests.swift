import Testing
import Foundation
@testable import DebridStreamer

@Suite("TorrentResult Tests")
struct TorrentResultTests {
    @Test("TorrentResult.fromSearch parses quality correctly")
    func fromSearchParsesQuality() {
        let result = TorrentResult.fromSearch(
            infoHash: "ABC123DEF456",
            title: "Movie.2024.1080p.BluRay.x265.DTS-HD.MA-GROUP",
            sizeBytes: 5_000_000_000,
            seeders: 150,
            leechers: 10,
            indexerName: "YTS"
        )

        #expect(result.quality == .hd1080p)
        #expect(result.codec == .h265)
        #expect(result.audio == .dtsHDMA)
        #expect(result.source == .bluray)
        #expect(result.infoHash == "abc123def456") // lowercased
        #expect(result.indexerName == "YTS")
        #expect(result.seeders == 150)
        #expect(result.leechers == 10)
    }

    @Test("TorrentResult.fromSearch parses 4K WEB-DL")
    func fromSearch4K() {
        let result = TorrentResult.fromSearch(
            infoHash: "HASH123",
            title: "Movie.2024.2160p.WEB-DL.x265.Atmos",
            sizeBytes: 15_000_000_000,
            seeders: 50,
            leechers: 5,
            indexerName: "EZTV"
        )

        #expect(result.quality == .uhd4k)
        #expect(result.codec == .h265)
        #expect(result.audio == .atmos)
        #expect(result.source == .webDL)
    }

    @Test("TorrentResult size string formatting")
    func sizeString() {
        let small = TorrentResult.fromSearch(
            infoHash: "h1", title: "test", sizeBytes: 700_000_000,
            seeders: 1, leechers: 0, indexerName: "test"
        )
        #expect(small.sizeString.contains("MB") || small.sizeString.contains("700"))

        let large = TorrentResult.fromSearch(
            infoHash: "h2", title: "test", sizeBytes: 5_000_000_000,
            seeders: 1, leechers: 0, indexerName: "test"
        )
        #expect(large.sizeString.contains("GB") || large.sizeString.contains("5"))
    }

    @Test("TorrentResult quality label")
    func qualityLabel() {
        let result = TorrentResult.fromSearch(
            infoHash: "h1",
            title: "Movie.1080p.BluRay.x264.DTS",
            sizeBytes: 5_000_000_000,
            seeders: 100,
            leechers: 10,
            indexerName: "YTS"
        )

        let label = result.qualityLabel
        #expect(label.contains("1080p"))
        #expect(label.contains("H.264"))
        #expect(label.contains("BluRay"))
        #expect(label.contains("DTS"))
    }

    @Test("TorrentResult quality label for unknown values")
    func qualityLabelUnknown() {
        let result = TorrentResult.fromSearch(
            infoHash: "h1", title: "Some.Random.File",
            sizeBytes: 1000, seeders: 0, leechers: 0, indexerName: "test"
        )
        #expect(result.qualityLabel == "Unknown")
    }

    @Test("TorrentResult id is infoHash")
    func idIsInfoHash() {
        let result = TorrentResult.fromSearch(
            infoHash: "ABCDEF123456",
            title: "Test", sizeBytes: 0, seeders: 0, leechers: 0, indexerName: "test"
        )
        #expect(result.id == "abcdef123456")
    }

    @Test("TorrentResult isCached default is false")
    func defaultNotCached() {
        let result = TorrentResult.fromSearch(
            infoHash: "h1", title: "Test", sizeBytes: 0, seeders: 0, leechers: 0, indexerName: "test"
        )
        #expect(result.isCached == false)
        #expect(result.cachedOn == nil)
    }

    @Test("TorrentResult equality by all fields")
    func equality() {
        let a = TorrentResult.fromSearch(
            infoHash: "HASH1", title: "Movie", sizeBytes: 1000, seeders: 10, leechers: 1, indexerName: "YTS"
        )
        let b = TorrentResult.fromSearch(
            infoHash: "HASH1", title: "Movie", sizeBytes: 1000, seeders: 10, leechers: 1, indexerName: "YTS"
        )
        #expect(a == b)
    }
}

@Suite("CacheStatus Tests")
struct CacheStatusTests {
    @Test("CacheStatus.cached is cached")
    func cachedIsCached() {
        let status = CacheStatus.cached(fileId: "1", fileName: "movie.mkv", fileSize: 5_000_000_000)
        #expect(status.isCached == true)
    }

    @Test("CacheStatus.notCached is not cached")
    func notCachedIsNotCached() {
        #expect(CacheStatus.notCached.isCached == false)
    }

    @Test("CacheStatus.unknown is not cached")
    func unknownIsNotCached() {
        #expect(CacheStatus.unknown.isCached == false)
    }
}
