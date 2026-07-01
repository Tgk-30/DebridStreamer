// @vitest-environment jsdom
//
// Control-UI + effect tests for the in-app VideoPlayer. Real playback (codec
// decode, HLS networking, native mpv hand-off) is mocked away; we exercise the
// branch selection (webview vs external), the CC popover toggle, the OSD row,
// the HLS source-attach / onHlsUnsupported path, and the mpv lifecycle effect.

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// ---- Mocks for heavy / environment-bound deps -----------------------------

// hls.js: default export with the static helpers the source touches. The shared
// state is created via vi.hoisted so the hoisted vi.mock factory can close over
// it without a temporal-dead-zone error.
const { hlsInstances, hlsIsSupported } = vi.hoisted(() => ({
  hlsInstances: [] as Array<{
    loadSource: ReturnType<typeof vi.fn>;
    attachMedia: ReturnType<typeof vi.fn>;
    destroy: ReturnType<typeof vi.fn>;
  }>,
  hlsIsSupported: vi.fn(() => true),
}));
vi.mock("hls.js", () => {
  class FakeHls {
    static isSupported = hlsIsSupported;
    loadSource = vi.fn();
    attachMedia = vi.fn();
    destroy = vi.fn();
    constructor() {
      hlsInstances.push(this);
    }
  }
  return { default: FakeHls };
});

// Tauri bridge — start in the browser (not under Tauri) by default; individual
// tests flip isTauri.
const isTauriMock = vi.fn(() => false);
const playWithMpvMock = vi.fn(async (_url: string) => ({
  embedded: false,
  status: "ok",
}));
const openInExternalPlayerMock = vi.fn(async (_url: string) => "VLC hand-off");
const mpvStopMock = vi.fn(async () => {});
vi.mock("../lib/tauri", () => ({
  isTauri: () => isTauriMock(),
  playWithMpv: (url: string) => playWithMpvMock(url),
  openInExternalPlayer: (url: string) => openInExternalPlayerMock(url),
  mpvStop: () => mpvStopMock(),
}));

// AppStore — VideoPlayer doesn't read it directly, but its captions menu does;
// stub it so nothing transitively touches a real store.
vi.mock("../store/AppStore", () => ({
  useAppStore: () => ({}),
}));

// Subtitle hook — return a controllable shape; default = no tracks.
const subsState: {
  tracks: Array<{
    id: string;
    label: string;
    language: string;
    vttUrl: string;
  }>;
  activeTrackId: string | null;
} = { tracks: [], activeTrackId: null };
vi.mock("./player/useSubtitleTracks", () => ({
  useSubtitleTracks: () => ({
    tracks: subsState.tracks,
    activeTrackId: subsState.activeTrackId,
    setActiveTrack: vi.fn(),
    results: [],
    searching: false,
    searchError: null,
    canSearch: false,
    search: vi.fn(),
    loadingFileId: null,
    loadResult: vi.fn(),
    setDelay: vi.fn(),
    canTranslate: false,
    translatingTrackId: null,
    translateProgress: null,
    translateTrack: vi.fn(),
  }),
}));

// Scrub thumbnails — no hidden capture video.
vi.mock("./player/useScrubThumbnails", () => ({
  useScrubThumbnails: () => ({
    preview: null,
    onHover: vi.fn(),
    onLeave: vi.fn(),
    available: false,
  }),
}));

// Child components we don't drive directly — render identifiable stubs.
vi.mock("./player/ScrubBar", () => ({
  ScrubBar: () => <div data-testid="scrub-bar" />,
}));
vi.mock("./player/CaptionsMenu", () => ({
  CaptionsMenu: (props: { onClose: () => void }) => (
    <div data-testid="captions-menu">
      <button type="button" onClick={props.onClose}>
        close-captions
      </button>
    </div>
  ),
}));
vi.mock("./Icon", () => ({
  Icon: ({ name }: { name: string }) => <span data-icon={name} />,
}));

