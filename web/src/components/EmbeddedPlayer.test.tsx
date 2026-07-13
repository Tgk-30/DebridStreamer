// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const renderPlayerMock = vi.hoisted(() => ({
  callback: null as ((ev: { name: string; data: unknown }) => void) | null,
  observeProperties: vi.fn(),
}));

vi.mock("../lib/renderPlayer", () => ({
  init: vi.fn(async () => {}),
  destroy: vi.fn(async () => {}),
  command: vi.fn(async () => {}),
  setProperty: vi.fn(async () => {}),
  getProperty: vi.fn(async () => []),
  observeProperties: renderPlayerMock.observeProperties,
  setVideoMarginRatio: vi.fn(async () => {}),
}));

vi.mock("@tauri-apps/api/window", () => {
  const fakeWindow = {
    setFullscreen: vi.fn(async () => {}),
    isFullscreen: vi.fn(async () => false),
    onResized: vi.fn(async () => () => {}),
  };
  return { getCurrentWindow: () => fakeWindow };
});

vi.mock("../lib/tauri", () => ({
  openInExternalPlayer: vi.fn(async () => "opened"),
  isTauri: () => false,
}));

vi.mock("./Icon", () => ({
  Icon: ({ name }: { name: string }) => <span data-icon={name} />,
}));

import { EmbeddedPlayer } from "./EmbeddedPlayer";

const initialViewport = {
  width: window.innerWidth,
  height: window.innerHeight,
  scale: window.devicePixelRatio,
};

function setViewport(width: number, height: number, scale = 1): void {
  Object.defineProperties(window, {
    innerWidth: { configurable: true, value: width },
    innerHeight: { configurable: true, value: height },
    devicePixelRatio: { configurable: true, value: scale },
  });
}

function emitProperty(name: string, data: unknown): void {
  const callback = renderPlayerMock.callback;
  if (callback == null) throw new Error("mpv property listener is not ready");
  act(() => callback({ name, data }));
}

beforeEach(() => {
  renderPlayerMock.callback = null;
  renderPlayerMock.observeProperties.mockImplementation(
    async (
      _properties: unknown,
      callback: (ev: { name: string; data: unknown }) => void,
    ) => {
      renderPlayerMock.callback = callback;
      return () => {};
    },
  );
  setViewport(1024, 768);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  setViewport(initialViewport.width, initialViewport.height, initialViewport.scale);
});

describe("EmbeddedPlayer control geometry", () => {
  it("keeps transport controls in the true center column", () => {
    render(
      <EmbeddedPlayer
        url="https://example.test/movie.mkv"
        title="Test movie"
        onClose={() => {}}
        onPlayNext={() => {}}
      />,
    );

    const center = screen
      .getByRole("button", { name: "Pause" })
      .closest(".embed-buttons-center");
    expect(center).not.toBeNull();
    expect(center).toContainElement(
      screen.getByRole("button", { name: "Back 10 seconds" }),
    );
    expect(center).toContainElement(
      screen.getByRole("button", { name: "Forward 10 seconds" }),
    );

    expect(
      screen.getByRole("slider", { name: "Volume" }).closest(".embed-buttons-left"),
    ).not.toBeNull();
    expect(
      screen.getByRole("button", { name: "Fullscreen" }).closest(".embed-buttons-right"),
    ).not.toBeNull();
    expect(
      screen.getByRole("button", { name: "Next episode" }).closest(".embed-buttons-right"),
    ).not.toBeNull();
  });

  it("uses equal flexible side columns so the center column stays at 50%", () => {
    const css = readFileSync("src/components/EmbeddedPlayer.css", "utf8");
    expect(css).toContain(
      "grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);",
    );
  });
});

