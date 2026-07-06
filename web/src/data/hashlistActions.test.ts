import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  importHashList,
  exportHashList,
  aiEmitHashList,
  type AIEmitDeps,
} from "./hashlistActions";
import type { HashListEntry } from "../lib/hashlist";
import { decodeHashList } from "../lib/hashlist";

// Real infoHashes (40 lowercase hex) so encode/decode round-trips don't drop them.
const H = (n: number) => n.toString(16).padStart(40, "0");
const HASH_A = H(0xa);
const HASH_B = H(0xb);
const HASH_C = H(0xc);

// ---------------------------------------------------------------------------
// importHashList
// ---------------------------------------------------------------------------

describe("importHashList", () => {
  it("adds every magnet, reports progress, and summarizes all-success", async () => {
    const addMagnet = vi.fn().mockResolvedValue(undefined);
    const debrid = { addMagnet } as never;
    const entries: HashListEntry[] = [
      { infoHash: HASH_A, name: "Alpha" },
      { infoHash: HASH_B, name: "Beta" },
      { infoHash: HASH_C, name: null },
    ];

    const progress: Array<[number, number]> = [];
    const summary = await importHashList(entries, debrid, (done, total) =>
      progress.push([done, total]),
    );

    expect(addMagnet).toHaveBeenCalledTimes(3);
    expect(addMagnet).toHaveBeenCalledWith(HASH_A);
    expect(addMagnet).toHaveBeenCalledWith(HASH_B);
    expect(addMagnet).toHaveBeenCalledWith(HASH_C);

    expect(summary.total).toBe(3);
    expect(summary.succeeded).toBe(3);
    expect(summary.failed).toBe(0);
    expect(summary.results).toHaveLength(3);
    // Results preserve order + name (null when absent).
    expect(summary.results[0]).toEqual({
      infoHash: HASH_A,
      name: "Alpha",
      ok: true,
      error: null,
    });
    expect(summary.results[2]).toEqual({
      infoHash: HASH_C,
      name: null,
      ok: true,
      error: null,
    });

    // onProgress fired once per item, final call reaches total.
    expect(progress).toHaveLength(3);
    expect(progress[progress.length - 1]).toEqual([3, 3]);
    // total is always the same; done is strictly increasing.
    expect(progress.map((p) => p[1])).toEqual([3, 3, 3]);
    expect(progress.map((p) => p[0]).sort((a, b) => a - b)).toEqual([1, 2, 3]);
  });

  it("is fault-tolerant: a single failure is recorded but does not abort the batch", async () => {
    const addMagnet = vi
      .fn()
      .mockResolvedValueOnce(undefined) // A ok
      .mockRejectedValueOnce(new Error("boom")) // B fails
      .mockResolvedValueOnce(undefined); // C ok
    const debrid = { addMagnet } as never;
    const entries: HashListEntry[] = [
      { infoHash: HASH_A, name: "A" },
      { infoHash: HASH_B, name: "B" },
      { infoHash: HASH_C, name: "C" },
    ];

    const summary = await importHashList(entries, debrid);

    expect(summary.total).toBe(3);
    expect(summary.succeeded).toBe(2);
    expect(summary.failed).toBe(1);
    expect(summary.results[1]).toEqual({
      infoHash: HASH_B,
      name: "B",
      ok: false,
      error: "boom",
    });
  });

  it("stringifies non-Error rejections in the error field", async () => {
    const addMagnet = vi.fn().mockRejectedValue("plain string failure");
    const debrid = { addMagnet } as never;

    const summary = await importHashList([{ infoHash: HASH_A }], debrid);

    expect(summary.failed).toBe(1);
    expect(summary.results[0].ok).toBe(false);
    expect(summary.results[0].error).toBe("plain string failure");
    expect(summary.results[0].name).toBeNull();
  });

  it("handles an empty entry list (no workers spawned, empty summary)", async () => {
    const addMagnet = vi.fn();
    const debrid = { addMagnet } as never;
    const onProgress = vi.fn();

    const summary = await importHashList([], debrid, onProgress);

    expect(addMagnet).not.toHaveBeenCalled();
    expect(onProgress).not.toHaveBeenCalled();
    expect(summary).toEqual({
      total: 0,
      succeeded: 0,
      failed: 0,
      results: [],
    });
  });

  it("bounds concurrency to 4 in-flight adds for a large batch", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const addMagnet = vi.fn().mockImplementation(async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await Promise.resolve();
      await Promise.resolve();
      inFlight -= 1;
    });
    const debrid = { addMagnet } as never;
    const entries: HashListEntry[] = Array.from({ length: 20 }, (_, i) => ({
      infoHash: H(i + 1),
    }));

    const summary = await importHashList(entries, debrid);

    expect(summary.succeeded).toBe(20);
    expect(addMagnet).toHaveBeenCalledTimes(20);
    expect(maxInFlight).toBeLessThanOrEqual(4);
  });
});

