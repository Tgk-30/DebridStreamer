import Testing
import Foundation
@testable import DebridStreamer

@Suite("MediaType Tests")
struct MediaTypeTests {
    @Test("MediaType display names")
    func displayNames() {
        #expect(MediaType.movie.displayName == "Movie")
        #expect(MediaType.series.displayName == "TV Show")
    }

    @Test("MediaType TMDB paths")
    func tmdbPaths() {
        #expect(MediaType.movie.tmdbPath == "movie")
        #expect(MediaType.series.tmdbPath == "tv")
    }

    @Test("MediaType is codable")
    func codable() throws {
        let encoder = JSONEncoder()
        let decoder = JSONDecoder()

        let data = try encoder.encode(MediaType.movie)
        let decoded = try decoder.decode(MediaType.self, from: data)
        #expect(decoded == .movie)
    }
}

@Suite("VideoQuality Tests")
struct VideoQualityTests {
    @Test("Parse 4K quality from filename")
    func parse4K() {
        #expect(VideoQuality.parse(from: "Movie.2024.2160p.WEB-DL.x265") == .uhd4k)
        #expect(VideoQuality.parse(from: "Movie.4K.BluRay") == .uhd4k)
        #expect(VideoQuality.parse(from: "Movie.UHD.Remux") == .uhd4k)
    }

    @Test("Parse 1080p quality from filename")
    func parse1080p() {
        #expect(VideoQuality.parse(from: "Movie.2024.1080p.BluRay.x264") == .hd1080p)
        #expect(VideoQuality.parse(from: "Movie.1080i.HDTV") == .hd1080p)
    }

    @Test("Parse 720p quality from filename")
    func parse720p() {
        #expect(VideoQuality.parse(from: "Movie.720p.WEB-DL") == .hd720p)
    }

    @Test("Parse 480p quality from filename")
    func parse480p() {
        #expect(VideoQuality.parse(from: "Movie.480p.DVDRip") == .sd480p)
    }

    @Test("Parse SD quality from filename")
    func parseSD() {
        #expect(VideoQuality.parse(from: "Movie.DVDRip.XviD") == .sdOther)
        #expect(VideoQuality.parse(from: "Movie.HDTV") == .sdOther)
    }

    @Test("Parse unknown quality from filename")
    func parseUnknown() {
        #expect(VideoQuality.parse(from: "Movie.2024") == .unknown)
    }

    @Test("Embedded 'sd' inside a word does not match SD quality")
    func sdTokenBoundary() {
        // "x264" lowercased is "x264" — no bounded "sd"; titles like "Wisdom" must not match.
        #expect(VideoQuality.parse(from: "Bosdal.Movie.x264") == .unknown)
        #expect(VideoQuality.parse(from: "Wisdom.2024.x265") == .unknown)
        // Delimited "sd" still resolves to SD.
        #expect(VideoQuality.parse(from: "Movie.SD.x264") == .sdOther)
    }

    @Test("Quality comparison ordering")
    func comparison() {
        #expect(VideoQuality.uhd4k > VideoQuality.hd1080p)
        #expect(VideoQuality.hd1080p > VideoQuality.hd720p)
        #expect(VideoQuality.hd720p > VideoQuality.sd480p)
        #expect(VideoQuality.sd480p > VideoQuality.sdOther)
        #expect(VideoQuality.sdOther > VideoQuality.unknown)
    }

    @Test("Quality sort order values")
    func sortOrder() {
        #expect(VideoQuality.uhd4k.sortOrder == 5)
        #expect(VideoQuality.hd1080p.sortOrder == 4)
        #expect(VideoQuality.unknown.sortOrder == 0)
    }
}

@Suite("VideoCodec Tests")
struct VideoCodecTests {
    @Test("Parse H.265/HEVC codec")
    func parseH265() {
        #expect(VideoCodec.parse(from: "Movie.x265.1080p") == .h265)
        #expect(VideoCodec.parse(from: "Movie.HEVC.WEB-DL") == .h265)
        #expect(VideoCodec.parse(from: "Movie.H.265.BluRay") == .h265)
        #expect(VideoCodec.parse(from: "Movie.h265") == .h265)
    }

    @Test("Parse H.264/AVC codec")
    func parseH264() {
        #expect(VideoCodec.parse(from: "Movie.x264.1080p") == .h264)
        #expect(VideoCodec.parse(from: "Movie.AVC.BluRay") == .h264)
        #expect(VideoCodec.parse(from: "Movie.H.264") == .h264)
    }