describe("window-anchored controls and playback diagnostics", () => {
  it("escapes an inset Detail block and stays window-anchored after dimensions arrive", async () => {
    // This is the shipped sequence: Detail starts 244 CSS px from the left at
    // desktop width and has scrolled to its movie stream picker. Its backdrop
    // filter makes it a containing block for fixed descendants. Source-dimension
    // events must never turn into inline control geometry.
    setViewport(1440, 900, 2);
    const detail = document.createElement("div");
    detail.className = "detail";
    detail.style.cssText =
      "position: fixed; inset: 0 0 0 244px; overflow-y: auto; backdrop-filter: blur(28px);";
    detail.scrollTop = 700;
    document.body.appendChild(detail);

    render(
      <EmbeddedPlayer
        url="https://example.test/movie.mkv"
        title="Test movie"
        onClose={() => {}}
      />,
      { container: detail },
    );

    await waitFor(() => expect(renderPlayerMock.callback).not.toBeNull());
    const player = screen
      .getByRole("button", { name: "Pause" })
      .closest<HTMLElement>(".embed-player");
    const controls = player?.querySelector<HTMLElement>(".embed-controls");

    // The full-window overlay must not inherit Detail's 244 px x-offset or its
    // 700 px scroll displacement.
    expect(player?.parentElement).toBe(document.body);
    expect(detail).not.toContainElement(player);
    expect(controls).not.toHaveAttribute("style");

    emitProperty("dwidth", 3840);
    expect(controls).not.toHaveAttribute("style");

    emitProperty("dheight", 2160);
    expect(controls).not.toHaveAttribute("style");

    const css = readFileSync("src/components/EmbeddedPlayer.css", "utf8");
    expect(css).toMatch(/\.embed-controls\s*\{[^}]*inset:\s*0;/s);
  });

  it("keeps the full-window contract before the first frame and for audio-only media", async () => {
    render(
      <EmbeddedPlayer
        url="https://example.test/audio.mka"
        title="Audio"
        onClose={() => {}}
      />,
    );

    await waitFor(() => expect(renderPlayerMock.callback).not.toBeNull());
    const controls = document.querySelector<HTMLElement>(".embed-controls");
    expect(controls).not.toHaveAttribute("style");

    emitProperty("dwidth", null);
    emitProperty("dheight", null);
    expect(controls).not.toHaveAttribute("style");
  });

  it("shows the native engine plus source and backing-display dimensions", async () => {
    setViewport(1000, 700, 2);
    render(
      <EmbeddedPlayer
        url="https://example.test/movie.mkv"
        title="Test movie"
        onClose={() => {}}
      />,
    );

    await waitFor(() => expect(renderPlayerMock.callback).not.toBeNull());
    emitProperty("video-params/w", 3840);
    emitProperty("video-params/h", 2160);

    fireEvent.click(screen.getByRole("button", { name: "Playback information" }));
    const dialog = screen.getByRole("dialog", { name: "Playback information" });
    expect(dialog).toHaveTextContent("Native mpv");
    expect(dialog).toHaveTextContent("3840 × 2160 px");
    expect(dialog).toHaveTextContent("2000 × 1400 px");
  });
});

describe("EmbeddedPlayer decode-failure fallback", () => {
  // The window mpv's watchdog uses (mirrors FIRST_FRAME_WATCHDOG_MS).
  const WATCHDOG_MS = 10_000;

  it("hands off to the webview when mpv reports an end-file decode error", async () => {
    // The gap this closes: loadfile SUCCEEDS (so the init try/catch sees nothing)
    // but the file then fails to decode, surfacing asynchronously as an end-file
    // ERROR event. The Rust core forwards only reason=ERROR, so any end-file with
    // error:true must trigger the parent's webview fallback.
    const onPlaybackError = vi.fn(async () => true);
    render(
      <EmbeddedPlayer
        url="https://example.test/corrupt.mkv"
        title="Corrupt"
        onPlaybackError={onPlaybackError}
        onClose={() => {}}
      />,
    );
    await waitFor(() => expect(renderPlayerMock.callback).not.toBeNull());

    emitProperty("end-file", { error: true, code: -12 });
    expect(onPlaybackError).toHaveBeenCalledTimes(1);
  });

  it("ignores an end-file that is not a genuine error (normal EOF)", async () => {
    const onPlaybackError = vi.fn(async () => true);
    render(
      <EmbeddedPlayer
        url="https://example.test/movie.mkv"
        title="Movie"
        onPlaybackError={onPlaybackError}
        onClose={() => {}}
      />,
    );
    await waitFor(() => expect(renderPlayerMock.callback).not.toBeNull());

    emitProperty("end-file", { error: false });
    expect(onPlaybackError).not.toHaveBeenCalled();
  });

  it("requests the webview fallback only once when errors repeat", async () => {
    const onPlaybackError = vi.fn(async () => true);
    render(
      <EmbeddedPlayer
        url="https://example.test/corrupt.mkv"
        title="Corrupt"
        onPlaybackError={onPlaybackError}
        onClose={() => {}}
      />,
    );
    await waitFor(() => expect(renderPlayerMock.callback).not.toBeNull());

    emitProperty("end-file", { error: true, code: -12 });
    emitProperty("end-file", { error: true, code: -12 });
    expect(onPlaybackError).toHaveBeenCalledTimes(1);
  });

  it("hands off to the webview when no first frame arrives within the watchdog window", async () => {
    vi.useFakeTimers();
    try {
      const onPlaybackError = vi.fn(async () => true);
      render(
        <EmbeddedPlayer
          url="https://example.test/stalled.mkv"
          title="Stalled"
          onPlaybackError={onPlaybackError}
          onClose={() => {}}
        />,
      );
      // The mocked init chain is microtask-only, so a single async tick arms the
      // watchdog. No time-pos is ever emitted (mpv accepted the file but never
      // decodes a frame).
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(renderPlayerMock.callback).not.toBeNull();
      expect(onPlaybackError).not.toHaveBeenCalled();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(WATCHDOG_MS);
      });
      expect(onPlaybackError).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("stands the watchdog down once the first frame is shown", async () => {
    vi.useFakeTimers();
    try {
      const onPlaybackError = vi.fn(async () => true);
      render(
        <EmbeddedPlayer
          url="https://example.test/movie.mkv"
          title="Movie"
          onPlaybackError={onPlaybackError}
          onClose={() => {}}
        />,
      );
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      // A first time-pos ≈ first frame, well before the window closes.
      emitProperty("time-pos", 0.5);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(WATCHDOG_MS);
      });
      expect(onPlaybackError).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
