import { beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));

import { destroy, init, setVideoMarginRatio } from "./renderPlayer";

beforeEach(() => {
  invokeMock.mockReset();
  invokeMock.mockResolvedValue(undefined);
});

describe("setVideoMarginRatio", () => {
  it("coalesces duplicate native geometry updates and resets between sessions", async () => {
    await init({});
    invokeMock.mockClear();

    await setVideoMarginRatio({ bottom: 0.25 });
    await setVideoMarginRatio({ bottom: 0.25 });
    await setVideoMarginRatio({ bottom: 0.5 });
    expect(invokeMock).toHaveBeenCalledTimes(2);
    expect(invokeMock).toHaveBeenNthCalledWith(1, "player_set_video_margin", { bottom: 0.25 });
    expect(invokeMock).toHaveBeenNthCalledWith(2, "player_set_video_margin", { bottom: 0.5 });

    await destroy();
    invokeMock.mockClear();
    await setVideoMarginRatio({ bottom: 0.5 });
    expect(invokeMock).toHaveBeenCalledWith("player_set_video_margin", { bottom: 0.5 });
  });

  it("allows a retry when the native bridge rejects a geometry update", async () => {
    await init({});
    invokeMock.mockClear();
    invokeMock.mockRejectedValueOnce(new Error("surface unavailable"));
    await expect(setVideoMarginRatio({ bottom: 0.25 })).rejects.toThrow("surface unavailable");
    invokeMock.mockResolvedValue(undefined);

    await setVideoMarginRatio({ bottom: 0.25 });
    expect(invokeMock).toHaveBeenCalledTimes(2);
  });
});

describe("player lifecycle queue", () => {
  it("preserves init, destroy, init ordering across deferred native commands", async () => {
    let resolveFirstInit: (() => void) | undefined;
    let resolveDestroy: (() => void) | undefined;
    invokeMock
      .mockImplementationOnce(
        () => new Promise<void>((resolve) => {
          resolveFirstInit = resolve;
        }),
      )
      .mockImplementationOnce(
        () => new Promise<void>((resolve) => {
          resolveDestroy = resolve;
        }),
      )
      .mockResolvedValueOnce(undefined);

    const firstInit = init({});
    const firstDestroy = destroy();
    const secondInit = init({});
    await Promise.resolve();
    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(invokeMock).toHaveBeenLastCalledWith("player_init", {
      options: {},
      observed: [],
    });

    resolveFirstInit?.();
    await firstInit;
    await Promise.resolve();
    expect(invokeMock).toHaveBeenCalledTimes(2);
    expect(invokeMock).toHaveBeenLastCalledWith("player_destroy");

    resolveDestroy?.();
    await firstDestroy;
    await secondInit;
    expect(invokeMock).toHaveBeenCalledTimes(3);
    expect(invokeMock).toHaveBeenLastCalledWith("player_init", {
      options: {},
      observed: [],
    });
  });

  it("continues with later lifecycle operations after an earlier failure", async () => {
    invokeMock.mockRejectedValueOnce(new Error("init failed"));
    await expect(init({})).rejects.toThrow("init failed");
    await destroy();
    expect(invokeMock).toHaveBeenLastCalledWith("player_destroy");
  });
});
