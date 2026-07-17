// Branch-coverage tests for the debrid / indexer / AI domain models. The existing
// per-dir `models.test.ts` / `indexers.test.ts` / `ai.test.ts` cover the headline
// parsers; this file fills in the remaining uncovered branches: every enum
// accessor (displayName/shortCode/baseURL/sortOrder), the StreamInfo + CacheStatus
// helpers, the memberwise-init defaults, the file-selector codec/container scoring
// tiers, and the normalizedName link-fallback path. Pure value logic, no network.

import { describe, expect, it } from "vitest";
import {
  AudioFormat,
  CacheStatus,
  DebridFileSelector,
  DebridServiceType,
  makeDebridConfig,
  StreamInfo,
  VideoCodec,
  VideoQuality,
  type DebridFileCandidate,
  type StreamInfo as StreamInfoT,
} from "./models";
import {
  AudioFormat as IdxAudioFormat,
  SourceType as IdxSourceType,
  TorrentResult,
  VideoCodec as IdxVideoCodec,
  VideoQuality as IdxVideoQuality,
} from "../indexers/models";
import {
  AIMovieRecommendation,
  AIProviderKind,
  AIUsageMetrics,
  makeAIMovieRecommendation,
} from "../ai/models";

// ============================================================================
// debrid/models.ts
// ============================================================================

describe("VideoQuality.sortOrder (debrid) - full tier ladder", () => {
  it("maps every quality tier to its weight", () => {
    expect(VideoQuality.sortOrder("4K")).toBe(5);
    expect(VideoQuality.sortOrder("1080p")).toBe(4);
    expect(VideoQuality.sortOrder("720p")).toBe(3);
    expect(VideoQuality.sortOrder("480p")).toBe(2);
    expect(VideoQuality.sortOrder("SD")).toBe(1);
    expect(VideoQuality.sortOrder("Unknown")).toBe(0);
  });
});

describe("StreamInfo helpers", () => {
  function makeStream(over: Partial<StreamInfoT> = {}): StreamInfoT {
    return {
      streamURL: "https://dl.example/movie.mkv",
      quality: VideoQuality.hd1080p,
      codec: VideoCodec.h264,
      audio: AudioFormat.unknown,
      source: "BluRay",
      sizeBytes: 1_000,
      fileName: "movie.mkv",
      debridService: "RD",
      ...over,
    };
  }

  it("id returns the stream URL", () => {
    const s = makeStream({ source: "BluRay" });
    expect(StreamInfo.id(s)).toBe("https://dl.example/movie.mkv");
  });

  it("qualityLabel includes the present quality/codec/source segments", () => {
    const s = makeStream({ source: "BluRay" });
    expect(StreamInfo.qualityLabel(s)).toBe("[RD] 1080p H.264 BluRay");
  });

  it("qualityLabel omits Unknown quality/codec/source, keeping only the service tag", () => {
    const s = makeStream({
      quality: VideoQuality.unknown,
      codec: VideoCodec.unknown,
      source: "Unknown",
    });
    expect(StreamInfo.qualityLabel(s)).toBe("[RD]");
  });
});

describe("CacheStatus", () => {
  it("cached() defaults all payload fields to null and reports isCached true", () => {
    const c = CacheStatus.cached();
    expect(c).toEqual({
      kind: "cached",
      fileId: null,
      fileName: null,
      fileSize: null,
    });
    expect(CacheStatus.isCached(c)).toBe(true);
  });

  it("cached() carries the supplied payload", () => {
    const c = CacheStatus.cached("fid", "name.mkv", 42);
    expect(c).toEqual({
      kind: "cached",
      fileId: "fid",
      fileName: "name.mkv",
      fileSize: 42,
    });
  });

  it("notCached / unknown are not cached", () => {
    expect(CacheStatus.isCached(CacheStatus.notCached)).toBe(false);
    expect(CacheStatus.isCached(CacheStatus.unknown)).toBe(false);
  });
});

