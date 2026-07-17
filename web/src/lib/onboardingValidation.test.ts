import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setNetworkMode } from "./networkPolicy";
import { testOmdbKey } from "./onboardingValidation";

// testOmdbKey uses raw fetch (not the gated OMDBService), so it must enforce the
// privacy gate itself. In Offline mode the OMDb key must never leave the device.
describe("testOmdbKey privacy gate", () => {
  const fetchSpy = vi.fn();
  const original = globalThis.fetch;

  beforeEach(() => {
    setNetworkMode("standard");
    fetchSpy.mockReset();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
  });
  afterEach(() => {
    setNetworkMode("standard");
    globalThis.fetch = original;
  });

  it("never sends the key off-device when ratings are blocked (offline)", async () => {
    setNetworkMode("offline");
    await expect(testOmdbKey("SECRET-OMDB-KEY")).resolves.toBe("network");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("reaches OMDb normally in standard mode", async () => {
    fetchSpy.mockResolvedValue({ status: 200, json: async () => ({ Response: "True" }) });
    await expect(testOmdbKey("GOOD-KEY")).resolves.toBe("ok");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});
