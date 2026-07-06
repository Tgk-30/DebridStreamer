// @vitest-environment jsdom

import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  DATA_SAVER_MAX_QUALITY,
  DATA_SAVER_MAX_SIZE_GB,
  classifyRowForEpisode,
  dedupeStreamRows,
  effectiveDataSaver,
  filterStreamRows,
  useStreams,
  streamMatchesDataSaver,
  type StreamRow,
} from "./streams";
import { defaultSettings, type AppSettings } from "./settings";
import { CacheStatus, DebridServiceType } from "../services/debrid/models";
import type { DebridManager } from "../services/debrid/DebridManager";
import {
  AudioFormat,
  SourceType,
  type TorrentResult,
  VideoCodec,
  VideoQuality,
  type TorrentResult as TorrentResultModel,
} from "../services/indexers/models";
import type { IndexerManager } from "../services/indexers/IndexerManager";

const configuredServerURL = vi.fn<() => string | null>(() => null);
const fetchServerStreams = vi.fn();

beforeEach(() => {
  configuredServerURL.mockReturnValue(null);
  fetchServerStreams.mockReset();
});

vi.mock("../lib/serverMode", () => ({
  configuredServerURL: () => configuredServerURL(),
}));

vi.mock("../lib/serverApi", () => ({
  fetchServerStreams: (...args: unknown[]) => fetchServerStreams(...args),
}));

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

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function makeIndexer(overrides: Partial<IndexerManager> = {}): IndexerManager {
  return {
    activeIndexers: ["mock-indexer"],
    searchAll: vi.fn(async () => []),
    ...overrides,
  } as unknown as IndexerManager;
}

function makeDebrid(overrides: Partial<DebridManager> = {}): DebridManager {
  return {
    hasServices: false,
    checkCacheAll: vi.fn(async () => ({})),
    ...overrides,
  } as unknown as DebridManager;
}

describe("dedupeStreamRows", () => {
  function rowWith(o: Partial<TorrentResultModel> & { cachedOn?: DebridServiceType | null }): StreamRow {
    return {
      result: torrent(o),
      cachedOn: o.cachedOn ?? null,
    };
  }

  it("leaves distinct torrents untouched, preserving order", () => {
    const rows = [
      rowWith({ infoHash: "a", seeders: 5 }),
      rowWith({ infoHash: "b", seeders: 9 }),
      rowWith({ infoHash: "c", seeders: 1 }),
    ];
    expect(dedupeStreamRows(rows).map((r) => r.result.infoHash)).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  it("collapses the same infoHash (case-insensitive) into one row", () => {
    const rows = [
      rowWith({ infoHash: "ABCD", indexerName: "eztv", seeders: 5 }),
      rowWith({ infoHash: "abcd", indexerName: "yts", seeders: 8 }),
    ];
    const out = dedupeStreamRows(rows);
    expect(out).toHaveLength(1);
  });

  it("keeps a cached copy over an uncached duplicate", () => {
    const rows = [
      rowWith({ infoHash: "h", seeders: 100, cachedOn: null }),
      rowWith({ infoHash: "h", seeders: 1, cachedOn: DebridServiceType.realDebrid }),
    ];
    const out = dedupeStreamRows(rows);
    expect(out).toHaveLength(1);
    expect(out[0].cachedOn).toBe(DebridServiceType.realDebrid); // cached wins over more seeders
  });

  it("breaks an all-uncached (or all-cached) tie by seeders", () => {
    const rows = [
      rowWith({ infoHash: "h", seeders: 3, cachedOn: null }),
      rowWith({ infoHash: "h", seeders: 42, cachedOn: null }),
    ];
    expect(dedupeStreamRows(rows)[0].result.seeders).toBe(42);
  });

  it("keeps the first cached duplicate if it is the one seen first", () => {
    const rows = [
      rowWith({ infoHash: "h", seeders: 100, cachedOn: DebridServiceType.realDebrid }),
      rowWith({ infoHash: "h", seeders: 5, cachedOn: null }),
    ];
    expect(dedupeStreamRows(rows)[0].cachedOn).toBe(DebridServiceType.realDebrid);
  });

  it("keeps the first duplicate when it already has more seeders", () => {
    const rows = [
      rowWith({ infoHash: "h", seeders: 100, cachedOn: null }),
      rowWith({ infoHash: "h", seeders: 10, cachedOn: null }),
    ];
    expect(dedupeStreamRows(rows)[0].result.seeders).toBe(100);
  });

  it("keeps the duplicate in its FIRST-seen slot", () => {
    const rows = [
      rowWith({ infoHash: "a", seeders: 1 }),
      rowWith({ infoHash: "dup", seeders: 1 }),
      rowWith({ infoHash: "b", seeders: 1 }),
      rowWith({ infoHash: "dup", seeders: 99 }), // better, but slot stays at index 1
    ];
    const out = dedupeStreamRows(rows);
    expect(out.map((r) => r.result.infoHash)).toEqual(["a", "dup", "b"]);
    expect(out[1].result.seeders).toBe(99); // the better variant occupies the slot
  });
});

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

  it("uses a fallback when DATA_SAVER_MAX_QUALITY sort order is unavailable", () => {
    const realSortOrder = VideoQuality.sortOrder.bind(VideoQuality);
    const sortOrder = vi.spyOn(VideoQuality, "sortOrder");
    sortOrder.mockImplementation((quality) => {
      if (quality === DATA_SAVER_MAX_QUALITY) {
        return null as unknown as number;
      }
      return realSortOrder.call(VideoQuality, quality);
    });
    const out = effectiveDataSaver(
      settings({ dataSaver: true, streamMaxQuality: "any", streamMaxSizeGB: 50 }),
    );
    expect(out.maxQuality).toBe("720p");
    expect(out.maxSizeGB).toBe(5);
    sortOrder.mockRestore();
  });
});

