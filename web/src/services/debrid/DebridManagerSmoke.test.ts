import { describe, expect, it, vi } from "vitest";
import { CacheStatus, type DebridServiceType } from "./models";
import { DebridManager } from "./DebridManager";
import type { DebridService } from "./types";

function service(
  serviceType: DebridServiceType,
  options: { valid?: boolean; cache?: boolean; throws?: boolean } = {},
): DebridService {
  const hash = "0000000000000000000000000000000000000000";
  return {
    serviceType,
    validateToken: vi.fn(async () => {
      if (options.throws) throw new Error("offline");
      return options.valid ?? true;
    }),
    checkCache: vi.fn(async () =>
      options.cache === false ? {} : { [hash]: CacheStatus.notCached },
    ),
    addMagnet: vi.fn(),
    selectFiles: vi.fn(),
    getStreamURL: vi.fn(),
    unrestrict: vi.fn(),
    getAccountInfo: vi.fn(),
  } as unknown as DebridService;
}

describe("DebridManager provider smoke checks", () => {
  it("checks account and cache paths without mutating provider state", async () => {
    const manager = new DebridManager();
    const healthy = service("torbox");
    manager.addService(healthy);

    await expect(manager.smokeTestProviders()).resolves.toMatchObject([
      {
        service: "torbox",
        accountReachable: true,
        cacheReachable: true,
      },
    ]);
    expect(healthy.addMagnet).not.toHaveBeenCalled();
    expect(healthy.selectFiles).not.toHaveBeenCalled();
    expect(healthy.getStreamURL).not.toHaveBeenCalled();
  });

  it("isolates failures and preserves provider order", async () => {
    const manager = new DebridManager();
    manager.addService(service("torbox", { throws: true }));
    manager.addService(service("real_debrid", { cache: false }));

    await expect(manager.smokeTestProviders()).resolves.toMatchObject([
      {
        service: "torbox",
        accountReachable: false,
        cacheReachable: false,
      },
      {
        service: "real_debrid",
        accountReachable: true,
        cacheReachable: false,
      },
    ]);
  });

  it("rejects malformed hashes before calling providers", async () => {
    const manager = new DebridManager();
    manager.addService(service("premiumize"));
    await expect(manager.smokeTestProviders("bad-hash")).rejects.toThrow(
      "40-character info hash",
    );
  });
});
