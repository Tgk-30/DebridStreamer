// Core coverage for the stream-RESOLUTION layer of streams.ts — the part that
// the existing two suites deliberately skip.
//
//   - streams.test.ts        → happy paths of the pure filter/quality exports.
//   - streams.extra.test.ts  → boundary/edge behavior of those same pure exports.
//
// Neither exercises `useStreams` or the private `resolveStreams` it wraps,
// because the vitest env is "node" with no jsdom / @testing-library / renderer.
// This file fills that gap by mocking `react` so the hook's body, callback and
// effect run synchronously in node, letting us assert the cache-merge / sort /
// error / server-mode / empty / no-indexer branches end-to-end through the only
// export that reaches `resolveStreams`.
//
// We never re-test the pure exports here (no duplication).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MediaType } from "../models/media";
import { CacheStatus, DebridServiceType } from "../services/debrid/models";
import {
  AudioFormat,
  SourceType,
  VideoCodec,
  VideoQuality,
  type TorrentResult,
} from "../services/indexers/models";
import type {
  DebridManager,
  MergedCacheEntry,
} from "../services/debrid/DebridManager";
import type { IndexerManager } from "../services/indexers/IndexerManager";

// ---------------------------------------------------------------------------
// react mock: run the hook synchronously, capturing setState transitions.
// useState  → real cell backed by a module-level slot (reset per render).
// useCallback/useMemo → identity (return the factory result / fn).
// useEffect → store the effect; the harness runs it after the render returns.
// ---------------------------------------------------------------------------
interface HookCell {
  state: unknown;
  effect: (() => void | (() => void)) | null;
}
let cell: HookCell = { state: undefined, effect: null };
let stateInitialized = false;

vi.mock("react", () => ({
  useState: (init: unknown) => {
    if (!stateInitialized) {
      cell.state = typeof init === "function" ? (init as () => unknown)() : init;
      stateInitialized = true;
    }
    const setState = (next: unknown) => {
      cell.state = typeof next === "function" ? (next as (s: unknown) => unknown)(cell.state) : next;
    };
    return [cell.state, setState];
  },
  useCallback: <T>(fn: T) => fn,
  useMemo: <T>(factory: () => T) => factory(),
  useEffect: (effect: () => void | (() => void)) => {
    cell.effect = effect;
  },
  useRef: (init: unknown) => ({ current: init }),
}));

// serverMode + serverApi are mocked so we can flip Local vs Server mode.
vi.mock("../lib/serverMode", () => ({
  configuredServerURL: vi.fn(() => null),
}));
vi.mock("../lib/serverApi", () => ({
  fetchServerStreams: vi.fn(),
}));

import { useStreams, type StreamsState } from "./streams";
import { configuredServerURL } from "../lib/serverMode";
import { fetchServerStreams } from "../lib/serverApi";

const mockConfiguredServerURL = vi.mocked(configuredServerURL);
const mockFetchServerStreams = vi.mocked(fetchServerStreams);

const GB = 1024 * 1024 * 1024;