describe("streamMatchesDataSaver with the master Data Saver toggle", () => {
  it("filters out an over-ceiling source even when no explicit caps are set", () => {
    const s = settings({ dataSaver: true }); // no explicit quality/size caps
    expect(streamMatchesDataSaver(row("1080p-12gb", VideoQuality.hd1080p, 12), s)).toBe(false);
    expect(streamMatchesDataSaver(row("720p-4gb", VideoQuality.hd720p, 4), s)).toBe(true);
  });

  describe("classifyRowForEpisode", () => {
    it("supports exact episode and mismatch classifications", () => {
      const exact = row("tagged-exact", VideoQuality.hd720p, 1);
      exact.result.title = "My.Show.S02E05.1080p.REMASTER";
      const mismatch = row("tagged-mismatch", VideoQuality.hd720p, 1);
      mismatch.result.title = "My.Show.S02E06.1080p.REMASTER";

      expect(classifyRowForEpisode(exact, 2, 5)).toBe("exact");
      expect(classifyRowForEpisode(mismatch, 2, 5)).toBe("mismatch");
    });

    it("classifies season-only matches as packs", () => {
      const seasonPack = row("season-pack", VideoQuality.hd720p, 1);
      seasonPack.result.title = "My.Show.S02.1080p.BluRay";
      expect(classifyRowForEpisode(seasonPack, 2, 5)).toBe("pack");
    });

    it("classifies season-only mismatches as mismatch", () => {
      const seasonMismatch = row("season-mismatch", VideoQuality.hd720p, 1);
      seasonMismatch.result.title = "My.Show.SEASON 3.1080p.BluRay";
      expect(classifyRowForEpisode(seasonMismatch, 2, 5)).toBe("mismatch");
    });

    it("classifies COMPLETE titles as packs", () => {
      const complete = row("complete", VideoQuality.hd720p, 1);
      complete.result.title = "My.Show.COMPLETE.1080p";
      expect(classifyRowForEpisode(complete, 2, 5)).toBe("pack");
    });

    it("classifies untagged titles as unknown", () => {
      const unknown = row("unknown", VideoQuality.hd720p, 1);
      unknown.result.title = "My.Show.1080p.WEBRip";
      expect(classifyRowForEpisode(unknown, 2, 5)).toBe("unknown");
    });
  });
});

