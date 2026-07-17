// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

const closeLocalFilePlayer = vi.hoisted(() => vi.fn());
const store = vi.hoisted(() => ({
  localFilePlayer: {
    path: "/Users/alice/Movies/Rick and Morty S09E08.mkv",
    title: "Rick and Morty S09E08 - The Last Temptation of Jerry",
  } as { path: string; title: string } | null,
  closeLocalFilePlayer,
  settings: {
    preferredExternalPlayer: "",
    builtInPlayer: true,
  },
}));

vi.mock("../store/AppStore", () => ({
  useAppStore: () => store,
}));
vi.mock("./Spinner", () => ({
  Spinner: () => <div>Loading player</div>,
}));
vi.mock("./VideoPlayer", () => ({
  VideoPlayer: (props: {
    url: string;
    title: string;
    sourceFileName: string;
    engine: string;
    startPositionSeconds: number;
    onClose: () => void;
  }) => (
    <button
      type="button"
      data-testid="local-native-player"
      data-url={props.url}
      data-title={props.title}
      data-source-file={props.sourceFileName}
      data-engine={props.engine}
      data-start={props.startPositionSeconds}
      onClick={props.onClose}
    />
  ),
}));

import { LocalPlayerHost } from "./LocalPlayerHost";

describe("LocalPlayerHost", () => {
  it("passes the raw local path to the native-mpv player and starts fresh", async () => {
    render(<LocalPlayerHost />);

    const player = await screen.findByTestId("local-native-player");
    expect(player).toHaveAttribute("data-url", store.localFilePlayer!.path);
    expect(player).toHaveAttribute("data-engine", "native-mpv");
    expect(player).toHaveAttribute("data-start", "0");
    expect(player).toHaveAttribute("data-source-file", "Rick and Morty S09E08.mkv");

    fireEvent.click(player);
    expect(closeLocalFilePlayer).toHaveBeenCalledOnce();
  });
});
