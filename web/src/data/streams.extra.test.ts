// Extended coverage for the stream-picker data layer (streams.ts).
//
// The existing streams.test.ts covers the happy paths of filterStreamRows /
// effectiveDataSaver / streamMatchesDataSaver. This file pins down the BOUNDARY
// and EDGE behavior of those pure exports (strict-`>` cutoffs, the
// never-loosen clamp, size-cap "0 = uncapped" sentinel, unknown-quality
// bypass, empty/duplicate inputs) plus the exported Data Saver constants.
//
// The `useStreams` React hook and the private `resolveStreams` it wraps are NOT
// exercised here: this project's vitest environment is "node" with no
// jsdom / @testing-library/react / react-test-renderer, so a hook render cannot
// be driven reliably. We deliberately skip it rather than ship a flaky test.

import { describe, expect, it } from "vitest";
import {
  DATA_SAVER_MAX_QUALITY,
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

const GB = 1024 * 1024 * 1024;

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
    sizeBytes: overrides.sizeBytes ?? 1 * GB,
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
  return {
    result: torrent({
      infoHash: id,
      title: `${id}.${quality}`,
      quality,
      sizeBytes: sizeGB * GB,
    }),
    cachedOn: cached ? DebridServiceType.realDebrid : null,
  };
}

describe("exported Data Saver constants", () => {
  it("clamp ceiling is 720p / 5 GB", () => {
    expect(DATA_SAVER_MAX_QUALITY).toBe("720p");
    expect(DATA_SAVER_MAX_SIZE_GB).toBe(5);
  });
});

describe("effectiveDataSaver boundaries", () => {
  it("off: returns the three raw fields verbatim (no clamp, no min)", () => {
    const s = settings({
      dataSaver: false,
      streamMaxQuality: "any",
      streamMaxSizeGB: 0,
      streamCachedOnly: false,
    });
    // 0 / "any" pass straight through when the master toggle is off.
    expect(effectiveDataSaver(s)).toEqual({
      cachedOnly: false,
      maxQuality: "any",
      maxSizeGB: 0,
    });
  });

  it("on + explicit cap exactly AT the ceiling keeps it (boundary is not-greater)", () => {
    // currentOrder(720p)=3, saverOrder(720p)=3 → 3 > 3 is false → keep 720p.
    const s = settings({
      dataSaver: true,
      streamMaxQuality: "720p",
      streamMaxSizeGB: DATA_SAVER_MAX_SIZE_GB,
    });
    expect(effectiveDataSaver(s)).toMatchObject({
      maxQuality: "720p",
      maxSizeGB: DATA_SAVER_MAX_SIZE_GB,
    });
  });

  it("on + size below the ceiling keeps the stricter size (min picks the smaller)", () => {
    const s = settings({ dataSaver: true, streamMaxQuality: "any", streamMaxSizeGB: 3 });
    expect(effectiveDataSaver(s).maxSizeGB).toBe(3);
  });

  it("on + size cap of 0 (uncapped) clamps to the Data Saver ceiling", () => {
    // 0 means "no cap" → treated as Infinity → min(Infinity, 5) = 5.
    const s = settings({ dataSaver: true, streamMaxSizeGB: 0 });
    expect(effectiveDataSaver(s).maxSizeGB).toBe(DATA_SAVER_MAX_SIZE_GB);
  });

  it("on: SD (below 720p) is kept, never bumped UP to the ceiling", () => {
    const s = settings({ dataSaver: true, streamMaxQuality: "SD" });
    expect(effectiveDataSaver(s).maxQuality).toBe("SD");
  });

  it("on: 480p (below 720p) is kept as the stricter explicit cap", () => {
    const s = settings({ dataSaver: true, streamMaxQuality: "480p" });
    expect(effectiveDataSaver(s).maxQuality).toBe("480p");
  });

  it("on: passes cachedOnly through untouched in both states", () => {
    expect(
      effectiveDataSaver(settings({ dataSaver: true, streamCachedOnly: true })).cachedOnly,
    ).toBe(true);
    expect(
      effectiveDataSaver(settings({ dataSaver: true, streamCachedOnly: false })).cachedOnly,
    ).toBe(false);
  });
});