describe("useStreams", () => {
  beforeEach(() => {
    configuredServerURL.mockReturnValue(null);
    fetchServerStreams.mockReset();
    vi.restoreAllMocks();
  });

  it("loads local streams via indexers and updates state", async () => {
    const indexers = makeIndexer({
      searchAll: vi.fn(async () => [
        torrent({
          infoHash: "abc",
          title: "Movie.1080p",
          seeders: 12,
          quality: VideoQuality.hd1080p,
        }),
      ] as TorrentResult[]),
    });
    const debrid = makeDebrid({ hasServices: true });

    const { result } = renderHook(() => useStreams("tt100", "movie", null, null, indexers, debrid));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.rows).toHaveLength(1);
    expect(result.current.rows[0].result.infoHash).toBe("abc");
    expect(indexers.searchAll).toHaveBeenCalledTimes(1);
    expect(fetchServerStreams).not.toHaveBeenCalled();
    expect(result.current.hasIndexers).toBe(true);
    expect(result.current.hasDebrid).toBe(true);
  });

  it("prioritizes exact matches while preserving in-input order within the same rank", async () => {
    const indexers = makeIndexer({
      searchAll: vi.fn(async () => [
        torrent({
          infoHash: "pack-1",
          title: "Show.S01",
          seeders: 8,
        }),
        torrent({
          infoHash: "exact",
          title: "Show.S01E05",
          seeders: 4,
        }),
        torrent({
          infoHash: "unknown",
          title: "Show.1080p.WebRip",
          seeders: 16,
        }),
        torrent({
          infoHash: "pack-2",
          title: "Show.SEASON 1",
          seeders: 2,
        }),
      ] as TorrentResult[]),
    });
    const debrid = makeDebrid();

    const { result } = renderHook(() => useStreams("tt100", "series", 1, 5, indexers, debrid));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.rows.map((stream) => stream.result.infoHash)).toEqual([
      "exact",
      "pack-1",
      "unknown",
      "pack-2",
    ]);
  });

  it("maps cached entries and ignores non-cached values from debrid cache", async () => {
    const checkCacheAll = vi.fn(async () => ({
      cached: { status: CacheStatus.cached(), service: DebridServiceType.realDebrid },
      "not-cached": {
        status: CacheStatus.notCached,
        service: DebridServiceType.allDebrid,
      },
      "unknown-cache": {
        status: CacheStatus.unknown,
        service: DebridServiceType.premiumize,
      },
    }));
    const indexers = makeIndexer({
      searchAll: vi.fn(async () => [
        torrent({
          infoHash: "cached",
          title: "Show.S01E05",
          seeders: 9,
        }),
        torrent({
          infoHash: "not-cached",
          title: "Show.S01E05",
          seeders: 7,
        }),
        torrent({
          infoHash: "unknown-cache",
          title: "Show.S01E05",
          seeders: 3,
        }),
      ] as TorrentResult[]),
    });
    const debrid = makeDebrid({ hasServices: true, checkCacheAll });

    const { result } = renderHook(() => useStreams("tt100", "series", 1, 5, indexers, debrid));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(checkCacheAll).toHaveBeenCalledWith(["cached", "not-cached", "unknown-cache"]);
    const cachedRow = result.current.rows.find((stream) => stream.result.infoHash === "cached");
    const notCachedRow = result.current.rows.find((stream) => stream.result.infoHash === "not-cached");
    const unknownRow = result.current.rows.find((stream) => stream.result.infoHash === "unknown-cache");
    expect(cachedRow?.cachedOn).toBe(DebridServiceType.realDebrid);
    expect(notCachedRow?.cachedOn).toBeNull();
    expect(unknownRow?.cachedOn).toBeNull();
  });

  it("falls back to uncached rows when debrid cache lookup fails", async () => {
    const indexers = makeIndexer({
      searchAll: vi.fn(async () => [
        torrent({
          infoHash: "cache-check-fails",
          title: "Show.S01E05",
          seeders: 11,
        }),
      ] as TorrentResult[]),
    });
    const debrid = makeDebrid({
      hasServices: true,
      checkCacheAll: vi.fn(async () => {
        throw new Error("cache unavailable");
      }),
    });

    const { result } = renderHook(() => useStreams("tt100", "series", 1, 5, indexers, debrid));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(debrid.checkCacheAll).toHaveBeenCalledTimes(1);
    expect(result.current.rows).toHaveLength(1);
    expect(result.current.rows[0].cachedOn).toBeNull();
  });

  it("sets an error state when local stream resolution rejects", async () => {
    const indexers = makeIndexer({
      searchAll: vi.fn(async () => {
        throw new Error("search failed");
      }),
    });

    const { result } = renderHook(() => useStreams("tt100", "movie", null, null, indexers, null));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.rows).toEqual([]);
    expect(result.current.error).toBe("search failed");
    expect(result.current.hasIndexers).toBe(true);
    expect(result.current.hasDebrid).toBe(false);
  });

  it("short-circuits to empty state when local search returns no streams", async () => {
    const indexers = makeIndexer({
      searchAll: vi.fn(async () => []),
      activeIndexers: ["mock-indexer"],
    });
    const debrid = makeDebrid({ hasServices: true });

    const { result } = renderHook(() => useStreams("tt100", "series", 1, 5, indexers, debrid));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(debrid.checkCacheAll).not.toHaveBeenCalled();
    expect(indexers.searchAll).toHaveBeenCalledTimes(1);
    expect(result.current.rows).toEqual([]);
    expect(result.current.hasDebrid).toBe(true);
  });

  it("skips cache lookups when debrid is present but has no services", async () => {
    const indexers = makeIndexer({
      searchAll: vi.fn(async () => [
        torrent({
          infoHash: "no-cache",
          title: "Show.S01E05",
          seeders: 5,
        }),
      ] as TorrentResult[]),
    });
    const debrid = makeDebrid({ hasServices: false });

    const { result } = renderHook(() => useStreams("tt100", "series", 1, 5, indexers, debrid));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(debrid.checkCacheAll).not.toHaveBeenCalled();
    expect(result.current.rows).toHaveLength(1);
    expect(result.current.rows[0].cachedOn).toBeNull();
  });

  it("stays idle when no imdb id is provided", () => {
    const indexers = makeIndexer();
    const debrid = makeDebrid({ hasServices: true });

    const { result } = renderHook(() => useStreams(null, "movie", null, null, indexers, debrid));
    expect(result.current.loading).toBe(false);
    expect(result.current.rows).toEqual([]);
    expect(indexers.searchAll).not.toHaveBeenCalled();
    expect(result.current.hasIndexers).toBe(true);
    expect(result.current.hasDebrid).toBe(true);
  });

  it("stays idle when no local indexers are active", async () => {
    const indexers = makeIndexer({
      activeIndexers: [],
      searchAll: vi.fn(async () => [torrent({ infoHash: "x" }) as TorrentResult]),
    });
    const debrid = makeDebrid({ hasServices: true });

    const { result } = renderHook(() => useStreams("tt100", "movie", null, null, indexers, debrid));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(indexers.searchAll).not.toHaveBeenCalled();
    expect(result.current.rows).toEqual([]);
    expect(result.current.hasIndexers).toBe(false);
  });

  it("loads server streams when server mode is configured", async () => {
    configuredServerURL.mockReturnValue("http://localhost:5173");
    const indexers = makeIndexer({ activeIndexers: [], searchAll: vi.fn() });

    const debrid = makeDebrid();
    const remote = {
      hasIndexers: false,
      hasDebrid: true,
      rows: [row("remote-1", VideoQuality.hd1080p, 1, false)],
    };
    fetchServerStreams.mockResolvedValue(remote);

    const { result } = renderHook(() => useStreams("tt100", "movie", 1, 2, indexers, debrid));
    await waitFor(() => expect(fetchServerStreams).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(indexers.searchAll).not.toHaveBeenCalled();
    expect(result.current.rows).toHaveLength(1);
    expect(result.current.rows[0].cachedOn).toBeNull();
    expect(result.current.hasIndexers).toBe(false);
    expect(result.current.hasDebrid).toBe(true);
  });

  it("skips local stream errors after unmount", async () => {
    const pending = deferred<TorrentResult[]>();
    const indexers = makeIndexer({
      searchAll: vi.fn(() => pending.promise),
    });
    const debrid = makeDebrid();

    const { unmount } = renderHook(() =>
      useStreams("tt100", "movie", null, null, indexers, debrid),
    );
    unmount();
    pending.reject(new Error("search failed"));

    await Promise.resolve();
  });

  it("skips local stream success updates when unmounted", async () => {
    const pending = deferred<TorrentResult[]>();
    const indexers = makeIndexer({
      searchAll: vi.fn(() => pending.promise),
    });
    const debrid = makeDebrid();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const { unmount } = renderHook(() =>
      useStreams("tt100", "movie", null, null, indexers, debrid),
    );
    unmount();

    pending.resolve([
      torrent({ infoHash: "remote", title: "Movie.1080p", seeders: 11, quality: VideoQuality.hd1080p }),
    ]);
    await Promise.resolve();

    expect(errorSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it("handles non-Error local errors after unmount without state updates", async () => {
    const pending = deferred<TorrentResult[]>();
    const indexers = makeIndexer({
      searchAll: vi.fn(() => pending.promise),
    });
    const debrid = makeDebrid();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const { unmount } = renderHook(() =>
      useStreams("tt100", "movie", null, null, indexers, debrid),
    );
    unmount();
    pending.reject("search failed");

    await Promise.resolve();
    expect(errorSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it("skips server-stream success updates when unmounted before resolve", async () => {
    configuredServerURL.mockReturnValue("http://localhost:5173");
    const indexers = makeIndexer({ activeIndexers: [] });
    const debrid = makeDebrid();
    const pending = deferred<{ rows: StreamRow[]; hasIndexers: boolean; hasDebrid: boolean }>();
    fetchServerStreams.mockReturnValue(pending.promise);

    const { unmount } = renderHook(() =>
      useStreams("tt100", "movie", null, null, indexers, debrid),
    );
    unmount();
    pending.resolve({ rows: [row("r1", VideoQuality.hd1080p, 1)], hasIndexers: true, hasDebrid: true });
    await Promise.resolve();
  });

  it("skips server-mode stream errors after unmount", async () => {
    configuredServerURL.mockReturnValue("http://localhost:5173");
    const indexers = makeIndexer({ activeIndexers: [] });
    const debrid = makeDebrid();
    const pending = deferred<{ rows: StreamRow[]; hasIndexers: boolean; hasDebrid: boolean }>();
    fetchServerStreams.mockReturnValue(pending.promise);

    const { unmount } = renderHook(() =>
      useStreams("tt100", "movie", null, null, indexers, debrid),
    );
    unmount();
    pending.reject(new Error("server stream failed"));

    await Promise.resolve();
  });
});

describe("useStreams cancellation safety", () => {
  it("does not apply server-mode results after unmount", async () => {
    configuredServerURL.mockReturnValue("https://localhost:5173");
    const indexers = makeIndexer({ activeIndexers: [] });
    const debrid = makeDebrid();

    const pending = deferred<{
      hasIndexers: boolean;
      hasDebrid: boolean;
      rows: ReturnType<typeof row>[];
    }>();
    fetchServerStreams.mockReturnValue(pending.promise);

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    fetchServerStreams.mockClear();
    const { unmount } = renderHook(() =>
      useStreams("tt100", "movie", null, null, indexers, debrid),
    );
    unmount();

    pending.resolve({
      hasIndexers: true,
      hasDebrid: true,
      rows: [row("remote-1", VideoQuality.hd1080p, 1)],
    });
    await Promise.resolve();

    expect(errorSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it("does not apply local-mode errors after unmount", async () => {
    configuredServerURL.mockReturnValue(null);
    const indexers = makeIndexer();
    const debrid = makeDebrid();

    const pending = deferred<TorrentResult[]>();
    indexers.searchAll = vi.fn(() => pending.promise);

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { unmount } = renderHook(() =>
      useStreams("tt100", "movie", null, null, indexers, debrid),
    );
    unmount();

    pending.reject(new Error("network gone"));
    await waitFor(() => expect(indexers.searchAll).toHaveBeenCalledTimes(1));

    expect(errorSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});
