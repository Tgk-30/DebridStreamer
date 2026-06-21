// Mirrors Tests/.../Services/Debrid/DebridManagerFallbackTests.swift.
//
// A stub DebridService returns a canned StreamInfo or throws, and records the
// calls made against it, so DebridManager's resolveStream priority/preferred/
// fallback selection and validateAll ordering can be exercised without the
// network or the concrete services.

import { describe, expect, it } from "vitest";
import { DebridManager } from "./DebridManager";
import {
  type CacheStatus,
  type DebridAccountInfo,
  type DebridServiceType,
  DebridServiceType as DebridServiceTypeNS,
  type StreamInfo,
  VideoQuality,
  VideoCodec,
  AudioFormat,
  SourceType,
} from "./models";
import { type DebridService, DebridError } from "./types";

interface StubOptions {
  serviceType: DebridServiceType;
  stream?: StreamInfo | null;
  streamError?: DebridError;
  tokenValid?: boolean | null; // null => throw validateError
  validateError?: DebridError;
}

class StubDebridService implements DebridService {
  readonly serviceType: DebridServiceType;
  private readonly cannedStream: StreamInfo | null;
  private readonly streamError: DebridError;
  private readonly tokenValid: boolean | null;
  private readonly validateError: DebridError;

  addMagnetCalls: string[] = [];
  selectFilesCalls: [string, number[]][] = [];
  getStreamURLCalls: string[] = [];
  validateTokenCallCount = 0;

  constructor(opts: StubOptions) {
    this.serviceType = opts.serviceType;
    this.cannedStream = opts.stream ?? null;
    this.streamError = opts.streamError ?? DebridError.downloadFailed("stub failure");
    this.tokenValid = opts.tokenValid === undefined ? true : opts.tokenValid;
    this.validateError = opts.validateError ?? DebridError.invalidToken();
  }

  /** Convenience factory for a canned StreamInfo tagged with this service. */
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

