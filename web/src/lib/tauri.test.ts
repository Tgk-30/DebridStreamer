// Unit tests for the Tauri IPC bridge (src/lib/tauri.ts).
//
// The module runs in two worlds: a plain browser (no Tauri runtime, isTauri()
// false) and the desktop Tauri webview (isTauri() true, dynamic imports resolve
// to the real plugin runtime). The vitest env here is "node" (no window), so
// isTauri() is false by default; we flip it by stubbing `window` with the
// __TAURI_INTERNALS__ flag, and we mock the dynamically-imported Tauri modules.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock the dynamically-imported Tauri runtime modules. Each exported fn from
// tauri.ts that hits a native command does `await import("@tauri-apps/api/core")`
// and calls invoke(); we capture those calls here.
const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

const listenMock = vi.fn();
vi.mock("@tauri-apps/api/event", () => ({
  listen: (...args: unknown[]) => listenMock(...args),
}));

const openUrlMock = vi.fn();
vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: (...args: unknown[]) => openUrlMock(...args),
}));

import {
  isTauri,
  openInExternalPlayer,
  playWithMpv,
  mpvPause,
  mpvResume,
  mpvSeek,
  mpvGetPosition,
  mpvStop,
  desktopServerStatus,
  startDesktopServer,
  stopDesktopServer,
  openExternalURL,
  downloadStart,
  downloadCancel,
  downloadForceStop,
  listenDownloadProgress,
  castDiscover,
  castLoad,
  castControl,
  castStatus,
  castSetVolume,
  type CastDevice,
  type DesktopServerStatus,
  type MpvPlayResult,
} from "./tauri";

/** Put a fake Tauri window in place so isTauri() returns true. */
function enterTauri(): void {
  vi.stubGlobal("window", { __TAURI_INTERNALS__: {} });
}

