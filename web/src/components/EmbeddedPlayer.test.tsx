// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
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
}));

vi.mock("./Icon", () => ({
  Icon: ({ name }: { name: string }) => <span data-icon={name} />,
}));

import { EmbeddedPlayer } from "./EmbeddedPlayer";
import { fitVideoRect } from "../lib/videoRect";

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

describe("control overlay aligns to the rendered video frame", () => {
  it("escapes the inset, scrolled Detail containing block before applying the Retina rect", async () => {
    // This is the shipped sequence: Detail starts 244 CSS px from the left at
    // desktop width and has scrolled to its movie stream picker. Its backdrop
    // filter makes it a containing block for fixed descendants. A 2x 16:9 frame
    // then reports 3840 and 2160 in separate mpv property events.
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
    // Partial dimensions must retain the safe full-viewport fallback.
    expect(controls).not.toHaveAttribute("style");

    emitProperty("dheight", 2160);
    // Retina-sized video dimensions contribute only their aspect. The fitted
    // overlay remains in CSS pixels: 1440 x 810, centered 45 px from the top.
    expect(controls).toHaveStyle({
      left: "0px",
      top: "45px",
      width: "1440px",
      height: "810px",
    });
  });

  it("uses the full viewport before the first frame and for audio-only media", async () => {
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

  it("does not fit a rect until both dimension events are valid", async () => {
    render(
      <EmbeddedPlayer
        url="https://example.test/movie.mkv"
        title="Test movie"
        onClose={() => {}}
      />,
    );

    await waitFor(() => expect(renderPlayerMock.callback).not.toBeNull());
    const controls = document.querySelector<HTMLElement>(".embed-controls");

    emitProperty("dwidth", 1920);
    emitProperty("dheight", 0);
    expect(controls).not.toHaveAttribute("style");

    emitProperty("dheight", Number.NaN);
    expect(controls).not.toHaveAttribute("style");

    emitProperty("dheight", 1080);
    expect(controls).toHaveStyle({
      left: "0px",
      top: "96px",
      width: "1024px",
      height: "576px",
    });
  });

  it("pins to the letterboxed frame for a wide video in a tall window", () => {
    // 16:9 video inside a square window: full width, bars top and bottom.
    const rect = fitVideoRect({ width: 1920, height: 1080 }, { width: 1000, height: 1000 });
    expect(rect).toEqual({ left: 0, top: 218.75, width: 1000, height: 562.5 });
  });

  it("pins to the pillarboxed frame for a tall video in a wide window", () => {
    // 9:16 video inside a 16:9 window: full height, bars left and right.
    const rect = fitVideoRect({ width: 1080, height: 1920 }, { width: 1600, height: 900 });
    expect(rect).toEqual({ left: 546.875, top: 0, width: 506.25, height: 900 });
  });

  it("falls back to the full window when dimensions are unknown", () => {
    // Before the first frame or for audio-only: no rect, controls span the window.
    expect(fitVideoRect({ width: 0, height: 0 }, { width: 1280, height: 720 })).toBeNull();
  });
});