    @Test("Parse AV1 codec")
    func parseAV1() {
        #expect(VideoCodec.parse(from: "Movie.AV1.1080p") == .av1)
    }

    @Test("Parse XviD codec")
    func parseXviD() {
        #expect(VideoCodec.parse(from: "Movie.XviD.DVDRip") == .xvid)
        #expect(VideoCodec.parse(from: "Movie.DivX") == .xvid)
    }

    @Test("Parse unknown codec")
    func parseUnknown() {
        #expect(VideoCodec.parse(from: "Movie.2024.1080p") == .unknown)
    }
}

@Suite("AudioFormat Tests")
struct AudioFormatTests {
    @Test("Parse Atmos audio")
    func parseAtmos() {
        #expect(AudioFormat.parse(from: "Movie.Atmos.TrueHD") == .atmos)
    }

    @Test("Parse DTS-HD MA audio")
    func parseDTSHD() {
        #expect(AudioFormat.parse(from: "Movie.DTS-HD.MA.7.1") == .dtsHDMA)
        #expect(AudioFormat.parse(from: "Movie.DTS.HD.MA") == .dtsHDMA)
    }

    @Test("Parse TrueHD audio")
    func parseTrueHD() {
        #expect(AudioFormat.parse(from: "Movie.TrueHD.7.1") == .trueHD)
    }

    @Test("Parse DTS audio")
    func parseDTS() {
        #expect(AudioFormat.parse(from: "Movie.DTS.1080p") == .dts)
    }

    @Test("Parse AC3/DD audio")
    func parseAC3() {
        #expect(AudioFormat.parse(from: "Movie.AC3.720p") == .ac3)
        #expect(AudioFormat.parse(from: "Movie.DD5.1") == .ac3)
        #expect(AudioFormat.parse(from: "Movie.DDP.5.1") == .ac3)
        #expect(AudioFormat.parse(from: "Movie.EAC3") == .ac3)
    }

    @Test("Parse AAC audio")
    func parseAAC() {
        #expect(AudioFormat.parse(from: "Movie.AAC.2.0") == .aac)
    }

    @Test("Parse unknown audio")
    func parseUnknown() {
        #expect(AudioFormat.parse(from: "Movie.1080p.BluRay") == .unknown)
    }
}

@Suite("SourceType Tests")
struct SourceTypeTests {
    @Test("Parse BluRay source")
    func parseBluRay() {
        #expect(SourceType.parse(from: "Movie.BluRay.1080p") == .bluray)
        #expect(SourceType.parse(from: "Movie.Blu-Ray") == .bluray)
        #expect(SourceType.parse(from: "Movie.BDRip") == .bluray)
        #expect(SourceType.parse(from: "Movie.BRRip") == .bluray)
    }

    @Test("Parse WEB-DL source")
    func parseWebDL() {
        #expect(SourceType.parse(from: "Movie.WEB-DL.1080p") == .webDL)
        #expect(SourceType.parse(from: "Movie.WEBDL") == .webDL)
    }

    @Test("Parse WEBRip source")
    func parseWebRip() {
        #expect(SourceType.parse(from: "Movie.WEBRip.720p") == .webRip)
    }

    @Test("Parse HDRip source")
    func parseHDRip() {
        #expect(SourceType.parse(from: "Movie.HDRip") == .hdRip)
    }

    @Test("Parse DVDRip source")
    func parseDVDRip() {
        #expect(SourceType.parse(from: "Movie.DVDRip.XviD") == .dvdRip)
    }

    @Test("Parse HDTV source")
    func parseHDTV() {
        #expect(SourceType.parse(from: "Show.S01E01.HDTV") == .hdtv)
    }

    @Test("Parse unknown source")
    func parseUnknown() {
        #expect(SourceType.parse(from: "Movie.2024.x265") == .unknown)
    }

    @Test("Embedded 'ts'/'cam' inside a word does not match CAM source")
    func camTokenBoundary() {
        // "Ghosts" must not match the bare "ts" cam token.
        #expect(SourceType.parse(from: "Ghosts.2024.1080p.x264") == .unknown)
        #expect(SourceType.parse(from: "Camelot.2024.1080p.x264") == .unknown)
        // Delimited cam tokens still resolve to CAM.
        #expect(SourceType.parse(from: "Movie.2024.TS") == .cam)
        #expect(SourceType.parse(from: "Movie.2024.CAM") == .cam)
    }
}
