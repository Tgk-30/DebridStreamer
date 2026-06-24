// Tests for the smart-preload per-device preference + idle scheduler.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  isSmartPreloadEnabled,
  setSmartPreloadEnabled,
  whenIdle,
} from "./smartPreload";

function mockLocalStorage() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    clear: () => m.clear(),
    key: () => null,
    length: 0,
  };
}

describe("smart-preload preference", () => {
  beforeEach(() => vi.stubGlobal("localStorage", mockLocalStorage()));
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("defaults to enabled when nothing is stored", () => {
    expect(isSmartPreloadEnabled()).toBe(true);
  });

  it("round-trips the persisted flag", () => {
    setSmartPreloadEnabled(false);
    expect(localStorage.getItem("ds_smart_preload")).toBe("0");
    expect(isSmartPreloadEnabled()).toBe(false);

    setSmartPreloadEnabled(true);
    expect(localStorage.getItem("ds_smart_preload")).toBe("1");
    expect(isSmartPreloadEnabled()).toBe(true);
  });

  it("treats only the exact '0' as disabled", () => {
    localStorage.setItem("ds_smart_preload", "anything-else");
    expect(isSmartPreloadEnabled()).toBe(true);
  });

  it("is resilient when localStorage throws (private mode)", () => {
    vi.stubGlobal("localStorage", {
      getItem() {
        throw new Error("blocked");
      },
      setItem() {
        throw new Error("blocked");
      },
    });
    expect(isSmartPreloadEnabled()).toBe(true); // safe default
    expect(() => setSmartPreloadEnabled(false)).not.toThrow();
  });
});

describe("whenIdle", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("uses requestIdleCallback when available", () => {
    const ric = vi.fn((cb: () => void) => {
      cb();
      return 1;
    });
    vi.stubGlobal("requestIdleCallback", ric);
    const fn = vi.fn();
    whenIdle(fn);
    expect(ric).toHaveBeenCalledOnce();
    expect(fn).toHaveBeenCalledOnce();
  });

  it("falls back to a timeout when requestIdleCallback is absent", () => {
    vi.stubGlobal("requestIdleCallback", undefined);
    vi.useFakeTimers();
    const fn = vi.fn();
    whenIdle(fn);
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1200);
    expect(fn).toHaveBeenCalledOnce();
  });
});