function torrent(overrides: Partial<TorrentResult>): TorrentResult {
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

/** Minimal IndexerManager stand-in: only activeIndexers + searchAll are read. */
function fakeIndexers(opts: {
  active?: string[];
  searchAll?: (imdbId: string, type: MediaType) => Promise<TorrentResult[]>;
}): IndexerManager {
  return {
    get activeIndexers() {
      return opts.active ?? ["jackett"];
    },
    searchAll:
      opts.searchAll ?? (async () => [] as TorrentResult[]),
  } as unknown as IndexerManager;
}

/** Minimal DebridManager stand-in: only hasServices + checkCacheAll are read. */
function fakeDebrid(opts: {
  hasServices?: boolean;
  checkCacheAll?: (hashes: string[]) => Promise<Record<string, MergedCacheEntry>>;
}): DebridManager {
  return {
    get hasServices() {
      return opts.hasServices ?? true;
    },
    checkCacheAll:
      opts.checkCacheAll ?? (async () => ({} as Record<string, MergedCacheEntry>)),
  } as unknown as DebridManager;
}

/** Render `useStreams` once and run its effect to completion. Returns the final
 * captured state plus a cleanup that mirrors React's effect-teardown. */
async function renderStreams(
  imdbId: string | null,
  type: MediaType,
  indexers: IndexerManager,
  debrid: DebridManager | null,
): Promise<{ state: StreamsState; cleanup: () => void }> {
  // First synchronous render: the hook returns the initial state and registers
  // its effect.
  const initial = useStreams(imdbId, type, indexers, debrid);
  // Run the registered effect (kicks off the async run + returns teardown).
  const teardown = cell.effect ? cell.effect() : undefined;
  // Flush the microtask queue so the async `run` settles into setState.
  await flush();
  return {
    state: cell.state as StreamsState,
    cleanup: () => {
      if (typeof teardown === "function") teardown();
    },
  };
  // `initial` intentionally unused beyond proving the first render didn't throw.
  void initial;
}

/** Let pending promise chains settle. A few macrotask ticks cover the
 * searchAll → checkCacheAll → map → setState pipeline. */
async function flush(): Promise<void> {
  for (let i = 0; i < 5; i++) {
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
  }
}

beforeEach(() => {
  cell = { state: undefined, effect: null };
  stateInitialized = false;
  mockConfiguredServerURL.mockReturnValue(null);
  mockFetchServerStreams.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("useStreams — idle / no-imdb / no-indexer guards", () => {
  it("is idle (not loading, empty) when imdbId is null", async () => {
    const indexers = fakeIndexers({ active: ["jackett"] });
    const { state } = await renderStreams(null, "movie", indexers, null);
    expect(state.loading).toBe(false);
    expect(state.rows).toEqual([]);
    expect(state.error).toBeNull();
    // hasIndexers still reflects the configured indexers even when idle.
    expect(state.hasIndexers).toBe(true);
  });

  it("does NOT load when no indexers are configured (Local mode)", async () => {
    const search = vi.fn(async () => [torrent({ infoHash: "a" })]);
    const indexers = fakeIndexers({ active: [], searchAll: search });
    const { state } = await renderStreams("tt1", "movie", indexers, null);
    expect(state.loading).toBe(false);
    expect(state.rows).toEqual([]);
    expect(state.hasIndexers).toBe(false);
    // searchAll must never be invoked when there are no active indexers.
    expect(search).not.toHaveBeenCalled();
  });
});

describe("useStreams — Local resolve path (resolveStreams)", () => {
  it("returns empty rows (no debrid call) when searchAll yields nothing", async () => {
    const checkCacheAll = vi.fn(async () => ({}));
    const indexers = fakeIndexers({ searchAll: async () => [] });
    const debrid = fakeDebrid({ hasServices: true, checkCacheAll });
    const { state } = await renderStreams("tt1", "movie", indexers, debrid);
    expect(state.loading).toBe(false);
    expect(state.rows).toEqual([]);
    expect(state.error).toBeNull();
    expect(checkCacheAll).not.toHaveBeenCalled(); // early return before cache check
  });

  it("annotates each row with its cached service when debrid reports cache", async () => {
    const results = [
      torrent({ infoHash: "h1", title: "A" }),
      torrent({ infoHash: "h2", title: "B" }),
      torrent({ infoHash: "h3", title: "C" }),
    ];
    const checkCacheAll = vi.fn(
      async (): Promise<Record<string, MergedCacheEntry>> => ({
        h1: { service: DebridServiceType.realDebrid, status: CacheStatus.cached() },
        // h2 reported but NOT cached → must be filtered out → cachedOn null.
        h2: { service: DebridServiceType.allDebrid, status: CacheStatus.notCached },
        // h3 absent entirely → cachedOn null.
      }),
    );
    const indexers = fakeIndexers({ searchAll: async () => results });
    const debrid = fakeDebrid({ hasServices: true, checkCacheAll });
    const { state } = await renderStreams("tt9", "series", indexers, debrid);

    expect(checkCacheAll).toHaveBeenCalledWith(["h1", "h2", "h3"]);
    expect(state.rows.map((r) => [r.result.infoHash, r.cachedOn])).toEqual([
      ["h1", DebridServiceType.realDebrid],
      ["h2", null],
      ["h3", null],
    ]);
    expect(state.loading).toBe(false);
    expect(state.error).toBeNull();
  });

  it("preserves searchAll order (resolveStreams maps, does not sort)", async () => {
    const results = [
      torrent({ infoHash: "z", quality: VideoQuality.sd480p }),
      torrent({ infoHash: "a", quality: VideoQuality.uhd4k }),
      torrent({ infoHash: "m", quality: VideoQuality.hd1080p }),
    ];
    const indexers = fakeIndexers({ searchAll: async () => results });
    const debrid = fakeDebrid({ hasServices: true });
    const { state } = await renderStreams("tt1", "movie", indexers, debrid);
    expect(state.rows.map((r) => r.result.infoHash)).toEqual(["z", "a", "m"]);
  });

  it("leaves every row uncached when no debrid manager is supplied", async () => {
    const results = [torrent({ infoHash: "h1" }), torrent({ infoHash: "h2" })];
    const indexers = fakeIndexers({ searchAll: async () => results });
    const { state } = await renderStreams("tt1", "movie", indexers, null);
    expect(state.rows.map((r) => r.cachedOn)).toEqual([null, null]);
    expect(state.hasDebrid).toBe(false);
  });

  it("skips the cache check when debrid has no services", async () => {
    const checkCacheAll = vi.fn(async () => ({}));
    const results = [torrent({ infoHash: "h1" })];
    const indexers = fakeIndexers({ searchAll: async () => results });
    const debrid = fakeDebrid({ hasServices: false, checkCacheAll });
    const { state } = await renderStreams("tt1", "movie", indexers, debrid);
    expect(checkCacheAll).not.toHaveBeenCalled();
    expect(state.rows[0].cachedOn).toBeNull();
    expect(state.hasDebrid).toBe(false);
  });

  it("swallows a checkCacheAll rejection and returns uncached rows", async () => {
    const results = [torrent({ infoHash: "h1" }), torrent({ infoHash: "h2" })];
    const checkCacheAll = vi.fn(async () => {
      throw new Error("debrid down");
    });
    const indexers = fakeIndexers({ searchAll: async () => results });
    const debrid = fakeDebrid({ hasServices: true, checkCacheAll });
    const { state } = await renderStreams("tt1", "movie", indexers, debrid);
    // The try/catch inside resolveStreams turns the cache failure into "all
    // uncached" — it is NOT surfaced as a top-level error.
    expect(state.error).toBeNull();
    expect(state.rows.map((r) => r.cachedOn)).toEqual([null, null]);
  });
});

describe("useStreams — error path", () => {
  it("surfaces a searchAll Error message into state.error", async () => {
    const indexers = fakeIndexers({
      searchAll: async () => {
        throw new Error("indexer exploded");
      },
    });
    const { state } = await renderStreams("tt1", "movie", indexers, null);
    expect(state.error).toBe("indexer exploded");
    expect(state.rows).toEqual([]);
    expect(state.loading).toBe(false);
  });

  it("stringifies a non-Error throw into state.error", async () => {
    const indexers = fakeIndexers({
      searchAll: async () => {
        throw "plain string failure";
      },
    });
    const { state } = await renderStreams("tt1", "movie", indexers, null);
    expect(state.error).toBe("plain string failure");
    expect(state.rows).toEqual([]);
  });
});

describe("useStreams — cancellation", () => {
  it("does not commit results after the effect is torn down (cancelled)", async () => {
    let resolveSearch: (v: TorrentResult[]) => void = () => {};
    const indexers = fakeIndexers({
      searchAll: () =>
        new Promise<TorrentResult[]>((res) => {
          resolveSearch = res;
        }),
    });
    // Render and immediately tear down BEFORE the search resolves.
    const initial = useStreams("tt1", "movie", indexers, null);
    expect(initial.loading).toBe(true); // imdb + indexers ⇒ starts loading
    const teardown = cell.effect ? cell.effect() : undefined;
    if (typeof teardown === "function") teardown(); // mark cancelled

    const before = (cell.state as StreamsState).rows.length;
    resolveSearch([torrent({ infoHash: "late" })]);
    await flush();
    // Cancelled signal ⇒ the late result is dropped, state.rows unchanged.
    expect((cell.state as StreamsState).rows.length).toBe(before);
  });
});

describe("useStreams — Server mode", () => {
  beforeEach(() => {
    mockConfiguredServerURL.mockReturnValue("https://srv.example");
  });

  it("hasIndexers/hasDebrid are forced true and the server stream list is used", async () => {
    mockFetchServerStreams.mockResolvedValue({
      rows: [
        { result: torrent({ infoHash: "s1" }), cachedOn: DebridServiceType.torBox },
      ],
      hasIndexers: true,
      hasDebrid: false,
    });
    // Local indexers/debrid are empty, but server mode overrides the gating.
    const indexers = fakeIndexers({ active: [] });
    const { state } = await renderStreams("tt5", "movie", indexers, null);

    expect(mockFetchServerStreams).toHaveBeenCalledWith({ imdbId: "tt5", type: "movie" });
    expect(state.rows.map((r) => r.result.infoHash)).toEqual(["s1"]);
    expect(state.rows[0].cachedOn).toBe(DebridServiceType.torBox);
    // server response drives the final hasIndexers/hasDebrid flags.
    expect(state.hasIndexers).toBe(true);
    expect(state.hasDebrid).toBe(false);
    expect(state.loading).toBe(false);
  });

  it("surfaces a server fetch error into state.error", async () => {
    mockFetchServerStreams.mockRejectedValue(new Error("503 from server"));
    const indexers = fakeIndexers({ active: [] });
    const { state } = await renderStreams("tt5", "movie", indexers, null);
    expect(state.error).toBe("503 from server");
    expect(state.rows).toEqual([]);
    expect(state.loading).toBe(false);
  });

  it("never calls local searchAll while in server mode", async () => {
    mockFetchServerStreams.mockResolvedValue({ rows: [], hasIndexers: true, hasDebrid: true });
    const search = vi.fn(async () => [torrent({ infoHash: "local" })]);
    const indexers = fakeIndexers({ active: ["jackett"], searchAll: search });
    await renderStreams("tt5", "movie", indexers, null);
    expect(search).not.toHaveBeenCalled();
    expect(mockFetchServerStreams).toHaveBeenCalledTimes(1);
  });
});
