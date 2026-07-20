import { describe, expect, it, vi } from "vitest";
import {
  compareAppVersions,
  getAppVersion,
  getNativeAppVersion,
} from "./appVersion";

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

describe("getNativeAppVersion", () => {
  it("does not hide a failed native lookup behind the hosted web version", async () => {
    const native = vi.fn(async () => {
      throw new Error("native API unavailable");
    });

    await expect(
      getNativeAppVersion({ isTauri: () => true, native, browser }),
    ).resolves.toBeNull();
  });
});

describe("compareAppVersions", () => {
  it.each([
    ["0.9.21", "0.9.24", -1],
    ["0.10.0", "0.9.24", 1],
    ["v1.2.3", "1.2.3", 0],
    ["1.2.3-beta.2", "1.2.3-beta.10", -1],
    ["1.2.3-beta", "1.2.3", -1],
  ])("compares %s with %s", (left, right, direction) => {
    expect(Math.sign(compareAppVersions(left, right))).toBe(direction);
  });
});
