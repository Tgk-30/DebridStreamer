import { describe, expect, it, vi } from "vitest";
import {
  CastController,
  type CastBridge,
  type CastPollEnvironment,
} from "./cast";
import type { CastDevice, CastStatus } from "./tauri";

const device: CastDevice = {
  id: "uuid:tv-1",
  name: "Living Room TV",
  avControlUrl: "http://10.0.0.10/av",
  renderingControlUrl: "http://10.0.0.10/volume",
  location: "http://10.0.0.10/device.xml",
};

function setup() {
  let hidden = false;
  let parked = false;
  let environmentListener = () => {};
  let intervalCallback = () => {};
  const setIntervalMock = vi.fn((callback: () => void) => {
    intervalCallback = callback;
    return 7 as unknown as ReturnType<typeof setInterval>;
  });
  const clearIntervalMock = vi.fn();
  const environment: CastPollEnvironment = {
    hidden: () => hidden,
    parked: () => parked,
    subscribe: (listener) => {
      environmentListener = listener;
      return vi.fn();
    },
    setInterval: setIntervalMock,
    clearInterval: clearIntervalMock,
  };
  const statusValues: CastStatus[] = [
    { state: "PLAYING", positionSecs: 8, durationSecs: 120 },
    { state: "PLAYING", positionSecs: 10, durationSecs: 120 },
  ];
  const bridge: CastBridge = {
    discover: vi.fn(async () => [device]),
    load: vi.fn(async () => {}),
    control: vi.fn(async () => {}),
    status: vi.fn(async () => statusValues.shift() ?? {
      state: "PLAYING",
      positionSecs: 10,
      durationSecs: 120,
    }),
    setVolume: vi.fn(async () => {}),
  };
  const controller = new CastController(bridge, environment, 50);
  return {
    bridge,
    controller,
    setIntervalMock,
    clearIntervalMock,
    runInterval: () => intervalCallback(),
    setHidden: (value: boolean) => {
      hidden = value;
      environmentListener();
    },
    setParked: (value: boolean) => {
      parked = value;
      environmentListener();
    },
  };
}

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe("CastController", () => {
  it("runs discover, pick, load, status poll, controls, and stop", async () => {
    const context = setup();
    const { bridge, controller } = context;

    await controller.discover();
    expect(controller.getSnapshot()).toMatchObject({
      phase: "selecting",
      devices: [device],
    });

    await controller.load(device, {
      url: "https://cdn.example/movie.mkv",
      title: "Movie",
      subtitleUrl: "https://cdn.example/movie.srt",
    });
    await flush();
    expect(bridge.load).toHaveBeenCalledWith(device, {
      url: "https://cdn.example/movie.mkv",
      title: "Movie",
      subtitleUrl: "https://cdn.example/movie.srt",
    });
    expect(controller.getSnapshot()).toMatchObject({
      phase: "casting",
      device,
      status: { positionSecs: 8 },
    });
    expect(context.setIntervalMock).toHaveBeenCalledWith(
      expect.any(Function),
      50,
    );

    context.runInterval();
    await flush();
    expect(controller.getSnapshot().status?.positionSecs).toBe(10);

    await controller.control("pause");
    await controller.control("seek", 42);
    await controller.setVolume(73);
    expect(bridge.control).toHaveBeenCalledWith(device, "pause", undefined);
    expect(bridge.control).toHaveBeenCalledWith(device, "seek", 42);
    expect(bridge.setVolume).toHaveBeenCalledWith(device, 73);

    await controller.stop();
    expect(bridge.control).toHaveBeenCalledWith(device, "stop");
    expect(controller.getSnapshot().phase).toBe("idle");
    expect(context.clearIntervalMock).toHaveBeenCalled();
    controller.dispose();
  });

  it("clears polling while hidden or attention-parked and restarts when active", async () => {
    const context = setup();
    await context.controller.discover();
    await context.controller.load(device, {
      url: "https://cdn.example/movie.mkv",
      title: "Movie",
    });
    await flush();
    const callsWhileVisible = vi.mocked(context.bridge.status).mock.calls.length;

    context.setHidden(true);
    expect(context.clearIntervalMock).toHaveBeenCalledTimes(1);
    context.runInterval();
    await flush();
    expect(context.bridge.status).toHaveBeenCalledTimes(callsWhileVisible);

    context.setHidden(false);
    await flush();
    expect(context.bridge.status).toHaveBeenCalledTimes(callsWhileVisible + 1);
    context.setParked(true);
    expect(context.clearIntervalMock).toHaveBeenCalledTimes(2);
    context.controller.dispose();
  });
});
