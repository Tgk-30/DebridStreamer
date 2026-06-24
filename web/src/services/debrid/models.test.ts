// Unit tests for the pure filename/quality parsers and the file selector in the
// debrid models. These classify untrusted torrent filenames (quality, codec,
// audio, source) and pick which file to actually stream — core domain logic that
// was largely untested.

import { describe, expect, it } from "vitest";
import {
  AudioFormat,
  DebridFileSelector,
  lastPathComponent,
  mediaTokenMatch,
  SourceType,
  VideoCodec,
  VideoQuality,
  type DebridFileCandidate,
} from "./models";

describe("mediaTokenMatch", () => {
  it("matches a whole token bounded by non-alphanumerics", () => {
    expect(mediaTokenMatch("movie.sd.x264", "sd")).toBe(true);
    expect(mediaTokenMatch("a ts b", "ts")).toBe(true);
  });
  it("does not match a token embedded in a larger word/number", () => {
    expect(mediaTokenMatch("hdtvsd", "sd")).toBe(false);
    expect(mediaTokenMatch("sd1080", "sd")).toBe(false);
  });
});

describe("VideoQuality.parse", () => {
  it("maps the resolution markers", () => {
    expect(VideoQuality.parse("Film.2160p.mkv")).toBe("4K");
    expect(VideoQuality.parse("Film.UHD.mkv")).toBe("4K");
    expect(VideoQuality.parse("Film.4K.mkv")).toBe("4K");
    expect(VideoQuality.parse("Film.1080p.mkv")).toBe("1080p");
    expect(VideoQuality.parse("Film.720p.mkv")).toBe("720p");
    expect(VideoQuality.parse("Film.480p.mkv")).toBe("480p");
  });
  it("maps SD-class markers and falls back to Unknown", () => {
    expect(VideoQuality.parse("Film.DVDRip.avi")).toBe("SD");
    expect(VideoQuality.parse("Film.HDTV.avi")).toBe("SD");
    expect(VideoQuality.parse("Film.mkv")).toBe("Unknown");
  });
  it("orders qualities by sortOrder", () => {
    expect(VideoQuality.sortOrder("4K")).toBeGreaterThan(
      VideoQuality.sortOrder("1080p"),
    );
    expect(VideoQuality.sortOrder("Unknown")).toBe(0);
  });
});

describe("VideoCodec.parse", () => {
  it("recognizes the codec families", () => {
    expect(VideoCodec.parse("Film.x265.mkv")).toBe("H.265");
    expect(VideoCodec.parse("Film.HEVC.mkv")).toBe("H.265");
    expect(VideoCodec.parse("Film.x264.mkv")).toBe("H.264");
    expect(VideoCodec.parse("Film.AVC.mkv")).toBe("H.264");
    expect(VideoCodec.parse("Film.AV1.mkv")).toBe("AV1");
    expect(VideoCodec.parse("Film.XviD.avi")).toBe("XviD");
    expect(VideoCodec.parse("Film.DivX.avi")).toBe("XviD");
    expect(VideoCodec.parse("Film.mkv")).toBe("Unknown");
  });
});

describe("AudioFormat.parse", () => {
  it("prefers the most specific format first", () => {
    expect(AudioFormat.parse("Film.Atmos.mkv")).toBe("Atmos");
    expect(AudioFormat.parse("Film.DTS-HD.MA.mkv")).toBe("DTS-HD MA");
    expect(AudioFormat.parse("Film.DTS-X.mkv")).toBe("DTS:X");
    expect(AudioFormat.parse("Film.TrueHD.mkv")).toBe("TrueHD");
    expect(AudioFormat.parse("Film.DTS.mkv")).toBe("DTS");
    expect(AudioFormat.parse("Film.DDP5.1.mkv")).toBe("AC3");
    expect(AudioFormat.parse("Film.AC3.mkv")).toBe("AC3");
    expect(AudioFormat.parse("Film.AAC.mkv")).toBe("AAC");
    expect(AudioFormat.parse("Film.mkv")).toBe("Unknown");
  });
});

describe("SourceType.parse", () => {
  it("recognizes the source families", () => {
    expect(SourceType.parse("Film.BluRay.mkv")).toBe("BluRay");
    expect(SourceType.parse("Film.BDRip.mkv")).toBe("BluRay");
    expect(SourceType.parse("Film.WEB-DL.mkv")).toBe("WEB-DL");
    expect(SourceType.parse("Film.WEBRip.mkv")).toBe("WEBRip");
    expect(SourceType.parse("Film.HDRip.mkv")).toBe("HDRip");
    expect(SourceType.parse("Film.DVDRip.avi")).toBe("DVDRip");
    expect(SourceType.parse("Film.HDTV.mkv")).toBe("HDTV");
    expect(SourceType.parse("Film.HDCAM.mkv")).toBe("CAM");
    expect(SourceType.parse("Film.mkv")).toBe("Unknown");
  });
});

describe("lastPathComponent", () => {
  it("returns the final path segment", () => {
    expect(lastPathComponent("/a/b/movie.mkv")).toBe("movie.mkv");
    expect(lastPathComponent("movie.mkv")).toBe("movie.mkv");
  });
  it("strips a trailing slash before taking the segment", () => {
    expect(lastPathComponent("/a/b/")).toBe("b");
    // Degenerate root "/" (never a real debrid file path): the trailing-slash
    // strip is guarded by length>1, so it yields "" — documented, not relied on.
    expect(lastPathComponent("/")).toBe("");
  });
});

describe("DebridFileSelector.selectBest", () => {
  function f(
    fileName: string,
    sizeBytes: number,
    link = fileName,
  ): DebridFileCandidate {
    return { link, fileName, sizeBytes };
  }

  it("returns null for no candidates", () => {
    expect(DebridFileSelector.selectBest([])).toBeNull();
  });

  it("prefers a video file over a non-video file", () => {
    const best = DebridFileSelector.selectBest([
      f("readme.txt", 9_999_999),
      f("movie.mkv", 1_000),
    ]);
    expect(best?.fileName).toBe("movie.mkv");
  });

  it("prefers the feature over a sample of the same type", () => {
    const best = DebridFileSelector.selectBest([
      f("sample.mkv", 50_000_000),
      f("feature.mkv", 1_000_000),
    ]);
    expect(best?.fileName).toBe("feature.mkv");
  });

  it("prefers the larger file when type/container/codec tie", () => {
    const best = DebridFileSelector.selectBest([
      f("a.mkv", 1_000_000),
      f("b.mkv", 5_000_000),
    ]);
    expect(best?.fileName).toBe("b.mkv");
  });

  it("keeps the first candidate on a full tie (stable)", () => {
    const best = DebridFileSelector.selectBest([
      f("first.mkv", 1_000_000),
      f("first.mkv", 1_000_000, "other-link"),
    ]);
    expect(best?.link).toBe("first.mkv");
  });
});