beforeEach(() => {
  invokeMock.mockReset();
  listenMock.mockReset();
  openUrlMock.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("isTauri", () => {
  it("is false in a node env with no window", () => {
    expect(isTauri()).toBe(false);
  });

  it("is false for a bare window without any Tauri flag", () => {
    vi.stubGlobal("window", {});
    expect(isTauri()).toBe(false);
  });

  it("is true when __TAURI_INTERNALS__ is injected (Tauri v2)", () => {
    vi.stubGlobal("window", { __TAURI_INTERNALS__: {} });
    expect(isTauri()).toBe(true);
  });

  it("is true when the legacy __TAURI__ flag is present", () => {
    vi.stubGlobal("window", { __TAURI__: {} });
    expect(isTauri()).toBe(true);
  });
});

describe("openInExternalPlayer", () => {
  it("throws when not running under Tauri (no invoke)", async () => {
    await expect(openInExternalPlayer("http://x/file.mkv")).rejects.toThrow(
      /Not running under Tauri/,
    );
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("invokes open_in_external_player with the url and returns status", async () => {
    enterTauri();
    invokeMock.mockResolvedValue("opened");
    const status = await openInExternalPlayer("http://x/file.mkv");
    expect(status).toBe("opened");
    expect(invokeMock).toHaveBeenCalledWith("open_in_external_player", {
      url: "http://x/file.mkv",
      preferred: null,
    });
  });

  it("forwards a preferred player when given", async () => {
    enterTauri();
    invokeMock.mockResolvedValue("Opened in IINA");
    await openInExternalPlayer("http://x/file.mkv", "IINA");
    expect(invokeMock).toHaveBeenCalledWith("open_in_external_player", {
      url: "http://x/file.mkv",
      preferred: "IINA",
    });
  });
});

describe("playWithMpv", () => {
  it("throws when not running under Tauri", async () => {
    await expect(playWithMpv("http://x/file.mkv")).rejects.toThrow(
      /Not running under Tauri/,
    );
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("invokes mpv_play and returns the MpvPlayResult", async () => {
    enterTauri();
    const result: MpvPlayResult = { embedded: true, status: "playing" };
    invokeMock.mockResolvedValue(result);
    await expect(playWithMpv("http://x/file.mkv")).resolves.toEqual(result);
    expect(invokeMock).toHaveBeenCalledWith("mpv_play", {
      url: "http://x/file.mkv",
    });
  });
});

describe("mpv control commands (no isTauri gate)", () => {
  it("mpvPause invokes mpv_pause", async () => {
    invokeMock.mockResolvedValue(undefined);
    await mpvPause();
    expect(invokeMock).toHaveBeenCalledWith("mpv_pause");
  });

  it("mpvResume invokes mpv_resume", async () => {
    invokeMock.mockResolvedValue(undefined);
    await mpvResume();
    expect(invokeMock).toHaveBeenCalledWith("mpv_resume");
  });

  it("mpvSeek invokes mpv_seek with the seconds payload", async () => {
    invokeMock.mockResolvedValue(undefined);
    await mpvSeek(42);
    expect(invokeMock).toHaveBeenCalledWith("mpv_seek", { seconds: 42 });
  });

  it("mpvGetPosition invokes mpv_get_position and returns the position", async () => {
    invokeMock.mockResolvedValue(12.5);
    await expect(mpvGetPosition()).resolves.toBe(12.5);
    expect(invokeMock).toHaveBeenCalledWith("mpv_get_position");
  });

  it("mpvStop invokes mpv_stop", async () => {
    invokeMock.mockResolvedValue(undefined);
    await mpvStop();
    expect(invokeMock).toHaveBeenCalledWith("mpv_stop");
  });
});

describe("DLNA cast IPC bridge", () => {
  const device: CastDevice = {
    id: "uuid:tv-1",
    name: "Living Room TV",
    avControlUrl: "http://10.0.0.10/av",
    renderingControlUrl: "http://10.0.0.10/volume",
    location: "http://10.0.0.10/device.xml",
  };

  it("guards every cast command outside Tauri", async () => {
    await expect(castDiscover()).rejects.toThrow(/Not running under Tauri/);
    await expect(
      castLoad(device, "https://cdn.example/movie.mkv", "Movie"),
    ).rejects.toThrow(/Not running under Tauri/);
    await expect(castControl(device, "pause")).rejects.toThrow(
      /Not running under Tauri/,
    );
    await expect(castStatus(device)).rejects.toThrow(/Not running under Tauri/);
    await expect(castSetVolume(device, 50)).rejects.toThrow(
      /Not running under Tauri/,
    );
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("uses the typed native command payloads", async () => {
    enterTauri();
    invokeMock
      .mockResolvedValueOnce([device])
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({
        state: "PLAYING",
        positionSecs: 12,
        durationSecs: 120,
      })
      .mockResolvedValueOnce(undefined);

    await expect(castDiscover(1800)).resolves.toEqual([device]);
    await castLoad(
      device,
      "https://cdn.example/movie.mkv",
      "Movie & More",
      "https://cdn.example/movie.srt",
    );
    await castControl(device, "seek", 42);
    await expect(castStatus(device)).resolves.toEqual({
      state: "PLAYING",
      positionSecs: 12,
      durationSecs: 120,
    });
    await castSetVolume(device, 101);

    expect(invokeMock).toHaveBeenNthCalledWith(1, "cast_discover", {
      timeoutMs: 1800,
    });
    expect(invokeMock).toHaveBeenNthCalledWith(2, "cast_load", {
      args: {
        device,
        url: "https://cdn.example/movie.mkv",
        title: "Movie & More",
        subtitleUrl: "https://cdn.example/movie.srt",
      },
    });
    expect(invokeMock).toHaveBeenNthCalledWith(3, "cast_control", {
      args: { device, action: "seek", positionSecs: 42 },
    });
    expect(invokeMock).toHaveBeenNthCalledWith(4, "cast_status", { device });
    expect(invokeMock).toHaveBeenNthCalledWith(5, "cast_set_volume", {
      args: { device, level: 100 },
    });
  });
});

describe("download IPC bridge", () => {
  it("invokes start, cancel, and force-stop with the contract payloads", async () => {
    invokeMock.mockResolvedValue(undefined);
    await downloadStart({
      jobId: "job-1",
      url: "https://cdn.example/file",
      destPath: "/Downloads/file.mkv",
    });
    await downloadCancel("job-1");
    await downloadForceStop("job-1");

    expect(invokeMock).toHaveBeenNthCalledWith(1, "download_start", {
      args: {
        jobId: "job-1",
        url: "https://cdn.example/file",
        destPath: "/Downloads/file.mkv",
      },
    });
    expect(invokeMock).toHaveBeenNthCalledWith(2, "download_cancel", { jobId: "job-1" });
    expect(invokeMock).toHaveBeenNthCalledWith(3, "download_force_stop", { jobId: "job-1" });
  });

  it("forwards download-progress payloads and returns the native unlisten function", async () => {
    const unlisten = vi.fn();
    let nativeListener!: (event: { payload: unknown }) => void;
    listenMock.mockImplementation(async (_eventName: string, listener: typeof nativeListener) => {
      nativeListener = listener;
      return unlisten;
    });
    const listener = vi.fn();
    await expect(listenDownloadProgress(listener)).resolves.toBe(unlisten);
    expect(listenMock).toHaveBeenCalledWith("download-progress", expect.any(Function));

    const payload = {
      jobId: "job-1",
      phase: "downloading" as const,
      bytesDone: 1_048_576,
      bytesTotal: 2_097_152,
      speedBps: 1_048_576,
    };
    nativeListener({ payload });
    expect(listener).toHaveBeenCalledWith(payload);
  });
});

describe("desktop server supervisor commands", () => {
  const status: DesktopServerStatus = {
    available: true,
    running: true,
    url: "http://127.0.0.1:8787",
    urls: ["http://127.0.0.1:8787"],
    lan_urls: [],
    share_url: null,
    setup_url: null,
    setup_token: null,
    port: 8787,
    detail: "running",
    server_entry: null,
    web_dist: null,
  };

  it("desktopServerStatus throws when not under Tauri", async () => {
    await expect(desktopServerStatus()).rejects.toThrow(/Not running under Tauri/);
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("desktopServerStatus invokes desktop_server_status and returns it", async () => {
    enterTauri();
    invokeMock.mockResolvedValue(status);
    await expect(desktopServerStatus()).resolves.toEqual(status);
    expect(invokeMock).toHaveBeenCalledWith("desktop_server_status");
  });

  it("startDesktopServer throws when not under Tauri", async () => {
    await expect(startDesktopServer()).rejects.toThrow(/Not running under Tauri/);
  });

  it("startDesktopServer invokes desktop_server_start", async () => {
    enterTauri();
    invokeMock.mockResolvedValue(status);
    await expect(startDesktopServer()).resolves.toEqual(status);
    expect(invokeMock).toHaveBeenCalledWith("desktop_server_start");
  });

  it("stopDesktopServer throws when not under Tauri", async () => {
    await expect(stopDesktopServer()).rejects.toThrow(/Not running under Tauri/);
  });

  it("stopDesktopServer invokes desktop_server_stop", async () => {
    enterTauri();
    invokeMock.mockResolvedValue(status);
    await expect(stopDesktopServer()).resolves.toEqual(status);
    expect(invokeMock).toHaveBeenCalledWith("desktop_server_stop");
  });
});

describe("openExternalURL", () => {
  it("uses the Tauri opener plugin when under Tauri", async () => {
    enterTauri();
    openUrlMock.mockResolvedValue(undefined);
    await openExternalURL("https://example.com");
    expect(openUrlMock).toHaveBeenCalledWith("https://example.com");
  });

  it("falls back to window.open in a plain browser", async () => {
    const windowOpen = vi.fn();
    vi.stubGlobal("window", { open: windowOpen });
    await openExternalURL("https://example.com");
    expect(windowOpen).toHaveBeenCalledWith(
      "https://example.com",
      "_blank",
      "noopener,noreferrer",
    );
    expect(openUrlMock).not.toHaveBeenCalled();
  });
});
