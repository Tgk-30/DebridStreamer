import { describe, expect, it } from "vitest";
import {
  AudioFormat,
  VideoCodec,
  SourceType,
  TorrentResult,
  VideoQuality,
  mediaTokenMatch,
} from "./models";

describe("mediaTokenMatch", () => {
  it("matches a token at token boundaries", () => {
    expect(mediaTokenMatch("this is a cam file", "cam")).toBe(true);
    expect(mediaTokenMatch("camera", "cam")).toBe(false); // token boundary rejects embedded
    expect(mediaTokenMatch("ts scene", "ts")).toBe(true);
  });
});

describe("VideoQuality.parse", () => {
  it("parses UHD and 4K variants", () => {
    expect(VideoQuality.parse("Movie.2160p.BluRay")).toBe(VideoQuality.uhd4k);
    expect(VideoQuality.parse("film.UHD.1080p")).toBe(VideoQuality.uhd4k);
  });

  it("parses legacy resolution tokens", () => {
    expect(VideoQuality.parse("show.1080i.WEB")).toBe(VideoQuality.hd1080p);
    expect(VideoQuality.parse("show.720p.WEB")).toBe(VideoQuality.hd720p);
    expect(VideoQuality.parse("show.480p.web")).toBe(VideoQuality.sd480p);
  });

  it("falls back to SD when sd cues are present", () => {
    expect(VideoQuality.parse("x264-dvdrip-web")).toBe(VideoQuality.sdOther);
    expect(VideoQuality.parse("hdtv sample")).toBe(VideoQuality.sdOther);
  });
});

describe("VideoCodec.parse", () => {
  it("parses HEVC and x265 as H.265", () => {
    expect(VideoCodec.parse("Movie.H.265.HEVC")).toBe(VideoCodec.h265);
    expect(VideoCodec.parse("movie.x265")).toBe(VideoCodec.h265);
  });

  it("parses AVC / x264 as H.264", () => {
    expect(VideoCodec.parse("show.H.264.Bluray")).toBe(VideoCodec.h264);
    expect(VideoCodec.parse("show.x264")).toBe(VideoCodec.h264);
  });

  it("parses AV1 and XviD", () => {
    expect(VideoCodec.parse("release.av1")).toBe(VideoCodec.av1);
    expect(VideoCodec.parse("video.xvid")).toBe(VideoCodec.xvid);
  });
});

describe("AudioFormat.parse", () => {
  it("prefers Atmos and DTS-HD over generic DTS", () => {
    expect(AudioFormat.parse("movie.atmos.5.1")).toBe(AudioFormat.atmos);
    expect(AudioFormat.parse("pack.dts-hd.ma")).toBe(AudioFormat.dtsHDMA);
    expect(AudioFormat.parse("pack.dts.x")).toBe(AudioFormat.dtsX);
  });

  it("parses Dolby, DTS, AC3, and AAC families", () => {
    expect(AudioFormat.parse("release.truehd.7.1")).toBe(AudioFormat.trueHD);
    expect(AudioFormat.parse("release.dts")).toBe(AudioFormat.dts);
    expect(AudioFormat.parse("audio.dd5.1")).toBe(AudioFormat.ac3);
    expect(AudioFormat.parse("audio.ac3")).toBe(AudioFormat.ac3);
    expect(AudioFormat.parse("audio.aac")).toBe(AudioFormat.aac);
  });
});

describe("SourceType.parse", () => {
  it("parses known source families", () => {
    expect(SourceType.parse("The.Movie.BluRay.720p")).toBe(SourceType.bluray);
    expect(SourceType.parse("Show.WEB-DL.1080p")).toBe(SourceType.webDL);
    expect(SourceType.parse("Show.WEBRip.X264")).toBe(SourceType.webRip);
    expect(SourceType.parse("Release.HDRip.1080p")).toBe(SourceType.hdRip);
    expect(SourceType.parse("Release.DVDRip")).toBe(SourceType.dvdRip);
    expect(SourceType.parse("Show.HDTV")).toBe(SourceType.hdtv);
  });

  it("classifies CAM and TS tokens with boundaries", () => {
    expect(SourceType.parse("CAM.rip.1080p")).toBe(SourceType.cam);
    expect(SourceType.parse("HDCAM")).toBe(SourceType.cam);
    expect(SourceType.parse("teLesync")).toBe(SourceType.cam);
  });
});

describe("TorrentResult.fromSearch and qualityLabel", () => {
  it("builds derived fields from the title and lowercases infoHash", () => {
    const row = TorrentResult.fromSearch({
      infoHash: "ABCDEF",
      title: "Movie 1080p.x264.WEB-DL.aac",
      sizeBytes: 1_234,
      seeders: 5,
      leechers: 2,
      indexerName: "idx",
      magnetURI: null,
    });

    expect(row.id).toBe("abcdef");
    expect(row.infoHash).toBe("abcdef");
    expect(row.quality).toBe(VideoQuality.hd1080p);
    expect(row.codec).toBe(VideoCodec.h264);
    expect(row.audio).toBe(AudioFormat.aac);
    expect(row.source).toBe(SourceType.webDL);
    expect(row.isCached).toBe(false);
    expect(row.cachedOn).toBeNull();
  });

  it("renders quality label from known dimensions only", () => {
    expect(
      TorrentResult.qualityLabel({
        id: "i",
        infoHash: "i",
        title: "x",
        sizeBytes: 0,
        quality: VideoQuality.hd720p,
        codec: VideoCodec.h265,
        audio: AudioFormat.unknown,
        source: SourceType.webRip,
        seeders: 0,
        leechers: 0,
        indexerName: "idx",
      }),
    ).toBe("720p · H.265 · WEBRip");

    expect(
      TorrentResult.qualityLabel({
        id: "i",
        infoHash: "i",
        title: "x",
        sizeBytes: 0,
        quality: VideoQuality.unknown,
        codec: VideoCodec.unknown,
        audio: AudioFormat.unknown,
        source: SourceType.unknown,
        seeders: 0,
        leechers: 0,
        indexerName: "idx",
      }),
    ).toBe("Unknown");
  });
});
