// Port of Sources/DebridStreamer/Services/Debrid/DebridManager.swift.
//
// Manages multiple debrid services and routes requests to the best available one.
// Mirrors the Swift actor's order-independent, priority-driven merge in
// checkCacheAll, the resolveStream preferred/priority selection (with the
// Real-Debrid smart findExistingTorrent flow), and the concurrent, order-
// preserving validateAll. The keychain/secret-resolution `configure(configs:)`
// path is intentionally not ported here (no DB/keychain in the web layer);
// services are registered directly via addService, as the Swift tests do.

import { CacheStatus, type DebridServiceType, DebridServiceType as DebridServiceTypeNS, type StreamInfo } from "./models";
import { type DebridService, DebridError } from "./types";
import { RealDebridService } from "./RealDebridService";

/** Per-hash merged cache result: the bound service plus its reported status. */
export interface MergedCacheEntry {
  service: DebridServiceType;
  status: CacheStatus;
}

export class DebridManager {
  private services: DebridService[] = [];

  /** Add a single service. Mirrors Swift `addService`. Insertion order is the
   * priority order (services[0] is highest priority). */
  addService(service: DebridService): void {
    this.services.push(service);
  }

  /** All active service types. Mirrors `activeServiceTypes`. */
  get activeServiceTypes(): DebridServiceType[] {
    return this.services.map((s) => s.serviceType);
  }

  /** Mirrors `hasServices`. */
  get hasServices(): boolean {
    return this.services.length > 0;
  }

  /** Check cache across all active services, binding each hash to the highest-
   * priority service that reports it (cached beats non-cached; ties broken by the
   * lower priority index). The merge is deterministic regardless of completion
   * order. Mirrors Swift `checkCacheAll`. */
  async checkCacheAll(
    hashes: string[],
  ): Promise<Record<string, MergedCacheEntry>> {
    if (hashes.length === 0) return {};

    // Query all services concurrently, carrying each service's priority index.
    const collected = await Promise.all(
      this.services.map(async (service, index) => {
        let cache: Record<string, CacheStatus> = {};
        try {
          cache = await service.checkCache(hashes);
        } catch {
          cache = {};
        }
        return { index, serviceType: service.serviceType, cache };
      }),
    );

    // Deterministic merge by priority index.
    const results: Record<
      string,
      { index: number; service: DebridServiceType; status: CacheStatus }
    > = {};
    for (const entry of collected.sort((a, b) => a.index - b.index)) {
      for (const [hash, status] of Object.entries(entry.cache)) {
        const existing = results[hash];
        if (existing) {
          const beatsCacheState =
            CacheStatus.isCached(status) && !CacheStatus.isCached(existing.status);
          const sameCacheStateLowerIndex =
            CacheStatus.isCached(status) === CacheStatus.isCached(existing.status) &&
            entry.index < existing.index;
          if (beatsCacheState || sameCacheStateLowerIndex) {
            results[hash] = {
              index: entry.index,
              service: entry.serviceType,
              status,
            };
          }
        } else {
          results[hash] = {
            index: entry.index,
            service: entry.serviceType,
            status,
          };
        }
      }
    }

    const out: Record<string, MergedCacheEntry> = {};
    for (const [hash, v] of Object.entries(results)) {
      out[hash] = { service: v.service, status: v.status };
    }
    return out;
  }

  /** Resolve a torrent hash to a stream URL using the preferred (or first
   * available) service. Mirrors Swift `resolveStream`. No silent cross-service
   * fallback: the selected service's error propagates. */
  async resolveStream(
    hash: string,
    preferredService: DebridServiceType | null = null,
  ): Promise<StreamInfo> {
    let service: DebridService;

    if (preferredService != null) {
      const found = this.services.find((s) => s.serviceType === preferredService);
      if (found == null) {
        throw DebridError.networkError(
          `Service ${DebridServiceTypeNS.displayName(preferredService)} not configured`,
        );
      }
      service = found;
    } else {
      const first = this.services[0];
      if (first == null) {
        throw DebridError.networkError("No debrid services configured");
      }
      service = first;
    }

    // For Real-Debrid, use the smart resolve flow.
    if (service instanceof RealDebridService) {
      return this.resolveWithRealDebrid(service, hash);
    }

    // Generic flow for other services.
    const torrentId = await service.addMagnet(hash);
    await service.selectFiles(torrentId, []);
    return service.getStreamURL(torrentId);
  }

  /** Smart Real-Debrid resolve flow: reuse an existing torrent if present, else
   * add the magnet, then poll for the stream URL. Mirrors `resolveWithRealDebrid`. */
  private async resolveWithRealDebrid(
    service: RealDebridService,
    hash: string,
  ): Promise<StreamInfo> {
    let torrentId: string;

    let existingId: string | null = null;
    try {
      existingId = await service.findExistingTorrent(hash);
    } catch {
      existingId = null; // mirrors Swift `try?`
    }

    if (existingId != null) {
      torrentId = existingId;
    } else {
      torrentId = await service.addMagnet(hash);
    }

    return service.getStreamURL(torrentId);
  }

  /** Validate all configured services concurrently, preserving service order in
   * the result. Mirrors Swift `validateAll`. */
  async validateAll(): Promise<[DebridServiceType, boolean][]> {
    const collected = await Promise.all(
      this.services.map(async (service, index) => {
        let valid = false;
        try {
          valid = await service.validateToken();
        } catch {
          valid = false;
        }
        return { index, serviceType: service.serviceType, valid };
      }),
    );
    return collected
      .sort((a, b) => a.index - b.index)
      .map((c) => [c.serviceType, c.valid] as [DebridServiceType, boolean]);
  }
}
