import Foundation

/// A subtitle track for a media item.
struct Subtitle: Codable, Sendable, Identifiable, Equatable {
    var id: String
    var language: String         // ISO 639-1 code (en, es, fr, etc.)
    var languageName: String     // Full name (English, Spanish, French)
    var url: String              // Download URL
    var format: SubtitleFormat
    var source: String           // OpenSubtitles, etc.
    var rating: Double?

    var downloadURL: URL? {
        URL(string: url)
    }

    enum SubtitleFormat: String, Codable, Sendable {
        case srt
        case vtt
        case ass
        case ssa
        case unknown

        static func parse(from filename: String) -> SubtitleFormat {
            let ext = (filename as NSString).pathExtension.lowercased()
            switch ext {
            case "srt": return .srt
            case "vtt", "webvtt": return .vtt
            case "ass": return .ass
            case "ssa": return .ssa
            default: return .unknown
            }
        }
    }
}