// ---------------------------------------------------------------------------
// exportHashList
// ---------------------------------------------------------------------------

describe("exportHashList", () => {
  it("encodes infoHash+name rows into a decodable hash-list string", () => {
    const torrents = [
      { infoHash: HASH_A, name: "Alpha" },
      { infoHash: HASH_B, name: "Beta" },
    ] as never;

    const encoded = exportHashList(torrents);

    expect(encoded.startsWith("dshl1:")).toBe(true);
    const decoded = decodeHashList(encoded);
    expect(decoded).toEqual([
      { infoHash: HASH_A, name: "Alpha" },
      { infoHash: HASH_B, name: "Beta" },
    ]);
  });

  it("drops rows whose infoHash is null or empty", () => {
    const torrents = [
      { infoHash: HASH_A, name: "Keep" },
      { infoHash: null, name: "NullHash" },
      { infoHash: "", name: "EmptyHash" },
      { infoHash: HASH_B, name: "AlsoKeep" },
    ] as never;

    const encoded = exportHashList(torrents);
    const decoded = decodeHashList(encoded);

    expect(decoded.map((e) => e.infoHash)).toEqual([HASH_A, HASH_B]);
  });

  it("throws when no torrents have a usable infoHash (empty encode is invalid)", () => {
    const torrents = [
      { infoHash: null, name: "x" },
      { infoHash: "", name: "y" },
    ] as never;

    // encodeHashList of an empty list produces a string that decodes to no
    // valid hashes — decodeHashList throws on that. The export itself does not
    // throw (it builds the string), but the round-trip proves it carries nothing.
    const encoded = exportHashList(torrents);
    expect(encoded.startsWith("dshl1:")).toBe(true);
    expect(() => decodeHashList(encoded)).toThrow();
  });
});

// ---------------------------------------------------------------------------
// aiEmitHashList
// ---------------------------------------------------------------------------

function makeIndexers(active: string[], overrides: Partial<any> = {}) {
  return {
    activeIndexers: active,
    searchAll: vi.fn().mockResolvedValue([]),
    searchByQuery: vi.fn().mockResolvedValue([]),
    ...overrides,
  } as never;
}

function rec(title: string) {
  return { title, reason: "", score: 0 };
}

function torrent(infoHash: string, seeders: number) {
  return { id: infoHash, infoHash, seeders };
}

