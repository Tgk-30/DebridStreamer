// Additional DebridManager coverage beyond DebridManagerFallback.test.ts:
// provider selection/priority edge cases, fallback/error-isolation across
// providers, checkCacheAll aggregation/tie-breaking, listTorrents ordering &
// fault tolerance, deleteTorrent routing, addMagnet preference, getTranscodeHLS
// branches, and empty-provider states.

import { describe, expect, it } from "vitest";
import { DebridManager } from "./DebridManager";
import { RealDebridService } from "./RealDebridService";
import {
  CacheStatus,
  type DebridAccountInfo,
  type DebridServiceType,
  DebridServiceType as DebridServiceTypeNS,
  type DebridTorrent,
  type StreamInfo,
  VideoQuality,
  VideoCodec,
  AudioFormat,
  SourceType,
} from "./models";
import { type DebridService, DebridError, type FetchImpl } from "./types";

interface StubOptions {
  serviceType: DebridServiceType;
  stream?: StreamInfo | null;
  streamError?: DebridError;
  tokenValid?: boolean | null;
  validateError?: DebridError;
  cache?: Record<string, CacheStatus>;
  cacheError?: DebridError;
  torrents?: DebridTorrent[];
  listError?: DebridError;
  /** When false, the stub omits listTorrents/deleteTorrent entirely. */
  supportsListing?: boolean;
  deleteError?: DebridError;
}

class StubDebridService implements DebridService {
  readonly serviceType: DebridServiceType;
  private readonly cannedStream: StreamInfo | null;
  private readonly streamError: DebridError;
  private readonly tokenValid: boolean | null;
  private readonly validateError: DebridError;
  private readonly cache: Record<string, CacheStatus>;
  private readonly cacheError: DebridError | null;
  private readonly torrents: DebridTorrent[];
  private readonly listError: DebridError | null;
  private readonly deleteError: DebridError | null;

  addMagnetCalls: string[] = [];
  selectFilesCalls: [string, number[]][] = [];
  getStreamURLCalls: string[] = [];
  checkCacheCalls: string[][] = [];
  listTorrentsCallCount = 0;
  deleteTorrentCalls: string[] = [];

  listTorrents?: () => Promise<DebridTorrent[]>;
  deleteTorrent?: (id: string) => Promise<void>;

  constructor(opts: StubOptions) {
    this.serviceType = opts.serviceType;
    this.cannedStream = opts.stream ?? null;
    this.streamError = opts.streamError ?? DebridError.downloadFailed("stub failure");
    this.tokenValid = opts.tokenValid === undefined ? true : opts.tokenValid;
    this.validateError = opts.validateError ?? DebridError.invalidToken();
    this.cache = opts.cache ?? {};
    this.cacheError = opts.cacheError ?? null;
    this.torrents = opts.torrents ?? [];
    this.listError = opts.listError ?? null;
    this.deleteError = opts.deleteError ?? null;

    if (opts.supportsListing !== false) {
      this.listTorrents = async () => {
        this.listTorrentsCallCount += 1;
        if (this.listError) throw this.listError;
        return this.torrents;
      };
      this.deleteTorrent = async (id: string) => {
        this.deleteTorrentCalls.push(id);
        if (this.deleteError) throw this.deleteError;
      };
    }
  }

  static stream(serviceType: DebridServiceType): StreamInfo {
    return {
      streamURL: `https://example.com/${serviceType}.mkv`,
      quality: VideoQuality.unknown,
      codec: VideoCodec.unknown,
      audio: AudioFormat.unknown,
      source: SourceType.unknown,
      sizeBytes: 1_000,
      fileName: `${serviceType}.mkv`,
      debridService: DebridServiceTypeNS.displayName(serviceType),
    };
  }

  static torrent(
    serviceType: DebridServiceType,
    id: string,
    name: string,
  ): DebridTorrent {
    return {
      id,
      name,
      sizeBytes: 0,
      status: "downloaded",
      infoHash: null,
      addedAt: null,
      host: null,
      progress: null,
      debridService: DebridServiceTypeNS.shortCode(serviceType),
    };
  }

