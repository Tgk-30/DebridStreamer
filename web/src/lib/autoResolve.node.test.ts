// @vitest-environment node
//
// Node environment has no global `window`, which drives the default Tauri gate branch
// in AutoResolveScheduler (isTauriSafe should return false).

import { afterEach, describe, expect, it, vi } from "vitest";
import { AutoResolveScheduler } from "./autoResolve";
import { defaultSettings, type AppSettings } from "../data/settings";

function preview(id = "tt1"): { id: string; type: "movie"; title: string } {
  return { id, type: "movie", title: id } as const;
}

function settings(over: Partial<AppSettings> = {}): AppSettings {
  return { ...defaultSettings(), ...over };
}

describe("AutoResolveScheduler — defaultEnabled branch under node", () => {
  let originalWindowDescriptor:
    | PropertyDescriptor
    | undefined
    | null = null;

  afterEach(() => {
    vi.restoreAllMocks();
    if (originalWindowDescriptor == null) {
      delete (globalThis as Record<string, unknown>).window;
    } else {
      Object.defineProperty(globalThis, "window", originalWindowDescriptor);
    }
    originalWindowDescriptor = null;
  });

  it("no-ops when `window` is undefined (the Node case)", async () => {
    const deps = {
      tmdb: null,
      indexers: { searchAll: vi.fn(async () => []) },
      debrid: { hasServices: true } as unknown as {
        hasServices: boolean;
      },
      store: {
        getCachedResolution: vi.fn(async () => null),
        putCachedResolution: vi.fn(async () => {}),
        listWatchlist: vi.fn(async () => [{ preview: preview("tt1") }]),
      },
      settings: settings(),
    };

    const scheduler = new AutoResolveScheduler(() => deps);
    expect(await scheduler.kick()).toBeNull();
    expect(deps.store.listWatchlist).not.toHaveBeenCalled();
  });

  it("falls back to disabled when checking Tauri availability throws", async () => {
    originalWindowDescriptor = Object.getOwnPropertyDescriptor(
      globalThis,
      "window",
    );
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      get() {
        throw new Error("tauri probe failed");
      },
    });

    const deps = {
      tmdb: null,
      indexers: { searchAll: vi.fn(async () => []) },
      debrid: { hasServices: true } as unknown as {
        hasServices: boolean;
      },
      store: {
        getCachedResolution: vi.fn(async () => null),
        putCachedResolution: vi.fn(async () => {}),
        listWatchlist: vi.fn(async () => [{ preview: preview("tt1") }]),
      },
      settings: settings(),
    };

    const scheduler = new AutoResolveScheduler(() => deps);
    expect(await scheduler.kick()).toBeNull();
    expect(deps.store.listWatchlist).not.toHaveBeenCalled();
  });
});