describe("DebridServiceType accessors", () => {
  it("allCases lists every persisted raw value", () => {
    expect(DebridServiceType.allCases()).toEqual([
      "torbox",
      "real_debrid",
      "all_debrid",
      "premiumize",
    ]);
  });

  it("displayName maps each service", () => {
    expect(DebridServiceType.displayName("real_debrid")).toBe("Real-Debrid");
    expect(DebridServiceType.displayName("all_debrid")).toBe("AllDebrid");
    expect(DebridServiceType.displayName("premiumize")).toBe("Premiumize");
    expect(DebridServiceType.displayName("torbox")).toBe("TorBox");
  });

  it("shortCode maps each service to its two-letter badge", () => {
    expect(DebridServiceType.shortCode("real_debrid")).toBe("RD");
    expect(DebridServiceType.shortCode("all_debrid")).toBe("AD");
    expect(DebridServiceType.shortCode("premiumize")).toBe("PM");
    expect(DebridServiceType.shortCode("torbox")).toBe("TB");
  });

  it("baseURL maps each service to its API root", () => {
    expect(DebridServiceType.baseURL("real_debrid")).toBe(
      "https://api.real-debrid.com/rest/1.0",
    );
    expect(DebridServiceType.baseURL("all_debrid")).toBe(
      "https://api.alldebrid.com/v4",
    );
    expect(DebridServiceType.baseURL("premiumize")).toBe(
      "https://www.premiumize.me/api",
    );
    expect(DebridServiceType.baseURL("torbox")).toBe(
      "https://api.torbox.app/v1/api",
    );
  });
});

describe("makeDebridConfig defaults", () => {
  it("applies isActive=true and priority=0 when omitted", () => {
    const cfg = makeDebridConfig({
      id: "c1",
      service: "real_debrid",
      apiToken: "tok",
    });
    expect(cfg).toEqual({
      id: "c1",
      service: "real_debrid",
      apiToken: "tok",
      isActive: true,
      priority: 0,
    });
  });

  it("keeps an explicit isActive=false and a non-zero priority", () => {
    const cfg = makeDebridConfig({
      id: "c2",
      service: "torbox",
      apiToken: "tok2",
      isActive: false,
      priority: 7,
    });
    expect(cfg.isActive).toBe(false);
    expect(cfg.priority).toBe(7);
  });
});