describe("streamMatchesDataSaver boundaries", () => {
  it("a row exactly AT the max quality passes (cutoff is strictly greater)", () => {
    const s = settings({ streamMaxQuality: "1080p" });
    expect(streamMatchesDataSaver(row("at", VideoQuality.hd1080p, 1), s)).toBe(true);
  });

  it("a row one tier above the max quality is rejected", () => {
    const s = settings({ streamMaxQuality: "1080p" });
    expect(streamMatchesDataSaver(row("above", VideoQuality.uhd4k, 1), s)).toBe(false);
  });

  it("unknown-quality rows are never rejected by the quality cap", () => {
    const s = settings({ streamMaxQuality: "SD" });
    expect(streamMatchesDataSaver(row("u", VideoQuality.unknown, 1), s)).toBe(true);
  });

  it("a row exactly AT the max size passes (size cutoff is strictly greater)", () => {
    const s = settings({ streamMaxSizeGB: 5 });
    expect(streamMatchesDataSaver(row("at", VideoQuality.hd720p, 5), s)).toBe(true);
  });

  it("a row one byte over the max size is rejected", () => {
    const s = settings({ streamMaxSizeGB: 5 });
    const r: StreamRow = {
      result: torrent({ infoHash: "over", sizeBytes: 5 * GB + 1, quality: VideoQuality.hd720p }),
      cachedOn: DebridServiceType.realDebrid,
    };
    expect(streamMatchesDataSaver(r, s)).toBe(false);
  });

  it("a size cap of 0 disables the size check entirely (huge file passes)", () => {
    const s = settings({ streamMaxSizeGB: 0 });
    expect(streamMatchesDataSaver(row("huge", VideoQuality.uhd4k, 500), s)).toBe(true);
  });

  it("a zero-byte row passes regardless of caps", () => {
    const s = settings({ streamMaxSizeGB: 5, streamMaxQuality: "1080p" });
    const r: StreamRow = {
      result: torrent({ infoHash: "empty", sizeBytes: 0, quality: VideoQuality.hd720p }),
      cachedOn: DebridServiceType.realDebrid,
    };
    expect(streamMatchesDataSaver(r, s)).toBe(true);
  });

  it("cached-only rejects an uncached row even when quality/size are fine", () => {
    const s = settings({ streamCachedOnly: true });
    expect(streamMatchesDataSaver(row("uncached", VideoQuality.hd720p, 1, false), s)).toBe(false);
    expect(streamMatchesDataSaver(row("cached", VideoQuality.hd720p, 1, true), s)).toBe(true);
  });

  it("data-saver clamp rejects an over-ceiling row that an empty explicit profile would keep", () => {
    const base = settings({}); // all caps off → row passes
    expect(streamMatchesDataSaver(row("4k-80", VideoQuality.uhd4k, 80), base)).toBe(true);
    const saver = settings({ dataSaver: true });
    expect(streamMatchesDataSaver(row("4k-80", VideoQuality.uhd4k, 80), saver)).toBe(false);
  });

  it("data-saver: a 720p / 5 GB row sits exactly on the ceiling and passes", () => {
    const s = settings({ dataSaver: true });
    expect(streamMatchesDataSaver(row("edge", VideoQuality.hd720p, 5), s)).toBe(true);
  });

  it("explicit stricter caps still apply with data-saver on (480p rejects 720p)", () => {
    const s = settings({ dataSaver: true, streamMaxQuality: "480p" });
    expect(streamMatchesDataSaver(row("720p", VideoQuality.hd720p, 1), s)).toBe(false);
    expect(streamMatchesDataSaver(row("480p", VideoQuality.sd480p, 1), s)).toBe(true);
  });
});

describe("filterStreamRows", () => {
  it("returns an empty array for empty input", () => {
    expect(filterStreamRows([], defaultSettings())).toEqual([]);
  });

  it("preserves input order and does NOT dedup identical hashes (pure filter)", () => {
    const rows = [
      row("dup", VideoQuality.hd720p, 1),
      row("dup", VideoQuality.hd720p, 1),
      row("other", VideoQuality.hd720p, 1),
    ];
    expect(filterStreamRows(rows, defaultSettings()).map((r) => r.result.infoHash)).toEqual([
      "dup",
      "dup",
      "other",
    ]);
  });

  it("applies quality + size + cached-only together", () => {
    const rows = [
      row("keep", VideoQuality.hd720p, 2, true),
      row("too-big", VideoQuality.hd720p, 9, true),
      row("too-hi", VideoQuality.uhd4k, 2, true),
      row("uncached", VideoQuality.hd720p, 2, false),
    ];
    const s = settings({
      streamMaxQuality: "1080p",
      streamMaxSizeGB: 5,
      streamCachedOnly: true,
    });
    expect(filterStreamRows(rows, s).map((r) => r.result.infoHash)).toEqual(["keep"]);
  });

  it("can filter every row out, returning an empty array", () => {
    const rows = [row("a", VideoQuality.uhd4k, 80), row("b", VideoQuality.hd1080p, 60)];
    const s = settings({ streamMaxQuality: "480p", streamMaxSizeGB: 1 });
    expect(filterStreamRows(rows, s)).toEqual([]);
  });

  it("returns a NEW array (does not mutate the input reference)", () => {
    const rows = [row("a", VideoQuality.hd720p, 1)];
    const out = filterStreamRows(rows, defaultSettings());
    expect(out).not.toBe(rows);
    expect(rows).toHaveLength(1);
  });
});
