import { describe, expect, it } from "vitest";
import {
  DATA_SAVER_MAX_SIZE_GB,
  effectiveDataSaver,
  filterStreamRows,
  streamMatchesDataSaver,
  type StreamRow,
} from "./streams";
import { defaultSettings, type AppSettings } from "./settings";
import { DebridServiceType } from "../services/debrid/models";
import {
  AudioFormat,
  SourceType,
  VideoCodec,
  VideoQuality,
  type TorrentResult as TorrentResultModel,
} from "../services/indexers/models";

function settings(overrides: Partial<AppSettings>): AppSettings {
  return { ...defaultSettings(), ...overrides };
}

function torrent(overrides: Partial<TorrentResultModel>): TorrentResultModel {
  const infoHash = overrides.infoHash ?? "hash";
  return {
    get id() {
      return infoHash;
    },
    infoHash,
    title: overrides.title ?? "Movie.1080p.BluRay",
    sizeBytes: overrides.sizeBytes ?? 1 * 1024 * 1024 * 1024,
    quality: overrides.quality ?? VideoQuality.hd1080p,
    codec: overrides.codec ?? VideoCodec.h264,
    audio: overrides.audio ?? AudioFormat.ac3,
    source: overrides.source ?? SourceType.bluray,
    seeders: overrides.seeders ?? 10,
    leechers: overrides.leechers ?? 0,
    indexerName: overrides.indexerName ?? "test",
    magnetURI: overrides.magnetURI ?? null,
    isCached: overrides.isCached ?? false,
    cachedOn: overrides.cachedOn ?? null,
  };
}

function row(
  id: string,
  quality: VideoQuality,
  sizeGB: number,
  cached = true,
): StreamRow {
  const sizeBytes = sizeGB * 1024 * 1024 * 1024;
  return {
    result: torrent({
      infoHash: id,
      title: `${id}.${quality}`,
      quality,
      sizeBytes,
    }),
    cachedOn: cached ? DebridServiceType.realDebrid : null,
  };
}

describe("filterStreamRows", () => {
  it("keeps all rows when data-saver filters are disabled", () => {
    const rows = [
      row("cached-4k", VideoQuality.uhd4k, 80),
      row("uncached-1080p", VideoQuality.hd1080p, 12, false),
    ];

    expect(filterStreamRows(rows, defaultSettings()).map((item) => item.result.infoHash))
      .toEqual(["cached-4k", "uncached-1080p"]);
  });

  it("hides uncached rows when cached-only is enabled", () => {
    const rows = [
      row("cached", VideoQuality.hd1080p, 8),
      row("uncached", VideoQuality.hd1080p, 8, false),
    ];

    expect(
      filterStreamRows(rows, settings({ streamCachedOnly: true })).map(
        (item) => item.result.infoHash,
      ),
    ).toEqual(["cached"]);
  });

  it("limits rows above the selected maximum quality", () => {
    const rows = [
      row("4k", VideoQuality.uhd4k, 45),
      row("1080p", VideoQuality.hd1080p, 14),
      row("720p", VideoQuality.hd720p, 6),
    ];

    expect(
      filterStreamRows(rows, settings({ streamMaxQuality: "1080p" })).map(
        (item) => item.result.infoHash,
      ),
    ).toEqual(["1080p", "720p"]);
  });

  it("keeps unknown-quality rows when a maximum quality is set", () => {
    const rows = [
      row("unknown", VideoQuality.unknown, 2),
      row("4k", VideoQuality.uhd4k, 45),
    ];

    expect(
      filterStreamRows(rows, settings({ streamMaxQuality: "720p" })).map(
        (item) => item.result.infoHash,
      ),
    ).toEqual(["unknown"]);
  });

  it("hides rows above the selected maximum size", () => {
    const rows = [
      row("small", VideoQuality.hd1080p, 4.5),
      row("large", VideoQuality.hd1080p, 9),
    ];

    expect(
      filterStreamRows(rows, settings({ streamMaxSizeGB: 5 })).map(
        (item) => item.result.infoHash,
      ),
    ).toEqual(["small"]);
  });
});

describe("effectiveDataSaver", () => {
  it("returns the raw caps when Data Saver is off", () => {
    const s = settings({ dataSaver: false, streamMaxQuality: "4K", streamMaxSizeGB: 50, streamCachedOnly: true });
    expect(effectiveDataSaver(s)).toEqual({ cachedOnly: true, maxQuality: "4K", maxSizeGB: 50 });
  });

  it("clamps an uncapped profile to the bandwidth-friendly ceiling", () => {
    const s = settings({ dataSaver: true, streamMaxQuality: "any", streamMaxSizeGB: 0 });
    expect(effectiveDataSaver(s)).toMatchObject({ maxQuality: "720p", maxSizeGB: DATA_SAVER_MAX_SIZE_GB });
  });

  it("clamps a looser explicit cap down (min), never up", () => {
    const s = settings({ dataSaver: true, streamMaxQuality: "4K", streamMaxSizeGB: 50 });
    expect(effectiveDataSaver(s)).toMatchObject({ maxQuality: "720p", maxSizeGB: 5 });
  });

  it("keeps a stricter explicit cap (never loosens it)", () => {
    const s = settings({ dataSaver: true, streamMaxQuality: "480p", streamMaxSizeGB: 2 });
    expect(effectiveDataSaver(s)).toMatchObject({ maxQuality: "480p", maxSizeGB: 2 });
  });

  it("leaves cached-only to its own explicit toggle", () => {
    expect(effectiveDataSaver(settings({ dataSaver: true, streamCachedOnly: false })).cachedOnly).toBe(false);
    expect(effectiveDataSaver(settings({ dataSaver: true, streamCachedOnly: true })).cachedOnly).toBe(true);
  });
});

describe("streamMatchesDataSaver with the master Data Saver toggle", () => {
  it("filters out an over-ceiling source even when no explicit caps are set", () => {
    const s = settings({ dataSaver: true }); // no explicit quality/size caps
    expect(streamMatchesDataSaver(row("1080p-12gb", VideoQuality.hd1080p, 12), s)).toBe(false);
    expect(streamMatchesDataSaver(row("720p-4gb", VideoQuality.hd720p, 4), s)).toBe(true);
  });
});