describe("DebridFileSelector - codec & container scoring tiers", () => {
  function f(
    fileName: string,
    sizeBytes: number,
    link = fileName,
  ): DebridFileCandidate {
    return { link, fileName, sizeBytes };
  }

  it("prefers the higher container score (mp4 over mkv) when codecs tie", () => {
    // Both lack a codec token -> codecScore 3 each; mp4 (6) beats mkv (5).
    const best = DebridFileSelector.selectBest([
      f("movie.mkv", 1_000),
      f("movie.mp4", 1_000),
    ]);
    expect(best?.fileName).toBe("movie.mp4");
  });

  it("ts/m2ts/mpg containers outrank webm which outranks avi/wmv/flv", () => {
    expect(
      DebridFileSelector.selectBest([
        f("clip.webm", 1_000),
        f("clip.ts", 1_000),
      ])?.fileName,
    ).toBe("clip.ts");
    expect(
      DebridFileSelector.selectBest([
        f("clip.avi", 1_000),
        f("clip.webm", 1_000),
      ])?.fileName,
    ).toBe("clip.webm");
  });

  it("h264 codec (score 5) beats h265 (score 4) when container ties", () => {
    const best = DebridFileSelector.selectBest([
      f("movie.hevc.mkv", 1_000),
      f("movie.x264.mkv", 1_000),
    ]);
    expect(best?.fileName).toBe("movie.x264.mkv");
  });

  it("an unknown-codec file (score 3) beats xvid (2) and av1 (1)", () => {
    expect(
      DebridFileSelector.selectBest([
        f("movie.xvid.mkv", 1_000),
        f("movie.plain.mkv", 1_000),
      ])?.fileName,
    ).toBe("movie.plain.mkv");
    expect(
      DebridFileSelector.selectBest([
        f("movie.av1.mkv", 1_000),
        f("movie.xvid.mkv", 1_000),
      ])?.fileName,
    ).toBe("movie.xvid.mkv");
  });

  it("breaks a size tie by longer fileName, then lexicographically", () => {
    // identical type/container/codec/size -> longer name wins.
    const byLen = DebridFileSelector.selectBest([
      f("short.mkv", 1_000),
      f("a-longer-name.mkv", 1_000),
    ]);
    expect(byLen?.fileName).toBe("a-longer-name.mkv");

    // equal length too -> greater string wins.
    const byLex = DebridFileSelector.selectBest([
      f("aaa.mkv", 1_000),
      f("bbb.mkv", 1_000),
    ]);
    expect(byLex?.fileName).toBe("bbb.mkv");
  });

  it("derives the streamable name from the link when fileName is blank", () => {
    // blank fileName -> normalizedName falls back to the link's last path segment,
    // which carries the .mkv extension making it score as a video over the .txt.
    const best = DebridFileSelector.selectBest([
      f("readme.txt", 9_000_000),
      { link: "https://h/path/feature.mkv", fileName: "", sizeBytes: 10 },
    ]);
    expect(best?.fileName).toBe("");
    expect(best?.link).toBe("https://h/path/feature.mkv");
  });

  it("treats a literal 'unknown' fileName like a blank one and uses the link", () => {
    const best = DebridFileSelector.selectBest([
      f("notes.txt", 9_000_000),
      { link: "https://h/path/film.mp4", fileName: "Unknown", sizeBytes: 10 },
    ]);
    expect(best?.link).toBe("https://h/path/film.mp4");
  });

  it("falls back to the raw link when fileName is blank and link is not a URL", () => {
    // link is not parseable as an absolute URL -> the catch path -> the name
    // becomes the raw link string, which has no video extension (no '/').
    const candidates: DebridFileCandidate[] = [
      { link: "not-a-url-no-ext", fileName: "  ", sizeBytes: 5 },
    ];
    const best = DebridFileSelector.selectBest(candidates);
    expect(best?.link).toBe("not-a-url-no-ext");
  });
});

// ============================================================================
// indexers/models.ts
// ============================================================================

describe("VideoQuality.sortOrder (indexers) - full tier ladder", () => {
  it("maps every quality tier to its weight", () => {
    expect(IdxVideoQuality.sortOrder("4K")).toBe(5);
    expect(IdxVideoQuality.sortOrder("1080p")).toBe(4);
    expect(IdxVideoQuality.sortOrder("720p")).toBe(3);
    expect(IdxVideoQuality.sortOrder("480p")).toBe(2);
    expect(IdxVideoQuality.sortOrder("SD")).toBe(1);
    expect(IdxVideoQuality.sortOrder("Unknown")).toBe(0);
  });
});

