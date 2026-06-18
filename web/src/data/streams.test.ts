import { describe, expect, it } from "vitest";
import { filterStreamRows, type StreamRow } from "./streams";
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