import { VideoPlayer } from "./VideoPlayer";

// jsdom's <video> has no play/pause/load/canPlayType implementations.
beforeEach(() => {
  hlsInstances.length = 0;
  hlsIsSupported.mockReturnValue(true);
  isTauriMock.mockReturnValue(false);
  playWithMpvMock.mockResolvedValue({ embedded: false, status: "ok" });
  openInExternalPlayerMock.mockResolvedValue("VLC hand-off");
  subsState.tracks = [];
  subsState.activeTrackId = null;

  Object.defineProperty(HTMLMediaElement.prototype, "play", {
    configurable: true,
    value: vi.fn().mockResolvedValue(undefined),
  });
  Object.defineProperty(HTMLMediaElement.prototype, "pause", {
    configurable: true,
    value: vi.fn(),
  });
  Object.defineProperty(HTMLMediaElement.prototype, "load", {
    configurable: true,
    value: vi.fn(),
  });
  Object.defineProperty(HTMLMediaElement.prototype, "canPlayType", {
    configurable: true,
    writable: true,
    value: vi.fn(() => ""),
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

// ---- Top-level shell + branch selection -----------------------------------

describe("VideoPlayer shell", () => {
  it("renders the title and a close button", () => {
    render(
      <VideoPlayer url="https://x/test.mp4" title="My Movie" onClose={() => {}} />,
    );
    expect(screen.getByText("My Movie")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Close player" }),
    ).toBeInTheDocument();
  });

  it("invokes onClose from the close button", async () => {
    const onClose = vi.fn();
    render(<VideoPlayer url="https://x/test.mp4" title="T" onClose={onClose} />);
    await userEvent.click(screen.getByRole("button", { name: "Close player" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("invokes onClose when the backdrop is clicked", async () => {
    const onClose = vi.fn();
    const { container } = render(
      <VideoPlayer url="https://x/test.mp4" title="T" onClose={onClose} />,
    );
    const backdrop = container.querySelector(".player-backdrop") as HTMLElement;
    await userEvent.click(backdrop);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does NOT close when the inner panel is clicked (stopPropagation)", async () => {
    const onClose = vi.fn();
    const { container } = render(
      <VideoPlayer url="https://x/test.mp4" title="T" onClose={onClose} />,
    );
    const panel = container.querySelector(".player") as HTMLElement;
    await userEvent.click(panel);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("classifies an .mp4 URL as the in-webview path", () => {
    const { container } = render(
      <VideoPlayer url="https://x/movie.mp4" title="T" onClose={() => {}} />,
    );
    expect(container.querySelector("video.player-video")).not.toBeNull();
    expect(container.querySelector(".player-external")).toBeNull();
  });

  it("classifies an .mkv URL as the external path", () => {
    const { container } = render(
      <VideoPlayer url="https://x/movie.mkv" title="T" onClose={() => {}} />,
    );
    expect(container.querySelector("video.player-video")).toBeNull();
    expect(container.querySelector(".player-external")).not.toBeNull();
  });

  it("honours an explicit kind override over the URL extension", () => {
    const { container } = render(
      <VideoPlayer
        url="https://x/movie.mp4"
        kind="external"
        title="T"
        onClose={() => {}}
      />,
    );
    // mp4 would normally be webview, but kind forces external.
    expect(container.querySelector(".player-external")).not.toBeNull();
  });

  it("treats an extensionless URL as the webview path", () => {
    const { container } = render(
      <VideoPlayer url="https://debrid/direct/abc123" title="T" onClose={() => {}} />,
    );
    expect(container.querySelector("video.player-video")).not.toBeNull();
  });
});

// ---- Webview player: video element + OSD -----------------------------------

describe("WebviewPlayer", () => {
  it("renders a <video> with native controls and the OSD row", () => {
    const { container } = render(
      <VideoPlayer url="https://x/test.mp4" title="T" onClose={() => {}} />,
    );
    const video = container.querySelector("video.player-video") as HTMLVideoElement;
    expect(video).not.toBeNull();
    expect(video).toHaveAttribute("controls");
    expect(screen.getByTestId("scrub-bar")).toBeInTheDocument();
    // CC button lives in the OSD row.
    expect(screen.getByRole("button", { name: "Subtitles" })).toBeInTheDocument();
  });

  it("assigns the progressive src directly on the <video>", () => {
    const { container } = render(
      <VideoPlayer url="https://x/test.mp4" title="T" onClose={() => {}} />,
    );
    const video = container.querySelector("video.player-video") as HTMLVideoElement;
    expect(video.src).toBe("https://x/test.mp4");
    // No hls.js for a progressive source.
    expect(hlsInstances).toHaveLength(0);
  });

  // Cross-device resume seeking. The interesting case is HLS, where `duration`
  // is NaN at loadedmetadata and only becomes known on a later durationchange —
  // the seek must be retried then rather than silently dropped.
  function instrumentVideo(video: HTMLVideoElement, duration: number) {
    let dur = duration;
    let current = 0;
    Object.defineProperty(video, "duration", {
      configurable: true,
      get: () => dur,
      set: (v: number) => {
        dur = v;
      },
    });
    Object.defineProperty(video, "currentTime", {
      configurable: true,
      get: () => current,
      set: (v: number) => {
        current = v;
      },
    });
    return {
      setDuration: (v: number) => {
        dur = v;
      },
      currentTime: () => current,
    };
  }

  it("resumes to the saved position immediately when duration is known (progressive)", () => {
    const { container } = render(
      <VideoPlayer
        url="https://x/test.mp4"
        title="T"
        onClose={() => {}}
        startPositionSeconds={120}
      />,
    );
    const video = container.querySelector("video.player-video") as HTMLVideoElement;
    const probe = instrumentVideo(video, 3600);
    video.dispatchEvent(new Event("loadedmetadata"));
    expect(probe.currentTime()).toBe(120);
  });

  it("defers the resume seek until duration arrives, then applies it (HLS)", () => {
    const { container } = render(
      <VideoPlayer
        url="https://x/stream.m3u8"
        title="T"
        onClose={() => {}}
        startPositionSeconds={120}
      />,
    );
    const video = container.querySelector("video.player-video") as HTMLVideoElement;
    const probe = instrumentVideo(video, Number.NaN); // duration unknown at first
    // loadedmetadata with NaN duration must NOT seek (would clamp to 0 + stick).
    video.dispatchEvent(new Event("loadedmetadata"));
    expect(probe.currentTime()).toBe(0);
    // Duration becomes known → durationchange retries and the seek lands.
    probe.setDuration(3600);
    video.dispatchEvent(new Event("durationchange"));
    expect(probe.currentTime()).toBe(120);
  });

  it("does not resume a basically-finished item (start within 10s of the end)", () => {
    const { container } = render(
      <VideoPlayer
        url="https://x/test.mp4"
        title="T"
        onClose={() => {}}
        startPositionSeconds={3595}
      />,
    );
    const video = container.querySelector("video.player-video") as HTMLVideoElement;
    const probe = instrumentVideo(video, 3600);
    video.dispatchEvent(new Event("loadedmetadata"));
    expect(probe.currentTime()).toBe(0);
  });

  // Keyboard shortcuts (invisible power-user nicety).
  describe("keyboard shortcuts", () => {
    function setup(startPaused = true) {
      const { container } = render(
        <VideoPlayer url="https://x/test.mp4" title="T" onClose={() => {}} />,
      );
      const video = container.querySelector("video.player-video") as HTMLVideoElement;
      let current = 0;
      let paused = startPaused;
      Object.defineProperty(video, "duration", { configurable: true, get: () => 100 });
      Object.defineProperty(video, "currentTime", {
        configurable: true,
        get: () => current,
        set: (v: number) => {
          current = v;
        },
      });
      Object.defineProperty(video, "paused", {
        configurable: true,
        get: () => paused,
      });
      video.volume = 0.5;
      video.muted = false;
      return { video, currentTime: () => current };
    }
    const press = (key: string, target?: EventTarget) =>
      (target ?? window).dispatchEvent(
        new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }),
      );

    it("space plays when paused", () => {
      setup(true);
      press(" ");
      expect(HTMLMediaElement.prototype.play).toHaveBeenCalled();
    });

    it("space pauses when playing", () => {
      const { video } = setup(false);
      press(" ");
      expect(video.pause).toHaveBeenCalled();
    });

    it("ArrowRight seeks +5s and ArrowLeft seeks -5s (clamped at 0)", () => {
      const probe = setup();
      press("ArrowRight");
      expect(probe.currentTime()).toBe(5);
      press("ArrowLeft");
      press("ArrowLeft");
      expect(probe.currentTime()).toBe(0); // clamped, never negative
    });

    it("l/j seek ±10s", () => {
      const probe = setup();
      press("l");
      expect(probe.currentTime()).toBe(10);
      press("j");
      expect(probe.currentTime()).toBe(0);
    });

    it("m toggles mute and arrows adjust volume", () => {
      const { video } = setup();
      press("m");
      expect(video.muted).toBe(true);
      press("ArrowDown");
      expect(video.volume).toBeCloseTo(0.4);
      press("ArrowUp");
      expect(video.volume).toBeCloseTo(0.5);
    });

    it("a number key seeks to that decile of the duration", () => {
      const probe = setup();
      press("5");
      expect(probe.currentTime()).toBe(50); // 50% of 100s
    });

    it("ignores shortcuts while a text field is focused", () => {
      setup(true);
      const input = document.createElement("input");
      document.body.appendChild(input);
      press(" ", input);
      expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
      input.remove();
    });

    it("yields Space/Enter to a focused button (doesn't hijack play/pause)", () => {
      setup(true);
      const button = document.createElement("button");
      document.body.appendChild(button);
      press(" ", button);
      expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
      button.remove();
    });

    it("ignores shortcuts when a modifier is held (so ⌘K still works)", () => {
      setup(true);
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "k", metaKey: true, cancelable: true }),
      );
      expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
    });

    it("? toggles the shortcuts overlay, and its close button + the ? button work", async () => {
      const user = userEvent.setup();
      setup(true);
      expect(screen.queryByRole("dialog", { name: "Keyboard shortcuts" })).toBeNull();
      // "?" opens it (state update → wrap in act so React flushes).
      act(() => {
        press("?");
      });
      expect(
        screen.getByRole("dialog", { name: "Keyboard shortcuts" }),
      ).toBeInTheDocument();
      // Its close button dismisses it.
      await user.click(screen.getByRole("button", { name: "Close" }));
      expect(screen.queryByRole("dialog", { name: "Keyboard shortcuts" })).toBeNull();
      // The OSD "?" button also opens it.
      await user.click(screen.getByRole("button", { name: "Keyboard shortcuts" }));
      expect(
        screen.getByRole("dialog", { name: "Keyboard shortcuts" }),
      ).toBeInTheDocument();
    });
  });

  it("renders <track> elements for loaded subtitle tracks", () => {
    subsState.tracks = [
      { id: "t1", label: "EN", language: "en", vttUrl: "blob:vtt1" },
    ];
    subsState.activeTrackId = "t1";
    const { container } = render(
      <VideoPlayer url="https://x/test.mp4" title="T" onClose={() => {}} />,
    );
    const track = container.querySelector("track") as HTMLTrackElement;
    expect(track).not.toBeNull();
    expect(track).toHaveAttribute("label", "EN");
    expect(track).toHaveAttribute("srclang", "en");
  });

  it("marks the CC chip active and shows the dot when a track is active", () => {
    subsState.tracks = [
      { id: "t1", label: "EN", language: "en", vttUrl: "blob:vtt1" },
    ];
    subsState.activeTrackId = "t1";
    const { container } = render(
      <VideoPlayer url="https://x/test.mp4" title="T" onClose={() => {}} />,
    );
    const cc = screen.getByRole("button", { name: "Subtitles" });
    expect(cc.className).toContain("is-active");
    expect(container.querySelector(".captions-active-dot")).not.toBeNull();
  });
});

// ---- Captions popover toggle ----------------------------------------------

describe("captions toggle", () => {
  it("opens CaptionsMenu on CC click and reflects aria-expanded", async () => {
    render(<VideoPlayer url="https://x/test.mp4" title="T" onClose={() => {}} />);
    const cc = screen.getByRole("button", { name: "Subtitles" });
    expect(cc).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByTestId("captions-menu")).toBeNull();

    await userEvent.click(cc);
    expect(cc).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByTestId("captions-menu")).toBeInTheDocument();
  });

  it("closes CaptionsMenu on a second CC click", async () => {
    render(<VideoPlayer url="https://x/test.mp4" title="T" onClose={() => {}} />);
    const cc = screen.getByRole("button", { name: "Subtitles" });
    await userEvent.click(cc);
    expect(screen.getByTestId("captions-menu")).toBeInTheDocument();
    await userEvent.click(cc);
    expect(cc).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByTestId("captions-menu")).toBeNull();
  });

  it("closes CaptionsMenu via its onClose callback", async () => {
    render(<VideoPlayer url="https://x/test.mp4" title="T" onClose={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: "Subtitles" }));
    const menu = screen.getByTestId("captions-menu");
    await userEvent.click(within(menu).getByText("close-captions"));
    expect(screen.queryByTestId("captions-menu")).toBeNull();
  });
});

// ---- HLS source branch -----------------------------------------------------

describe("HLS source attach", () => {
  it("attaches hls.js when the browser can't play HLS natively", () => {
    (HTMLMediaElement.prototype.canPlayType as ReturnType<typeof vi.fn>) = vi.fn(
      () => "",
    );
    render(<VideoPlayer url="https://x/stream.m3u8" title="T" onClose={() => {}} />);
    expect(hlsInstances).toHaveLength(1);
    expect(hlsInstances[0].loadSource).toHaveBeenCalledWith(
      "https://x/stream.m3u8",
    );
    expect(hlsInstances[0].attachMedia).toHaveBeenCalled();
  });

  it("uses native HLS (no hls.js) when canPlayType reports support", () => {
    (HTMLMediaElement.prototype.canPlayType as ReturnType<typeof vi.fn>) = vi.fn(
      () => "maybe",
    );
    const { container } = render(
      <VideoPlayer url="https://x/stream.m3u8" title="T" onClose={() => {}} />,
    );
    expect(hlsInstances).toHaveLength(0);
    const video = container.querySelector("video.player-video") as HTMLVideoElement;
    expect(video.src).toBe("https://x/stream.m3u8");
  });

  it("destroys the hls.js instance on unmount", () => {
    (HTMLMediaElement.prototype.canPlayType as ReturnType<typeof vi.fn>) = vi.fn(
      () => "",
    );
    const { unmount } = render(
      <VideoPlayer url="https://x/stream.m3u8" title="T" onClose={() => {}} />,
    );
    expect(hlsInstances).toHaveLength(1);
    unmount();
    expect(hlsInstances[0].destroy).toHaveBeenCalled();
  });

  it("routes to the external panel when HLS is unsupported", () => {
    (HTMLMediaElement.prototype.canPlayType as ReturnType<typeof vi.fn>) = vi.fn(
      () => "",
    );
    hlsIsSupported.mockReturnValue(false);
    const { container } = render(
      <VideoPlayer url="https://x/stream.m3u8" title="T" onClose={() => {}} />,
    );
    // onHlsUnsupported sets externalError → the parent flips to ExternalPanel.
    expect(hlsInstances).toHaveLength(0);
    expect(container.querySelector(".player-external")).not.toBeNull();
    expect(
      screen.getByText("This browser can't play HLS. Try the desktop app."),
    ).toBeInTheDocument();
  });
});

// ---- External panel: browser vs Tauri --------------------------------------

describe("ExternalPanel (browser)", () => {
  it("shows the open-externally note and a direct link in the browser", () => {
    render(<VideoPlayer url="https://x/movie.mkv" title="T" onClose={() => {}} />);
    expect(screen.getByText("Open externally")).toBeInTheDocument();
    const link = screen.getByRole("link", { name: "Open direct link" });
    expect(link).toHaveAttribute("href", "https://x/movie.mkv");
    expect(link).toHaveAttribute("target", "_blank");
  });

  it("does not invoke any native player when not under Tauri", () => {
    render(<VideoPlayer url="https://x/movie.mkv" title="T" onClose={() => {}} />);
    expect(playWithMpvMock).not.toHaveBeenCalled();
    expect(openInExternalPlayerMock).not.toHaveBeenCalled();
  });
});

describe("ExternalPanel (Tauri)", () => {
  it("plays via the bundled mpv and shows its status", async () => {
    isTauriMock.mockReturnValue(true);
    playWithMpvMock.mockResolvedValue({ embedded: false, status: "ok" });
    render(<VideoPlayer url="https://x/movie.mkv" title="T" onClose={() => {}} />);
    expect(screen.getByText("Opening in the bundled player")).toBeInTheDocument();
    await waitFor(() =>
      expect(playWithMpvMock).toHaveBeenCalledWith("https://x/movie.mkv"),
    );
    await waitFor(() =>
      expect(
        screen.getByText("Playing in the bundled mpv player."),
      ).toBeInTheDocument(),
    );
  });

  it("reports the in-window embedding status when mpv embeds", async () => {
    isTauriMock.mockReturnValue(true);
    playWithMpvMock.mockResolvedValue({ embedded: true, status: "ok" });
    render(<VideoPlayer url="https://x/movie.mkv" title="T" onClose={() => {}} />);
    await waitFor(() =>
      expect(
        screen.getByText(
          "Playing in the bundled mpv (in-window embedding attempted).",
        ),
      ).toBeInTheDocument(),
    );
  });

  it("falls back to the VLC/IINA hand-off when mpv fails", async () => {
    isTauriMock.mockReturnValue(true);
    playWithMpvMock.mockRejectedValue(new Error("no mpv"));
    openInExternalPlayerMock.mockResolvedValue("Opened in VLC");
    render(<VideoPlayer url="https://x/movie.mkv" title="T" onClose={() => {}} />);
    await waitFor(() =>
      expect(openInExternalPlayerMock).toHaveBeenCalledWith(
        "https://x/movie.mkv",
      ),
    );
    await waitFor(() =>
      expect(screen.getByText("Opened in VLC")).toBeInTheDocument(),
    );
  });

  it("surfaces an error when both mpv and the VLC fallback fail", async () => {
    isTauriMock.mockReturnValue(true);
    playWithMpvMock.mockRejectedValue(new Error("no mpv"));
    openInExternalPlayerMock.mockRejectedValue(new Error("VLC missing"));
    const { container } = render(
      <VideoPlayer url="https://x/movie.mkv" title="T" onClose={() => {}} />,
    );
    await waitFor(() =>
      expect(container.querySelector(".player-external-err")).toHaveTextContent(
        "VLC missing",
      ),
    );
  });

  it("stops the bundled mpv on unmount once it has started", async () => {
    isTauriMock.mockReturnValue(true);
    playWithMpvMock.mockResolvedValue({ embedded: false, status: "ok" });
    const { unmount } = render(
      <VideoPlayer url="https://x/movie.mkv" title="T" onClose={() => {}} />,
    );
    await waitFor(() => expect(playWithMpvMock).toHaveBeenCalled());
    unmount();
    await waitFor(() => expect(mpvStopMock).toHaveBeenCalled());
  });
});