describe("indexers enum parsers - remaining branches", () => {
  it("VideoQuality.parse covers 1080i, 480p and the SD-token fallback", () => {
    expect(IdxVideoQuality.parse("Film.1080i.mkv")).toBe("1080p");
    expect(IdxVideoQuality.parse("Film.480p.mkv")).toBe("480p");
    expect(IdxVideoQuality.parse("Film.SD.x264")).toBe("SD");
    expect(IdxVideoQuality.parse("Film.mkv")).toBe("Unknown");
  });

  it("VideoCodec.parse covers av1 and xvid/divx", () => {
    expect(IdxVideoCodec.parse("Film.AV1.mkv")).toBe("AV1");
    expect(IdxVideoCodec.parse("Film.DivX.avi")).toBe("XviD");
  });

  it("AudioFormat.parse covers dts.hd, dts-x, true-hd, plain dts and the ac3 family", () => {
    expect(IdxAudioFormat.parse("Film.DTS.HD.mkv")).toBe("DTS-HD MA");
    expect(IdxAudioFormat.parse("Film.DTS-X.mkv")).toBe("DTS:X");
    expect(IdxAudioFormat.parse("Film.True-HD.mkv")).toBe("TrueHD");
    expect(IdxAudioFormat.parse("Film.DTS.mkv")).toBe("DTS");
    expect(IdxAudioFormat.parse("Film.EAC3.mkv")).toBe("AC3");
    expect(IdxAudioFormat.parse("Film.AAC.mkv")).toBe("AAC");
    expect(IdxAudioFormat.parse("Film.mkv")).toBe("Unknown");
  });

  it("SourceType.parse covers bluray/webdl/hdrip/hdtv plus web-rip, dvd-rip, telesync and the ts/cam tokens", () => {
    expect(IdxSourceType.parse("Film.BRRip.mkv")).toBe("BluRay");
    expect(IdxSourceType.parse("Film.WEBDL.mkv")).toBe("WEB-DL");
    expect(IdxSourceType.parse("Film.HDRip.mkv")).toBe("HDRip");
    expect(IdxSourceType.parse("Film.HDTV.mkv")).toBe("HDTV");
    expect(IdxSourceType.parse("Film.WEB-RIP.mkv")).toBe("WEBRip");
    expect(IdxSourceType.parse("Film.DVD-RIP.avi")).toBe("DVDRip");
    expect(IdxSourceType.parse("Film.Telesync.mkv")).toBe("CAM");
    expect(IdxSourceType.parse("Film.2024.CAM.x264")).toBe("CAM");
    expect(IdxSourceType.parse("Film.2024.TS.x264")).toBe("CAM");
    expect(IdxSourceType.parse("Film.mkv")).toBe("Unknown");
  });
});

describe("TorrentResult.qualityLabel", () => {
  it("joins the known facets with a middot separator", () => {
    const r = TorrentResult.fromSearch({
      infoHash: "abc",
      title: "Show.1080p.WEB-DL.AAC",
      sizeBytes: 1,
      seeders: 1,
      leechers: 0,
      indexerName: "X",
    });
    expect(TorrentResult.qualityLabel(r)).toBe("1080p · WEB-DL · AAC");
  });

  it("returns 'Unknown' when every facet is unparseable", () => {
    const r = TorrentResult.fromSearch({
      infoHash: "def",
      title: "mystery release",
      sizeBytes: 1,
      seeders: 1,
      leechers: 0,
      indexerName: "X",
    });
    expect(r.quality).toBe("Unknown");
    expect(TorrentResult.qualityLabel(r)).toBe("Unknown");
  });

  it("defaults magnetURI to null when omitted", () => {
    const r = TorrentResult.fromSearch({
      infoHash: "ABC",
      title: "x",
      sizeBytes: 1,
      seeders: 1,
      leechers: 0,
      indexerName: "X",
    });
    expect(r.magnetURI).toBeNull();
  });
});

// ============================================================================
// ai/models.ts
// ============================================================================

describe("AIProviderKind", () => {
  it("displayName maps every provider", () => {
    expect(AIProviderKind.displayName("openai")).toBe("OpenAI");
    expect(AIProviderKind.displayName("anthropic")).toBe("Anthropic");
    expect(AIProviderKind.displayName("ollama")).toBe("Ollama");
    expect(AIProviderKind.displayName("gemini")).toBe("Google Gemini");
    expect(AIProviderKind.displayName("openrouter")).toBe("OpenRouter");
    expect(AIProviderKind.displayName("groq")).toBe("Groq");
    expect(AIProviderKind.displayName("mistral")).toBe("Mistral");
    expect(AIProviderKind.displayName("deepseek")).toBe("DeepSeek");
    expect(AIProviderKind.displayName("xai")).toBe("xAI (Grok)");
  });

  it("allCases lists every provider raw value", () => {
    expect(AIProviderKind.allCases()).toEqual([
      "anthropic",
      "openai",
      "gemini",
      "openrouter",
      "groq",
      "mistral",
      "deepseek",
      "xai",
      "ollama",
    ]);
  });

  it("flags OpenAI-compatible hosts (and excludes anthropic/ollama)", () => {
    expect(AIProviderKind.isOpenAICompatible("openai")).toBe(true);
    expect(AIProviderKind.isOpenAICompatible("groq")).toBe(true);
    expect(AIProviderKind.isOpenAICompatible("gemini")).toBe(true);
    expect(AIProviderKind.isOpenAICompatible("anthropic")).toBe(false);
    expect(AIProviderKind.isOpenAICompatible("ollama")).toBe(false);
  });
});

