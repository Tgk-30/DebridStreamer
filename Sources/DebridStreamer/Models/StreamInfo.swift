import Foundation

/// A resolved stream ready for playback.
struct StreamInfo: Codable, Sendable, Identifiable, Equatable {
    var id: String { streamURL }
    var streamURL: String        // Direct HTTPS URL from debrid
    var quality: VideoQuality
    var codec: VideoCodec
    var audio: AudioFormat
    var source: SourceType
    var sizeBytes: Int64
    var fileName: String
    var debridService: String    // Which debrid resolved it

    var url: URL? {
        URL(string: streamURL)
    }

    var qualityLabel: String {
        var parts: [String] = []
        parts.append("[\(debridService)]")
        if quality != .unknown { parts.append(quality.rawValue) }
        if codec != .unknown { parts.append(codec.rawValue) }
        if source != .unknown { parts.append(source.rawValue) }
        return parts.joined(separator: " ")
    }

    var sizeString: String {
        let formatter = ByteCountFormatter()
        formatter.countStyle = .file
        return formatter.string(fromByteCount: sizeBytes)
    }
}

/// Status of a torrent hash on a debrid service.
enum CacheStatus: Sendable, Equatable {
    case cached(fileId: String?, fileName: String?, fileSize: Int64?)
    case notCached
    case unknown

    var isCached: Bool {
        if case .cached = self { return true }
        return false
    }
}