describe("aiEmitHashList", () => {
  beforeEach(() => vi.clearAllMocks());

  it("throws a clear error when no AI provider is configured", async () => {
    const deps: AIEmitDeps = {
      ai: null,
      tmdb: null,
      indexers: makeIndexers(["x"]),
      debrid: null,
    };
    await expect(aiEmitHashList("cozy movies", 5, deps)).rejects.toThrow(
      /Configure an AI provider in Settings/,
    );
  });

  it("throws when there are no active indexers", async () => {
    const ai = { recommend: vi.fn() } as never;
    const deps: AIEmitDeps = {
      ai,
      tmdb: null,
      indexers: makeIndexers([]),
      debrid: null,
    };
    await expect(aiEmitHashList("cozy movies", 5, deps)).rejects.toThrow(
      /Configure at least one indexer/,
    );
  });

  it("throws when the assistant returns no usable titles", async () => {
    const ai = {
      recommend: vi.fn().mockResolvedValue({
        model: null,
        recommendations: [rec("   "), rec("")],
        rawText: null,
        usage: null,
      }),
    } as never;
    const deps: AIEmitDeps = {
      ai,
      tmdb: null,
      indexers: makeIndexers(["x"]),
      debrid: null,
    };
    await expect(aiEmitHashList("p", 3, deps)).rejects.toThrow(
      /returned no titles to resolve/,
    );
  });

  it("throws when none of the titles resolve to a torrent", async () => {
    const ai = {
      recommend: vi.fn().mockResolvedValue({
        model: null,
        recommendations: [rec("Movie A"), rec("Movie B")],
        rawText: null,
        usage: null,
      }),
    } as never;
    // No tmdb -> searchByQuery path, which returns [] for both.
    const indexers = makeIndexers(["x"], {
      searchByQuery: vi.fn().mockResolvedValue([]),
    });
    const deps: AIEmitDeps = { ai, tmdb: null, indexers, debrid: null };

    await expect(aiEmitHashList("p", 2, deps)).rejects.toThrow(
      /Could not resolve any of the suggested titles/,
    );
  });

  it("resolves titles via searchByQuery when no TMDB, picks top result, reports unresolved", async () => {
    const recommend = vi.fn().mockResolvedValue({
      model: null,
      recommendations: [rec(" Movie A "), rec("Movie B")],
      rawText: null,
      usage: null,
    });
    const ai = { recommend } as never;
    const searchByQuery = vi.fn(async (query: string) => {
      if (query === "Movie A") return [torrent(HASH_A, 100), torrent(HASH_B, 5)];
      return []; // Movie B unresolved
    });
    const indexers = makeIndexers(["x"], { searchByQuery });
    const deps: AIEmitDeps = { ai, tmdb: null, indexers, debrid: null };

    const result = await aiEmitHashList("p", 2, deps);

    // Title is trimmed before resolution.
    expect(searchByQuery).toHaveBeenCalledWith("Movie A", "movie");
    // First (seeder-sorted top) result chosen; name carries the title.
    expect(result.entries).toEqual([{ infoHash: HASH_A, name: "Movie A" }]);
    expect(result.unresolved).toEqual(["Movie B"]);
    // Encoded string round-trips to the resolved entry.
    expect(decodeHashList(result.encoded)).toEqual([
      { infoHash: HASH_A, name: "Movie A" },
    ]);
    expect(recommend).toHaveBeenCalledWith("p", [], 2);
  });

  it("uses TMDB imdb id + searchAll when a detail with a tt-id is found", async () => {
    const ai = {
      recommend: vi.fn().mockResolvedValue({
        model: null,
        recommendations: [rec("Inception")],
        rawText: null,
        usage: null,
      }),
    } as never;
    const search = vi.fn().mockResolvedValue({
      items: [{ id: "27205", type: "movie" }],
    });
    const getDetail = vi.fn().mockResolvedValue({ id: "tt1375666", type: "movie" });
    const tmdb = { search, getDetail } as never;
    const searchAll = vi.fn().mockResolvedValue([torrent(HASH_C, 50)]);
    const indexers = makeIndexers(["x"], { searchAll });
    const deps: AIEmitDeps = { ai, tmdb, indexers, debrid: null };

    const result = await aiEmitHashList("p", 1, deps);

    expect(search).toHaveBeenCalledWith("Inception", null, 1);
    expect(getDetail).toHaveBeenCalledWith("27205", "movie");
    expect(searchAll).toHaveBeenCalledWith("tt1375666", "movie");
    expect(result.entries).toEqual([{ infoHash: HASH_C, name: "Inception" }]);
    expect(result.unresolved).toEqual([]);
  });

  it("falls back to searchByQuery when TMDB detail has no tt-id", async () => {
    const ai = {
      recommend: vi.fn().mockResolvedValue({
        model: null,
        recommendations: [rec("Some Show")],
        rawText: null,
        usage: null,
      }),
    } as never;
    const tmdb = {
      search: vi.fn().mockResolvedValue({
        items: [{ id: "999", type: "tv" }],
      }),
      // Detail id does not start with "tt" -> imdbId stays null.
      getDetail: vi.fn().mockResolvedValue({ id: "999", type: "tv" }),
    } as never;
    const searchAll = vi.fn().mockResolvedValue([torrent(HASH_A, 1)]);
    const searchByQuery = vi.fn().mockResolvedValue([torrent(HASH_B, 9)]);
    const indexers = makeIndexers(["x"], { searchAll, searchByQuery });
    const deps: AIEmitDeps = { ai, tmdb, indexers, debrid: null };

    const result = await aiEmitHashList("p", 1, deps);

    // Type is carried from the TMDB top match ("tv").
    expect(searchByQuery).toHaveBeenCalledWith("Some Show", "tv");
    expect(searchAll).not.toHaveBeenCalled();
    expect(result.entries).toEqual([{ infoHash: HASH_B, name: "Some Show" }]);
  });

  it("falls back to searchByQuery when getDetail rejects (caught -> null detail)", async () => {
    const ai = {
      recommend: vi.fn().mockResolvedValue({
        model: null,
        recommendations: [rec("Boom")],
        rawText: null,
        usage: null,
      }),
    } as never;
    const tmdb = {
      search: vi.fn().mockResolvedValue({ items: [{ id: "5", type: "movie" }] }),
      getDetail: vi.fn().mockRejectedValue(new Error("tmdb down")),
    } as never;
    const searchByQuery = vi.fn().mockResolvedValue([torrent(HASH_A, 3)]);
    const indexers = makeIndexers(["x"], { searchByQuery });
    const deps: AIEmitDeps = { ai, tmdb, indexers, debrid: null };

    const result = await aiEmitHashList("p", 1, deps);

    expect(searchByQuery).toHaveBeenCalledWith("Boom", "movie");
    expect(result.entries).toEqual([{ infoHash: HASH_A, name: "Boom" }]);
  });

  it("uses searchByQuery when TMDB search yields no items", async () => {
    const ai = {
      recommend: vi.fn().mockResolvedValue({
        model: null,
        recommendations: [rec("Nothing")],
        rawText: null,
        usage: null,
      }),
    } as never;
    const getDetail = vi.fn();
    const tmdb = {
      search: vi.fn().mockResolvedValue({ items: [] }),
      getDetail,
    } as never;
    const searchByQuery = vi.fn().mockResolvedValue([torrent(HASH_C, 2)]);
    const indexers = makeIndexers(["x"], { searchByQuery });
    const deps: AIEmitDeps = { ai, tmdb, indexers, debrid: null };

    const result = await aiEmitHashList("p", 1, deps);

    expect(getDetail).not.toHaveBeenCalled();
    expect(searchByQuery).toHaveBeenCalledWith("Nothing", "movie");
    expect(result.entries).toEqual([{ infoHash: HASH_C, name: "Nothing" }]);
  });

  it("prefers a cached result over the seeder-top pick when debrid has services", async () => {
    const ai = {
      recommend: vi.fn().mockResolvedValue({
        model: null,
        recommendations: [rec("Cached Pick")],
        rawText: null,
        usage: null,
      }),
    } as never;
    // First result (HASH_A) is top by seeders, but HASH_B is the cached one.
    const searchByQuery = vi
      .fn()
      .mockResolvedValue([torrent(HASH_A, 100), torrent(HASH_B, 10)]);
    const indexers = makeIndexers(["x"], { searchByQuery });
    const checkCacheAll = vi.fn().mockResolvedValue({
      [HASH_A]: { status: { kind: "uncached" } },
      [HASH_B]: { status: { kind: "cached" } },
    });
    const debrid = { hasServices: true, checkCacheAll } as never;
    const deps: AIEmitDeps = { ai, tmdb: null, indexers, debrid };

    const result = await aiEmitHashList("p", 1, deps);

    expect(checkCacheAll).toHaveBeenCalledWith([HASH_A, HASH_B]);
    expect(result.entries).toEqual([{ infoHash: HASH_B, name: "Cached Pick" }]);
  });

  it("keeps the seeder-top pick when checkCacheAll throws", async () => {
    const ai = {
      recommend: vi.fn().mockResolvedValue({
        model: null,
        recommendations: [rec("Fallback Pick")],
        rawText: null,
        usage: null,
      }),
    } as never;
    const searchByQuery = vi
      .fn()
      .mockResolvedValue([torrent(HASH_A, 100), torrent(HASH_B, 10)]);
    const indexers = makeIndexers(["x"], { searchByQuery });
    const checkCacheAll = vi.fn().mockRejectedValue(new Error("cache check failed"));
    const debrid = { hasServices: true, checkCacheAll } as never;
    const deps: AIEmitDeps = { ai, tmdb: null, indexers, debrid };

    const result = await aiEmitHashList("p", 1, deps);

    expect(checkCacheAll).toHaveBeenCalled();
    // No cached pick found -> top (HASH_A) retained.
    expect(result.entries).toEqual([{ infoHash: HASH_A, name: "Fallback Pick" }]);
  });

  it("keeps the seeder-top pick when cache lookup has no cached rows", async () => {
    const ai = {
      recommend: vi.fn().mockResolvedValue({
        model: null,
        recommendations: [rec("No Cache Match")],
        rawText: null,
        usage: null,
      }),
    } as never;
    const searchByQuery = vi
      .fn()
      .mockResolvedValue([torrent(HASH_A, 100), torrent(HASH_B, 10)]);
    const indexers = makeIndexers(["x"], { searchByQuery });
    const checkCacheAll = vi.fn().mockResolvedValue({
      [HASH_A]: { status: { kind: "uncached" } },
      [HASH_B]: { status: { kind: "uncached" } },
    });
    const debrid = { hasServices: true, checkCacheAll } as never;
    const deps: AIEmitDeps = { ai, tmdb: null, indexers, debrid };

    const result = await aiEmitHashList("p", 1, deps);

    expect(checkCacheAll).toHaveBeenCalledWith([HASH_A, HASH_B]);
    expect(result.entries).toEqual([{ infoHash: HASH_A, name: "No Cache Match" }]);
  });

  it("skips cache lookup when debrid has no services", async () => {
    const ai = {
      recommend: vi.fn().mockResolvedValue({
        model: null,
        recommendations: [rec("No Services")],
        rawText: null,
        usage: null,
      }),
    } as never;
    const searchByQuery = vi
      .fn()
      .mockResolvedValue([torrent(HASH_A, 100), torrent(HASH_B, 10)]);
    const indexers = makeIndexers(["x"], { searchByQuery });
    const checkCacheAll = vi.fn();
    const debrid = { hasServices: false, checkCacheAll } as never;
    const deps: AIEmitDeps = { ai, tmdb: null, indexers, debrid };

    const result = await aiEmitHashList("p", 1, deps);

    expect(checkCacheAll).not.toHaveBeenCalled();
    expect(result.entries).toEqual([{ infoHash: HASH_A, name: "No Services" }]);
  });

  it("treats a thrown indexer search as an unresolved title (never fatal alone)", async () => {
    const ai = {
      recommend: vi.fn().mockResolvedValue({
        model: null,
        recommendations: [rec("Throws"), rec("Works")],
        rawText: null,
        usage: null,
      }),
    } as never;
    const searchByQuery = vi.fn(async (query: string) => {
      if (query === "Throws") throw new Error("indexer exploded");
      return [torrent(HASH_C, 7)];
    });
    const indexers = makeIndexers(["x"], { searchByQuery });
    const deps: AIEmitDeps = { ai, tmdb: null, indexers, debrid: null };

    const result = await aiEmitHashList("p", 2, deps);

    expect(result.entries).toEqual([{ infoHash: HASH_C, name: "Works" }]);
    expect(result.unresolved).toEqual(["Throws"]);
  });
});