  async checkCache(hashes: string[]): Promise<Record<string, CacheStatus>> {
    this.checkCacheCalls.push(hashes);
    if (this.cacheError) throw this.cacheError;
    return this.cache;
  }

  async addMagnet(hash: string): Promise<string> {
    this.addMagnetCalls.push(hash);
    return `torrent-${this.serviceType}`;
  }

  async selectFiles(torrentId: string, fileIds: number[]): Promise<void> {
    this.selectFilesCalls.push([torrentId, fileIds]);
  }

  async getStreamURL(torrentId: string): Promise<StreamInfo> {
    this.getStreamURLCalls.push(torrentId);
    if (this.cannedStream) return this.cannedStream;
    throw this.streamError;
  }

  async unrestrict(_link: string): Promise<string> {
    throw DebridError.networkError("not implemented in stub");
  }

  async validateToken(): Promise<boolean> {
    if (this.tokenValid !== null) return this.tokenValid;
    throw this.validateError;
  }

  async getAccountInfo(): Promise<DebridAccountInfo> {
    return {
      username: "stub",
      email: null,
      premiumExpiry: null,
      isPremium: true,
      points: null,
    };
  }
}

const cached = (): CacheStatus => ({
  kind: "cached",
  fileId: null,
  fileName: null,
  fileSize: null,
});

// MARK: - provider state / selection

describe("DebridManager provider state", () => {
  it("starts with no services", () => {
    const manager = new DebridManager();
    expect(manager.hasServices).toBe(false);
    expect(manager.activeServiceTypes).toEqual([]);
  });

  it("reports active service types in insertion (priority) order", () => {
    const manager = new DebridManager();
    manager.addService(
      new StubDebridService({ serviceType: DebridServiceTypeNS.realDebrid }),
    );
    manager.addService(
      new StubDebridService({ serviceType: DebridServiceTypeNS.allDebrid }),
    );
    expect(manager.hasServices).toBe(true);
    expect(manager.activeServiceTypes).toEqual([
      DebridServiceTypeNS.realDebrid,
      DebridServiceTypeNS.allDebrid,
    ]);
  });
});

describe("DebridManager resolveStream selection", () => {
  it("throws when no services are configured (empty manager)", async () => {
    const manager = new DebridManager();
    let caught: DebridError | null = null;
    try {
      await manager.resolveStream("abc");
    } catch (e) {
      caught = e as DebridError;
    }
    expect(caught).toBeInstanceOf(DebridError);
    expect(caught?.kind).toBe("networkError");
    expect(caught?.equals(DebridError.networkError("No debrid services configured"))).toBe(
      true,
    );
  });

  it("runs the generic add/select/getStream flow for a non-RealDebrid service", async () => {
    const stub = new StubDebridService({
      serviceType: DebridServiceTypeNS.allDebrid,
      stream: StubDebridService.stream(DebridServiceTypeNS.allDebrid),
    });
    const manager = new DebridManager();
    manager.addService(stub);

    const info = await manager.resolveStream("hash1");

    expect(info.debridService).toBe(
      DebridServiceTypeNS.displayName(DebridServiceTypeNS.allDebrid),
    );
    expect(stub.addMagnetCalls).toEqual(["hash1"]);
    // selectFiles is invoked with the returned torrent id and an empty file list.
    expect(stub.selectFilesCalls).toEqual([
      [`torrent-${DebridServiceTypeNS.allDebrid}`, []],
    ]);
    expect(stub.getStreamURLCalls).toEqual([`torrent-${DebridServiceTypeNS.allDebrid}`]);
  });

  it("preferred-not-configured error names the requested service", async () => {
    const only = new StubDebridService({
      serviceType: DebridServiceTypeNS.allDebrid,
      stream: StubDebridService.stream(DebridServiceTypeNS.allDebrid),
    });
    const manager = new DebridManager();
    manager.addService(only);

    let caught: DebridError | null = null;
    try {
      await manager.resolveStream("abc", DebridServiceTypeNS.premiumize);
    } catch (e) {
      caught = e as DebridError;
    }
    expect(caught?.kind).toBe("networkError");
    expect(caught?.message).toContain(
      DebridServiceTypeNS.displayName(DebridServiceTypeNS.premiumize),
    );
  });
});

