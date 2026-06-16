import Foundation

/// The type of media content.
enum MediaType: String, Codable, Sendable, CaseIterable {
    case movie
    case series

    var displayName: String {
        switch self {
        case .movie: return "Movie"
        case .series: return "TV Show"
        }
    }

    /// TMDB API path segment.
    var tmdbPath: String {
        switch self {
        case .movie: return "movie"
        case .series: return "tv"
        }
    }
}

/// Matches `token` only when delimited by non-alphanumeric boundaries (or string ends),
/// so ambiguous short tokens like "ts"/"sd"/"cam" don't match when embedded inside words.
func mediaTokenMatch(_ haystack: String, _ token: String) -> Bool {
    haystack.range(
        of: "(?<![a-z0-9])\(token)(?![a-z0-9])",
        options: .regularExpression
    ) != nil
}

/// Video quality tier parsed from torrent filenames.
enum VideoQuality: String, Codable, Sendable, Comparable, CaseIterable {
    case uhd4k = "4K"
    case hd1080p = "1080p"
    case hd720p = "720p"
    case sd480p = "480p"
    case sdOther = "SD"
    case unknown = "Unknown"

    var sortOrder: Int {
        switch self {
        case .uhd4k: return 5
        case .hd1080p: return 4
        case .hd720p: return 3
        case .sd480p: return 2
        case .sdOther: return 1
        case .unknown: return 0
        }
    }

    static func < (lhs: VideoQuality, rhs: VideoQuality) -> Bool {
        lhs.sortOrder < rhs.sortOrder
    }

    /// Parse quality from a torrent filename.
    static func parse(from filename: String) -> VideoQuality {
        let lower = filename.lowercased()
        if lower.contains("2160p") || lower.contains("4k") || lower.contains("uhd") {
            return .uhd4k
        } else if lower.contains("1080p") || lower.contains("1080i") {
            return .hd1080p
        } else if lower.contains("720p") {
            return .hd720p
        } else if lower.contains("480p") {
            return .sd480p
        } else if mediaTokenMatch(lower, "sd") || lower.contains("dvdrip") || lower.contains("hdtv") {
            return .sdOther
        }
        return .unknown
    }
}

/// Video codec parsed from torrent filenames.
enum VideoCodec: String, Codable, Sendable {
    case h264 = "H.264"
    case h265 = "H.265"
    case av1 = "AV1"
    case xvid = "XviD"
    case unknown = "Unknown"

    static func parse(from filename: String) -> VideoCodec {
        let lower = filename.lowercased()
        if lower.contains("x265") || lower.contains("h265") || lower.contains("hevc") || lower.contains("h.265") {
            return .h265
        } else if lower.contains("x264") || lower.contains("h264") || lower.contains("avc") || lower.contains("h.264") {
            return .h264
        } else if lower.contains("av1") {
            return .av1
        } else if lower.contains("xvid") || lower.contains("divx") {
            return .xvid
        }
        return .unknown
    }
}

/// Audio format parsed from torrent filenames.
enum AudioFormat: String, Codable, Sendable {
    case atmos = "Atmos"
    case dtsHDMA = "DTS-HD MA"
    case dtsX = "DTS:X"
    case trueHD = "TrueHD"
    case dts = "DTS"
    case ac3 = "AC3"
    case aac = "AAC"
    case unknown = "Unknown"

    static func parse(from filename: String) -> AudioFormat {
        let lower = filename.lowercased()
        if lower.contains("atmos") {
            return .atmos
        } else if lower.contains("dts-hd") || lower.contains("dts.hd") {
            return .dtsHDMA
        } else if lower.contains("dts-x") || lower.contains("dts:x") {
            return .dtsX
        } else if lower.contains("truehd") || lower.contains("true-hd") {
            return .trueHD
        } else if lower.contains("dts") {
            return .dts
        } else if lower.contains("dd5") || lower.contains("ac3") || lower.contains("dolby digital") || lower.contains("dd+") || lower.contains("ddp") || lower.contains("eac3") {
            return .ac3
        } else if lower.contains("aac") {
            return .aac
        }
        return .unknown
    }
}

/// Source type parsed from torrent filenames.
enum SourceType: String, Codable, Sendable {
    case bluray = "BluRay"
    case webDL = "WEB-DL"
    case webRip = "WEBRip"
    case hdRip = "HDRip"
    case dvdRip = "DVDRip"
    case hdtv = "HDTV"
    case cam = "CAM"
    case unknown = "Unknown"

    static func parse(from filename: String) -> SourceType {
        let lower = filename.lowercased()
        if lower.contains("bluray") || lower.contains("blu-ray") || lower.contains("bdrip") || lower.contains("brrip") {
            return .bluray
        } else if lower.contains("web-dl") || lower.contains("webdl") {
            return .webDL
        } else if lower.contains("webrip") || lower.contains("web-rip") {
            return .webRip
        } else if lower.contains("hdrip") {
            return .hdRip
        } else if lower.contains("dvdrip") || lower.contains("dvd-rip") {
            return .dvdRip
        } else if lower.contains("hdtv") {
            return .hdtv
        } else if mediaTokenMatch(lower, "cam") || lower.contains("hdcam") || mediaTokenMatch(lower, "ts") || lower.contains("telesync") {
            return .cam
        }
        return .unknown
    }
}
