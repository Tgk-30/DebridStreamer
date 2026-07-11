// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/renderPlayer", () => ({
  init: vi.fn(async () => {}),
  destroy: vi.fn(async () => {}),
  command: vi.fn(async () => {}),
  setProperty: vi.fn(async () => {}),
  getProperty: vi.fn(async () => []),
  observeProperties: vi.fn(async () => () => {}),
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

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
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