// MARK: - Real-Debrid smart resolve flow (instanceof RealDebridService)

describe("DebridManager resolveStream RealDebrid flow", () => {
  // A fetch stub that drives RealDebridService.findExistingTorrent + getStreamURL.
  // RD's baseURL carries a `/rest/1.0` prefix, so match the path suffix
  // (everything after that prefix), ignoring the query string.
  function rdFetch(handler: (path: string, body: string) => { status: number; body: string }): FetchImpl {
    return async (url, init) => {
      const u = new URL(url);
      const path = u.pathname.replace(/^\/rest\/1\.0/, "");
      const res = handler(path, init?.body ?? "");
      return { status: res.status, text: async () => res.body };
    };
  }

  it("reuses an existing torrent (no addMagnet) and skips selectFiles", async () => {
    // /torrents (list) returns a torrent whose hash matches -> findExistingTorrent
    // resolves it; getStreamURL then polls /torrents/info/{id}.
    const hash = "AABBCCDD";
    let addMagnetCalled = false;
    const fetchImpl = rdFetch((path) => {
      if (path === "/torrents") {
        return {
          status: 200,
          body: JSON.stringify([{ id: "existing-id", hash: hash.toLowerCase() }]),
        };
      }
      if (path === "/torrents/addMagnet") {
        addMagnetCalled = true;
        return { status: 200, body: JSON.stringify({ id: "new-id" }) };
      }
      if (path === "/torrents/info/existing-id") {
        return {
          status: 200,
          body: JSON.stringify({
            status: "downloaded",
            links: ["https://rd.example/restricted/movie.mkv"],
            files: [
              { id: 1, path: "/Movie.2026.1080p.BluRay.x264.mkv", bytes: 4_000_000_000, selected: 1 },
            ],
          }),
        };
      }
      if (path === "/unrestrict/link") {
        return {
          status: 200,
          body: JSON.stringify({
            id: "unrestrict-id",
            download: "https://rd.example/direct/movie.mkv",
            filename: "Movie.2026.1080p.BluRay.x264.mkv",
            filesize: 4_000_000_000,
          }),
        };
      }
      return { status: 404, body: "{}" };
    });

    const rd = new RealDebridService("rd-token", fetchImpl);
    const manager = new DebridManager();
    manager.addService(rd);

    const info = await manager.resolveStream(hash);

    expect(info.streamURL).toBe("https://rd.example/direct/movie.mkv");
    expect(info.debridService).toBe("RD");
    expect(addMagnetCalled).toBe(false);
  });

  it("falls back to addMagnet when no existing torrent matches", async () => {
    const hash = "DEADBEEF";
    let addMagnetCalled = false;
    const fetchImpl = rdFetch((path) => {
      if (path === "/torrents") {
        return { status: 200, body: JSON.stringify([]) };
      }
      if (path === "/torrents/addMagnet") {
        addMagnetCalled = true;
        return { status: 200, body: JSON.stringify({ id: "new-id" }) };
      }
      if (path === "/torrents/info/new-id") {
        return {
          status: 200,
          body: JSON.stringify({
            status: "downloaded",
            links: ["https://rd.example/restricted/x.mkv"],
            files: [{ id: 1, path: "/x.1080p.mkv", bytes: 100, selected: 1 }],
          }),
        };
      }
      if (path === "/unrestrict/link") {
        return {
          status: 200,
          body: JSON.stringify({
            id: "u1",
            download: "https://rd.example/direct/x.mkv",
            filename: "x.1080p.mkv",
            filesize: 100,
          }),
        };
      }
      return { status: 404, body: "{}" };
    });

    const rd = new RealDebridService("rd-token", fetchImpl);
    const manager = new DebridManager();
    manager.addService(rd);

    const info = await manager.resolveStream(hash);
    expect(addMagnetCalled).toBe(true);
    expect(info.streamURL).toBe("https://rd.example/direct/x.mkv");
  });

  it("swallows a findExistingTorrent failure and still adds the magnet", async () => {
    const hash = "FACEFEED";
    let addMagnetCalled = false;
    const fetchImpl = rdFetch((path) => {
      if (path === "/torrents") {
        // 500 makes findExistingTorrent throw; manager's try/catch -> null.
        return { status: 500, body: "boom" };
      }
      if (path === "/torrents/addMagnet") {
        addMagnetCalled = true;
        return { status: 200, body: JSON.stringify({ id: "new-id" }) };
      }
      if (path === "/torrents/info/new-id") {
        return {
          status: 200,
          body: JSON.stringify({
            status: "downloaded",
            links: ["https://rd.example/restricted/y.mkv"],
            files: [{ id: 1, path: "/y.720p.mkv", bytes: 50, selected: 1 }],
          }),
        };
      }
      if (path === "/unrestrict/link") {
        return {
          status: 200,
          body: JSON.stringify({
            id: "u2",
            download: "https://rd.example/direct/y.mkv",
            filename: "y.720p.mkv",
            filesize: 50,
          }),
        };
      }
      return { status: 404, body: "{}" };
    });

    const rd = new RealDebridService("rd-token", fetchImpl);
    const manager = new DebridManager();
    manager.addService(rd);

    const info = await manager.resolveStream(hash);
    expect(addMagnetCalled).toBe(true);
    expect(info.streamURL).toBe("https://rd.example/direct/y.mkv");
  });
});