  async checkCache(_hashes: string[]): Promise<Record<string, CacheStatus>> {
    return {};
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
    this.validateTokenCallCount += 1;
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

describe("DebridManager fallback", () => {
  it("resolveStream picks the first (highest-priority) service when no preference given", async () => {
    const first = new StubDebridService({
      serviceType: DebridServiceTypeNS.allDebrid,
      stream: StubDebridService.stream(DebridServiceTypeNS.allDebrid),
    });
    const second = new StubDebridService({
      serviceType: DebridServiceTypeNS.premiumize,
      stream: StubDebridService.stream(DebridServiceTypeNS.premiumize),
    });

    const manager = new DebridManager();
    manager.addService(first);
    manager.addService(second);

    const info = await manager.resolveStream("deadbeef");

    expect(info.debridService).toBe(
      DebridServiceTypeNS.displayName(DebridServiceTypeNS.allDebrid),
    );
    expect(first.getStreamURLCalls.length).toBe(1);
    expect(first.addMagnetCalls).toEqual(["deadbeef"]);
    expect(second.addMagnetCalls.length).toBe(0);
    expect(second.getStreamURLCalls.length).toBe(0);
  });

  it("resolveStream honors preferredService over priority order", async () => {
    const first = new StubDebridService({
      serviceType: DebridServiceTypeNS.allDebrid,
      stream: StubDebridService.stream(DebridServiceTypeNS.allDebrid),
    });
    const second = new StubDebridService({
      serviceType: DebridServiceTypeNS.premiumize,
      stream: StubDebridService.stream(DebridServiceTypeNS.premiumize),
    });

    const manager = new DebridManager();
    manager.addService(first);
    manager.addService(second);

    const info = await manager.resolveStream(
      "cafef00d",
      DebridServiceTypeNS.premiumize,
    );

    expect(info.debridService).toBe(
      DebridServiceTypeNS.displayName(DebridServiceTypeNS.premiumize),
    );
    expect(second.getStreamURLCalls.length).toBe(1);
    expect(second.addMagnetCalls).toEqual(["cafef00d"]);
    expect(first.addMagnetCalls.length).toBe(0);
    expect(first.getStreamURLCalls.length).toBe(0);
  });

  it("resolveStream with a preferred service that is not configured throws", async () => {
    const only = new StubDebridService({
      serviceType: DebridServiceTypeNS.allDebrid,
      stream: StubDebridService.stream(DebridServiceTypeNS.allDebrid),
    });

    const manager = new DebridManager();
    manager.addService(only);

    await expect(
      manager.resolveStream("abc", DebridServiceTypeNS.torBox),
    ).rejects.toBeInstanceOf(DebridError);
    expect(only.addMagnetCalls.length).toBe(0);
  });

  it("resolveStream propagates the selected service's error (no silent cross-service fallback)", async () => {
    const failing = new StubDebridService({
      serviceType: DebridServiceTypeNS.allDebrid,
      stream: null,
      streamError: DebridError.downloadFailed("boom"),
    });
    const healthy = new StubDebridService({
      serviceType: DebridServiceTypeNS.premiumize,
      stream: StubDebridService.stream(DebridServiceTypeNS.premiumize),
    });

    const manager = new DebridManager();
    manager.addService(failing);
    manager.addService(healthy);

    let caught: DebridError | null = null;
    try {
      await manager.resolveStream("xyz");
    } catch (e) {
      caught = e as DebridError;
    }
    expect(caught?.equals(DebridError.downloadFailed("boom"))).toBe(true);

    expect(failing.getStreamURLCalls.length).toBe(1);
    expect(healthy.addMagnetCalls.length).toBe(0);
    expect(healthy.getStreamURLCalls.length).toBe(0);
  });

  it("validateAll returns a result for every configured service, in order", async () => {
    const s1 = new StubDebridService({
      serviceType: DebridServiceTypeNS.realDebrid,
      tokenValid: true,
    });
    const s2 = new StubDebridService({
      serviceType: DebridServiceTypeNS.allDebrid,
      tokenValid: false,
    });
    const s3 = new StubDebridService({
      serviceType: DebridServiceTypeNS.premiumize,
      tokenValid: null, // throws -> false
    });

    const manager = new DebridManager();
    manager.addService(s1);
    manager.addService(s2);
    manager.addService(s3);

    const results = await manager.validateAll();

    expect(results.length).toBe(3);
    expect(results.map((r) => r[0])).toEqual([
      DebridServiceTypeNS.realDebrid,
      DebridServiceTypeNS.allDebrid,
      DebridServiceTypeNS.premiumize,
    ]);
    expect(results.map((r) => r[1])).toEqual([true, false, false]);

    expect(s1.validateTokenCallCount).toBe(1);
    expect(s2.validateTokenCallCount).toBe(1);
    expect(s3.validateTokenCallCount).toBe(1);
  });

  it("validateAll on an empty manager returns no results", async () => {
    const manager = new DebridManager();
    const results = await manager.validateAll();
    expect(results.length).toBe(0);
  });
});

// MARK: - checkCacheAll merge (priority-driven, deterministic)

describe("DebridManager checkCacheAll", () => {
  it("binds each hash to the highest-priority service that reports it cached", async () => {
    // s1 (index 0) says notCached for H; s2 (index 1) says cached for H.
    // A cached entry always beats a non-cached one regardless of priority order.
    const s1 = new StubDebridService({ serviceType: DebridServiceTypeNS.allDebrid });
    const s2 = new StubDebridService({ serviceType: DebridServiceTypeNS.premiumize });

    s1.checkCache = async () => ({ h: { kind: "notCached" } as CacheStatus });
    s2.checkCache = async () => ({
      h: { kind: "cached", fileId: null, fileName: null, fileSize: null } as CacheStatus,
    });

    const manager = new DebridManager();
    manager.addService(s1);
    manager.addService(s2);

    const merged = await manager.checkCacheAll(["h"]);
    expect(merged.h.service).toBe(DebridServiceTypeNS.premiumize);
    expect(merged.h.status.kind).toBe("cached");
  });

  it("returns empty for empty input", async () => {
    const manager = new DebridManager();
    manager.addService(
      new StubDebridService({ serviceType: DebridServiceTypeNS.realDebrid }),
    );
    expect(Object.keys(await manager.checkCacheAll([])).length).toBe(0);
  });
});