describe("makeAIMovieRecommendation defaults", () => {
  it("fills the optional fields with null when omitted", () => {
    const rec = makeAIMovieRecommendation({
      title: "Dune",
      reason: "epic",
      score: 0.9,
    });
    expect(rec).toEqual({
      title: "Dune",
      year: null,
      reason: "epic",
      score: 0.9,
      mediaId: null,
      mediaType: null,
      posterPath: null,
    });
  });

  it("preserves supplied optionals", () => {
    const rec = makeAIMovieRecommendation({
      title: "Dune",
      reason: "epic",
      score: 0.9,
      year: 2021,
      mediaId: "tmdb-438631",
      mediaType: "movie",
      posterPath: "/abc.jpg",
    });
    expect(rec.year).toBe(2021);
    expect(rec.mediaId).toBe("tmdb-438631");
    expect(rec.mediaType).toBe("movie");
    expect(rec.posterPath).toBe("/abc.jpg");
  });
});

describe("AIMovieRecommendation.id", () => {
  it("uses a non-empty mediaId verbatim", () => {
    const rec = makeAIMovieRecommendation({
      title: "Dune",
      reason: "r",
      score: 1,
      mediaId: "tmdb-1",
    });
    expect(AIMovieRecommendation.id(rec)).toBe("tmdb-1");
  });

  it("falls back to lowercased title + year when mediaId is null", () => {
    const rec = makeAIMovieRecommendation({
      title: "Blade Runner",
      reason: "r",
      score: 1,
      year: 1982,
    });
    expect(AIMovieRecommendation.id(rec)).toBe("blade runner-1982");
  });

  it("uses 0 for the year when the year is null", () => {
    const rec = makeAIMovieRecommendation({ title: "Solo", reason: "r", score: 1 });
    expect(AIMovieRecommendation.id(rec)).toBe("solo-0");
  });

  it("falls back to title when mediaId is an empty string", () => {
    const rec = makeAIMovieRecommendation({
      title: "Empty",
      reason: "r",
      score: 1,
      mediaId: "",
      year: 2000,
    });
    expect(AIMovieRecommendation.id(rec)).toBe("empty-2000");
  });
});

describe("AIMovieRecommendation.posterURL", () => {
  it("builds the w342 TMDB URL when a posterPath is present", () => {
    const rec = makeAIMovieRecommendation({
      title: "Dune",
      reason: "r",
      score: 1,
      posterPath: "/poster.jpg",
    });
    expect(AIMovieRecommendation.posterURL(rec)).toBe(
      "https://image.tmdb.org/t/p/w342/poster.jpg",
    );
  });

  it("returns null when posterPath is null", () => {
    const rec = makeAIMovieRecommendation({ title: "Dune", reason: "r", score: 1 });
    expect(AIMovieRecommendation.posterURL(rec)).toBeNull();
  });
});

describe("AIUsageMetrics.safeTotalTokens", () => {
  it("uses totalTokens when present, clamped at 0", () => {
    expect(AIUsageMetrics.safeTotalTokens({ totalTokens: 150 })).toBe(150);
    expect(AIUsageMetrics.safeTotalTokens({ totalTokens: -5 })).toBe(0);
  });

  it("sums input+output when totalTokens is absent", () => {
    expect(
      AIUsageMetrics.safeTotalTokens({ inputTokens: 30, outputTokens: 12 }),
    ).toBe(42);
  });

  it("treats missing input/output as 0 in the sum", () => {
    expect(AIUsageMetrics.safeTotalTokens({})).toBe(0);
    expect(AIUsageMetrics.safeTotalTokens({ inputTokens: 7 })).toBe(7);
  });
});