// MARK: - addMagnet routing

describe("DebridManager addMagnet", () => {
  it("uses the highest-priority service when no preference given", async () => {
    const first = new StubDebridService({ serviceType: DebridServiceTypeNS.allDebrid });
    const second = new StubDebridService({ serviceType: DebridServiceTypeNS.premiumize });
    const manager = new DebridManager();
    manager.addService(first);
    manager.addService(second);

    const id = await manager.addMagnet("h");
    expect(id).toBe(`torrent-${DebridServiceTypeNS.allDebrid}`);
    expect(first.addMagnetCalls).toEqual(["h"]);
    expect(second.addMagnetCalls.length).toBe(0);
  });

  it("honors a preferred service", async () => {
    const first = new StubDebridService({ serviceType: DebridServiceTypeNS.allDebrid });
    const second = new StubDebridService({ serviceType: DebridServiceTypeNS.premiumize });
    const manager = new DebridManager();
    manager.addService(first);
    manager.addService(second);

    const id = await manager.addMagnet("h", DebridServiceTypeNS.premiumize);
    expect(id).toBe(`torrent-${DebridServiceTypeNS.premiumize}`);
    expect(second.addMagnetCalls).toEqual(["h"]);
    expect(first.addMagnetCalls.length).toBe(0);
  });

  it("throws on an empty manager", async () => {
    const manager = new DebridManager();
    await expect(manager.addMagnet("h")).rejects.toBeInstanceOf(DebridError);
  });
});

// MARK: - checkCacheAll aggregation & error isolation

