import { describe, expect, it, vi } from "vitest";
import { getAppVersion } from "./appVersion";

const browser = () => "browser-version";

describe("getAppVersion", () => {
  it("uses the browser build version outside Tauri", async () => {
    const native = vi.fn(async () => "9.9.9");

    await expect(
      getAppVersion({ isTauri: () => false, native, browser }),
    ).resolves.toBe("browser-version");
    expect(native).not.toHaveBeenCalled();
  });

  it("uses the async native version in Tauri", async () => {
    const native = vi.fn(async () => "1.2.3");

    await expect(
      getAppVersion({ isTauri: () => true, native, browser }),
    ).resolves.toBe("1.2.3");
    expect(native).toHaveBeenCalledOnce();
  });

  it("falls back to the browser version if native lookup fails", async () => {
    const native = vi.fn(async () => {
      throw new Error("native API unavailable");
    });

    await expect(
      getAppVersion({ isTauri: () => true, native, browser }),
    ).resolves.toBe("browser-version");
  });
});
