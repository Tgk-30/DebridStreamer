import Foundation
import GRDB

/// A torrent search result from an indexer.
struct TorrentResult: Codable, Sendable, Identifiable, Equatable {
    var id: String { infoHash }
    var infoHash: String
    var title: String
    var sizeBytes: Int64
    var quality: VideoQuality
    var codec: VideoCodec
    var audio: AudioFormat
    var source: SourceType
    var seeders: Int
    var leechers: Int
    var indexerName: String       // Which indexer found this
    var magnetURI: String?

    /// Whether this torrent is cached on a debrid service.
    var isCached: Bool = false
    /// Which debrid service has it cached.
    var cachedOn: String?

    var sizeString: String {
        let formatter = ByteCountFormatter()
        formatter.countStyle = .file
        return formatter.string(fromByteCount: sizeBytes)
    }

    var qualityLabel: String {
        var parts: [String] = []
        if quality != .unknown { parts.append(quality.rawValue) }
        if codec != .unknown { parts.append(codec.rawValue) }
        if source != .unknown { parts.append(source.rawValue) }
        if audio != .unknown { parts.append(audio.rawValue) }
        return parts.isEmpty ? "Unknown" : parts.joined(separator: " · ")
    }

    /// Parse quality/codec/audio/source from the torrent title.
    static func fromSearch(
        infoHash: String,
        title: String,
        sizeBytes: Int64,
        seeders: Int,
        leechers: Int,
        indexerName: String,
        magnetURI: String? = nil
    ) -> TorrentResult {
        TorrentResult(
            infoHash: infoHash.lowercased(),
            title: title,
            sizeBytes: sizeBytes,
            quality: VideoQuality.parse(from: title),
            codec: VideoCodec.parse(from: title),
            audio: AudioFormat.parse(from: title),
            source: SourceType.parse(from: title),
            seeders: seeders,
            leechers: leechers,
            indexerName: indexerName,
            magnetURI: magnetURI
        )
    }
}

/// Cached torrent info stored in the database.
struct CachedTorrent: Codable, Sendable, Identifiable, Equatable, FetchableRecord, PersistableRecord {
    static let databaseTableName = "torrent_cache"

    var id: String { infoHash }
    var infoHash: String
    var mediaId: String
    var title: String
    var sizeBytes: Int64?
    var quality: String?
    var source: String?
    var seeders: Int?
    var codec: String?
    var audio: String?
    var cachedOnDebrid: Bool
    var lastChecked: Date

    enum Columns: String, ColumnExpression {
        case infoHash, mediaId, title, sizeBytes, quality
        case source, seeders, codec, audio, cachedOnDebrid, lastChecked
    }

    func encode(to container: inout PersistenceContainer) {
        container[Columns.infoHash] = infoHash
        container[Columns.mediaId] = mediaId
        container[Columns.title] = title
        container[Columns.sizeBytes] = sizeBytes
        container[Columns.quality] = quality
        container[Columns.source] = source
        container[Columns.seeders] = seeders
        container[Columns.codec] = codec
        container[Columns.audio] = audio
        container[Columns.cachedOnDebrid] = cachedOnDebrid
        container[Columns.lastChecked] = lastChecked
    }
}