describe("DebridManager checkCacheAll aggregation", () => {
  it("returns {} for empty input even with services configured", async () => {
    const manager = new DebridManager();
    manager.addService(
      new StubDebridService({ serviceType: DebridServiceTypeNS.allDebrid, cache: { h: cached() } }),
    );
    expect(await manager.checkCacheAll([])).toEqual({});
  });

  it("isolates a failing service: the other service's results still merge in", async () => {
    const failing = new StubDebridService({
      serviceType: DebridServiceTypeNS.allDebrid,
      cacheError: DebridError.httpError(500, "down"),
    });
    const healthy = new StubDebridService({
      serviceType: DebridServiceTypeNS.premiumize,
      cache: { h: cached() },
    });
    const manager = new DebridManager();
    manager.addService(failing);
    manager.addService(healthy);

    const merged = await manager.checkCacheAll(["h"]);
    expect(merged.h.service).toBe(DebridServiceTypeNS.premiumize);
    expect(merged.h.status.kind).toBe("cached");
  });

  it("returns {} when every service fails", async () => {
    const a = new StubDebridService({
      serviceType: DebridServiceTypeNS.allDebrid,
      cacheError: DebridError.networkError("a"),
    });
    const b = new StubDebridService({
      serviceType: DebridServiceTypeNS.premiumize,
      cacheError: DebridError.networkError("b"),
    });
    const manager = new DebridManager();
    manager.addService(a);
    manager.addService(b);

    expect(await manager.checkCacheAll(["h"])).toEqual({});
  });

  it("ties on cache state are broken by the lower priority index (first service wins)", async () => {
    // Both report cached for h: the higher-priority (index 0) service binds it.
    const s1 = new StubDebridService({
      serviceType: DebridServiceTypeNS.allDebrid,
      cache: { h: cached() },
    });
    const s2 = new StubDebridService({
      serviceType: DebridServiceTypeNS.premiumize,
      cache: { h: cached() },
    });
    const manager = new DebridManager();
    manager.addService(s1);
    manager.addService(s2);

    const merged = await manager.checkCacheAll(["h"]);
    expect(merged.h.service).toBe(DebridServiceTypeNS.allDebrid);
  });

  it("a later cached result still overrides an earlier non-cached one", async () => {
    // index 0 says notCached, index 1 says cached -> cached wins regardless of order.
    const s1 = new StubDebridService({
      serviceType: DebridServiceTypeNS.allDebrid,
      cache: { h: CacheStatus.notCached },
    });
    const s2 = new StubDebridService({
      serviceType: DebridServiceTypeNS.premiumize,
      cache: { h: cached() },
    });
    const manager = new DebridManager();
    manager.addService(s1);
    manager.addService(s2);

    const merged = await manager.checkCacheAll(["h"]);
    expect(merged.h.service).toBe(DebridServiceTypeNS.premiumize);
    expect(merged.h.status.kind).toBe("cached");
  });

  it("keeps the first non-cached service when no service reports cached", async () => {
    // Neither is cached; same cache state, so the lower index (s1) wins.
    const s1 = new StubDebridService({
      serviceType: DebridServiceTypeNS.allDebrid,
      cache: { h: CacheStatus.notCached },
    });
    const s2 = new StubDebridService({
      serviceType: DebridServiceTypeNS.premiumize,
      cache: { h: CacheStatus.unknown },
    });
    const manager = new DebridManager();
    manager.addService(s1);
    manager.addService(s2);

    const merged = await manager.checkCacheAll(["h"]);
    expect(merged.h.service).toBe(DebridServiceTypeNS.allDebrid);
    expect(merged.h.status.kind).toBe("notCached");
  });

  it("aggregates distinct hashes across services, each bound to its reporter", async () => {
    const s1 = new StubDebridService({
      serviceType: DebridServiceTypeNS.allDebrid,
      cache: { h1: cached() },
    });
    const s2 = new StubDebridService({
      serviceType: DebridServiceTypeNS.premiumize,
      cache: { h2: CacheStatus.notCached },
    });
    const manager = new DebridManager();
    manager.addService(s1);
    manager.addService(s2);

    const merged = await manager.checkCacheAll(["h1", "h2"]);
    expect(merged.h1.service).toBe(DebridServiceTypeNS.allDebrid);
    expect(merged.h2.service).toBe(DebridServiceTypeNS.premiumize);
    expect(merged.h2.status.kind).toBe("notCached");
  });

  it("returns {} for empty input on an empty manager", async () => {
    const manager = new DebridManager();
    expect(await manager.checkCacheAll([])).toEqual({});
  });
});

