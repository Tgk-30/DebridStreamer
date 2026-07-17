import { describe, expect, it, vi } from "vitest";
import { TraktSyncService } from "./TraktSyncService";
import * as Types from "./types";

describe("TraktSyncService constructor", () => {
  it("defaults to global fetch when fetchImpl is not provided", async () => {
    const body = JSON.stringify({
      device_code: "dev-code",
      user_code: "ABCD-EFGH",
      verification_url: "https://trakt.tv/activate",
      expires_in: 600,
      interval: 5,
    });
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue({ status: 200, text: async () => body } as Response);

    try {
      const service = new TraktSyncService();
      const result = await service.startDeviceAuth("client-id");

      expect(result.deviceCode).toBe("dev-code");
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    } finally {
      fetchSpy.mockRestore();
    }
  });
});

describe("TraktSyncService request decode mapping", () => {
  it("maps non-Trakt decoder failures to decodingFailed", async () => {
    const fetchImpl = vi.fn(async () => ({
      status: 200,
      text: async () =>
        JSON.stringify({
          device_code: "dev-code",
          user_code: "ABCD-EFGH",
          verification_url: "https://trakt.tv/activate",
          expires_in: 600,
          interval: 5,
        }),
    }));
    const decodeSpy = vi
      .spyOn(Types, "decodeDeviceCodeResponse")
      .mockImplementation(() => {
        throw new Error("plain decode failure");
      });

    try {
      const service = new TraktSyncService(fetchImpl);
      await expect(service.startDeviceAuth("client-id")).rejects.toMatchObject({
        kind: "decodingFailed",
      });
    } finally {
      decodeSpy.mockRestore();
    }
  });
});
