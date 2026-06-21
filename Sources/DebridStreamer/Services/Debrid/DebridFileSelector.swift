import Foundation

/// File candidate returned by debrid services.
struct DebridFileCandidate: Sendable, Equatable {
    let link: String
    let fileName: String
    let sizeBytes: Int64
}

/// Picks the best streamable file out of a debrid response.
enum DebridFileSelector {
    private static let videoExtensions: Set<String> = [
        "mkv", "mp4", "m4v", "mov", "avi", "webm", "ts", "m2ts", "mpg", "mpeg", "wmv", "flv"
    ]

    private static let audioExtensions: Set<String> = [
        "aac", "ac3", "dts", "eac3", "flac", "m4a", "mka", "mp3", "ogg", "opus", "wav", "wma"
    ]

    private static let sampleHints: [String] = [
        "sample", "trailer", "featurette", "extras", "behindthescenes", "commentary", "soundtrack"
    ]

    static func selectBest(from candidates: [DebridFileCandidate]) -> DebridFileCandidate? {
        guard !candidates.isEmpty else { return nil }

        return candidates.max { lhs, rhs in
            compare(lhs, rhs) < 0
        }
    }

    private static func compare(_ lhs: DebridFileCandidate, _ rhs: DebridFileCandidate) -> Int {
        let lhsMeta = meta(lhs)
        let rhsMeta = meta(rhs)

        if lhsMeta.isVideo != rhsMeta.isVideo {
            return lhsMeta.isVideo ? 1 : -1
        }

        if lhsMeta.isSample != rhsMeta.isSample {
            return lhsMeta.isSample ? -1 : 1
        }

        // Prefer containers that AVPlayer handles more reliably.
        if lhsMeta.containerScore != rhsMeta.containerScore {
            return lhsMeta.containerScore > rhsMeta.containerScore ? 1 : -1
        }

        // Prefer more compatible codecs when identifiable.
        if lhsMeta.codecScore != rhsMeta.codecScore {
            return lhsMeta.codecScore > rhsMeta.codecScore ? 1 : -1
        }

        if lhs.sizeBytes != rhs.sizeBytes {
            return lhs.sizeBytes > rhs.sizeBytes ? 1 : -1
        }

        if lhs.fileName.count != rhs.fileName.count {
            return lhs.fileName.count > rhs.fileName.count ? 1 : -1
        }

        return lhs.fileName > rhs.fileName ? 1 : -1
    }

    private static func meta(_ candidate: DebridFileCandidate) -> (isVideo: Bool, isSample: Bool, containerScore: Int, codecScore: Int) {
        let effectiveName = normalizedName(for: candidate)
        let lower = effectiveName.lowercased()
        let ext = URL(fileURLWithPath: effectiveName).pathExtension.lowercased()

        let isVideo = videoExtensions.contains(ext) && !audioExtensions.contains(ext)
        let isSample = sampleHints.contains { lower.contains($0) }
        let containerScore = containerCompatibilityScore(ext: ext)
        let codecScore = codecCompatibilityScore(fileName: lower)

        return (isVideo, isSample, containerScore, codecScore)
    }

    private static func normalizedName(for candidate: DebridFileCandidate) -> String {
        let trimmed = candidate.fileName.trimmingCharacters(in: .whitespacesAndNewlines)
        if !trimmed.isEmpty, trimmed.lowercased() != "unknown" {
            return trimmed
        }

        if let linkURL = URL(string: candidate.link) {
            let fromLink = linkURL.lastPathComponent.trimmingCharacters(in: .whitespacesAndNewlines)
            if !fromLink.isEmpty {
                return fromLink
            }
        }

        return trimmed.isEmpty ? candidate.link : trimmed
    }

    private static func containerCompatibilityScore(ext: String) -> Int {
        switch ext {
        case "mp4", "m4v", "mov":
            return 6
        case "mkv":
            return 5
        case "ts", "m2ts", "mpg", "mpeg":
            return 4
        case "webm":
            return 3
        case "avi", "wmv", "flv":
            return 2
        default:
            return 0
        }
    }

    private static func codecCompatibilityScore(fileName: String) -> Int {
        if fileName.contains("x264") || fileName.contains("h264") || fileName.contains("avc") || fileName.contains("h.264") {
            return 5
        }
        if fileName.contains("x265") || fileName.contains("h265") || fileName.contains("hevc") || fileName.contains("h.265") {
            return 4
        }
        if fileName.contains("xvid") || fileName.contains("divx") {
            return 2
        }
        if fileName.contains("av1") {
            return 1
        }
        return 3
    }
}