// MARK: - listTorrents ordering & fault tolerance

describe("DebridManager listTorrents", () => {
  it("returns [] on an empty manager", async () => {
    const manager = new DebridManager();
    expect(await manager.listTorrents()).toEqual([]);
  });

  it("preserves service order, keeping each service's rows together", async () => {
    const s1 = new StubDebridService({
      serviceType: DebridServiceTypeNS.allDebrid,
      torrents: [
        StubDebridService.torrent(DebridServiceTypeNS.allDebrid, "a1", "A1"),
        StubDebridService.torrent(DebridServiceTypeNS.allDebrid, "a2", "A2"),
      ],
    });
    const s2 = new StubDebridService({
      serviceType: DebridServiceTypeNS.premiumize,
      torrents: [StubDebridService.torrent(DebridServiceTypeNS.premiumize, "p1", "P1")],
    });
    const manager = new DebridManager();
    manager.addService(s1);
    manager.addService(s2);

    const rows = await manager.listTorrents();
    expect(rows.map((r) => r.id)).toEqual(["a1", "a2", "p1"]);
  });

  it("treats a service without listTorrents as contributing no rows", async () => {
    const noList = new StubDebridService({
      serviceType: DebridServiceTypeNS.allDebrid,
      supportsListing: false,
    });
    const withList = new StubDebridService({
      serviceType: DebridServiceTypeNS.premiumize,
      torrents: [StubDebridService.torrent(DebridServiceTypeNS.premiumize, "p1", "P1")],
    });
    const manager = new DebridManager();
    manager.addService(noList);
    manager.addService(withList);

    const rows = await manager.listTorrents();
    expect(rows.map((r) => r.id)).toEqual(["p1"]);
  });

  it("a throwing service contributes no rows but does not fail the whole call", async () => {
    const failing = new StubDebridService({
      serviceType: DebridServiceTypeNS.allDebrid,
      listError: DebridError.httpError(503, "unavailable"),
    });
    const healthy = new StubDebridService({
      serviceType: DebridServiceTypeNS.premiumize,
      torrents: [StubDebridService.torrent(DebridServiceTypeNS.premiumize, "p1", "P1")],
    });
    const manager = new DebridManager();
    manager.addService(failing);
    manager.addService(healthy);

    const rows = await manager.listTorrents();
    expect(rows.map((r) => r.id)).toEqual(["p1"]);
  });
});

// MARK: - deleteTorrent routing

describe("DebridManager deleteTorrent", () => {
  it("routes to the service matching the short code", async () => {
    const ad = new StubDebridService({ serviceType: DebridServiceTypeNS.allDebrid });
    const pm = new StubDebridService({ serviceType: DebridServiceTypeNS.premiumize });
    const manager = new DebridManager();
    manager.addService(ad);
    manager.addService(pm);

    await manager.deleteTorrent("xyz", "PM");
    expect(pm.deleteTorrentCalls).toEqual(["xyz"]);
    expect(ad.deleteTorrentCalls.length).toBe(0);
  });

  it("throws when no service matches the requested short code", async () => {
    const ad = new StubDebridService({ serviceType: DebridServiceTypeNS.allDebrid });
    const manager = new DebridManager();
    manager.addService(ad);

    let caught: DebridError | null = null;
    try {
      await manager.deleteTorrent("xyz", "TB");
    } catch (e) {
      caught = e as DebridError;
    }
    expect(caught?.kind).toBe("networkError");
    expect(caught?.message).toContain("TB");
    expect(ad.deleteTorrentCalls.length).toBe(0);
  });

  it("throws when the matching service does not support delete", async () => {
    const ad = new StubDebridService({
      serviceType: DebridServiceTypeNS.allDebrid,
      supportsListing: false, // no deleteTorrent method
    });
    const manager = new DebridManager();
    manager.addService(ad);

    await expect(manager.deleteTorrent("xyz", "AD")).rejects.toMatchObject({
      kind: "networkError",
    });
  });

  it("propagates an error thrown by the matching service's delete", async () => {
    const ad = new StubDebridService({
      serviceType: DebridServiceTypeNS.allDebrid,
      deleteError: DebridError.httpError(500, "fail"),
    });
    const manager = new DebridManager();
    manager.addService(ad);

    await expect(manager.deleteTorrent("xyz", "AD")).rejects.toMatchObject({
      kind: "httpError",
    });
  });
});

// MARK: - getTranscodeHLS branches

describe("DebridManager getTranscodeHLS", () => {
  const baseStream = (restrictedId?: string): StreamInfo => ({
    streamURL: "https://x/y.mkv",
    quality: VideoQuality.unknown,
    codec: VideoCodec.unknown,
    audio: AudioFormat.unknown,
    source: SourceType.unknown,
    sizeBytes: 1,
    fileName: "y.mkv",
    debridService: "RD",
    restrictedId,
  });

  it("returns null when the stream has no restrictedId", async () => {
    const manager = new DebridManager();
    manager.addService(new RealDebridService("rd", async () => ({ status: 200, text: async () => "{}" })));
    expect(await manager.getTranscodeHLS(baseStream(undefined))).toBeNull();
  });

  it("returns null when restrictedId is empty string", async () => {
    const manager = new DebridManager();
    manager.addService(new RealDebridService("rd", async () => ({ status: 200, text: async () => "{}" })));
    expect(await manager.getTranscodeHLS(baseStream(""))).toBeNull();
  });

  it("returns null when no RealDebrid service is configured", async () => {
    const manager = new DebridManager();
    manager.addService(new StubDebridService({ serviceType: DebridServiceTypeNS.allDebrid }));
    expect(await manager.getTranscodeHLS(baseStream("rid-123"))).toBeNull();
  });

  it("returns the HLS URL when RealDebrid has a transcode", async () => {
    const fetchImpl: FetchImpl = async (url) => {
      const u = new URL(url);
      if (u.pathname.endsWith("/streaming/transcode/rid-123")) {
        return {
          status: 200,
          text: async () =>
            JSON.stringify({ apple: { full: "https://rd.example/hls/master.m3u8" } }),
        };
      }
      return { status: 404, text: async () => "{}" };
    };
    const manager = new DebridManager();
    manager.addService(new RealDebridService("rd", fetchImpl));
    const hls = await manager.getTranscodeHLS(baseStream("rid-123"));
    expect(hls).toBe("https://rd.example/hls/master.m3u8");
  });

  it("swallows a transcode HTTP failure to null", async () => {
    const fetchImpl: FetchImpl = async () => ({ status: 500, text: async () => "boom" });
    const manager = new DebridManager();
    manager.addService(new RealDebridService("rd", fetchImpl));
    expect(await manager.getTranscodeHLS(baseStream("rid-123"))).toBeNull();
  });
});

// MARK: - validateAll error isolation

describe("DebridManager validateAll error isolation", () => {
  it("a thrown validateToken maps to false without failing the others", async () => {
    const ok = new StubDebridService({
      serviceType: DebridServiceTypeNS.realDebrid,
      tokenValid: true,
    });
    const boom = new StubDebridService({
      serviceType: DebridServiceTypeNS.allDebrid,
      tokenValid: null, // throws
      validateError: DebridError.rateLimited(),
    });
    const manager = new DebridManager();
    manager.addService(ok);
    manager.addService(boom);

    const results = await manager.validateAll();
    expect(results).toEqual([
      [DebridServiceTypeNS.realDebrid, true],
      [DebridServiceTypeNS.allDebrid, false],
    ]);
  });
});
