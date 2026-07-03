// @vitest-environment jsdom
//
// Render/interaction tests for the Detail screen. The screen wires many child
// surfaces and services together, so everything external is mocked: the data
// hooks (useDetail/useStreams), the app store slice it reads, serverMode +
// ServerSessionContext, the storage taste-event store, the TasteProfile rebuild,
// and serverApi. Child components are replaced with doubles that expose their
// props as DOM so the parent wiring (play / watchlist / back / taste / related)
// can be asserted without their internals.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { MediaPreview, MediaItem } from "../models/media";
import type { DetailState } from "../data/detail";
import type { StreamsState } from "../data/streams";

// --- mutable mock state -----------------------------------------------------

let mockDetailItem: MediaPreview | null = null;
let mockDetail: DetailState;
let mockStreams: StreamsState;
let mockWatchlist: MediaPreview[] = [];
let inWatchlistResult = false;
let mockCached: { stream: any } | null = null;
let mockContinueWatching: any[] = [];
let serverModeOn = false;

const closeDetail = vi.fn();
const openDetail = vi.fn();
const navigate = vi.fn();
const toggleWatchlist = vi.fn();
const recordResume = vi.fn();

let mockServices: any = {
  tmdb: null,
  indexers: null,
  debrid: null,
  ai: null,
  subtitles: null,
  translator: null,
};
let mockSettings: any = { transcode: false };

vi.mock("../store/AppStore", () => ({
  useAppStore: () => ({
    detailItem: mockDetailItem,
    closeDetail,
    openDetail,
    navigate,
    services: mockServices,
    settings: mockSettings,
    watchlist: mockWatchlist,
    toggleWatchlist,
    recordResume,
    continueWatching: mockContinueWatching,
    cachedResolutions: mockCached
      ? { [mockDetailItem?.id ?? "x"]: mockCached }
      : {},
  }),
}));

vi.mock("../data/detail", () => ({
  useDetail: () => mockDetail,
}));

vi.mock("../data/streams", () => ({
  useStreams: () => mockStreams,
}));

vi.mock("../data/library", () => ({
  isInWatchlist: () => inWatchlistResult,
}));

vi.mock("../lib/serverMode", () => ({
  isServerMode: () => serverModeOn,
}));

vi.mock("../lib/ServerSessionContext", () => ({
  useTranscodeAvailable: () => false,
}));

const createRequest = vi.fn<(...a: any[]) => any>();
const resolveServerStream = vi.fn<(...a: any[]) => any>();
vi.mock("../lib/serverApi", () => ({
  createRequest: (...a: unknown[]) => createRequest(...a),
  resolveServerStream: (...a: unknown[]) => resolveServerStream(...a),
}));

// Taste store + profile rebuild.
const recentTasteEvents = vi.fn<(...a: any[]) => Promise<any[]>>(async () => []);
const addTasteEvent = vi.fn<(...a: any[]) => Promise<void>>(async () => {});
const rebuildTasteContext = vi.fn<(...a: any[]) => Promise<string>>(
  async () => "ctx",
);
vi.mock("../storage", () => ({
  getStore: () => ({
    recentTasteEvents,
    addTasteEvent,
  }),
}));
vi.mock("../services/ai/TasteProfile", () => ({
  rebuildTasteContext: (...a: unknown[]) => rebuildTasteContext(...a),
}));

// --- child doubles ----------------------------------------------------------

vi.mock("../components/DetailHero", () => ({
  DetailHero: ({
    item,
    inWatchlist,
    onClose,
    onToggleWatchlist,
    onRequest,
    requestState,
    tasteSignal,
    onTasteSignal,
    onPlay,
  }: any) => (
    <div data-testid="hero">
      <span data-testid="hero-title">{item?.title}</span>
      <span data-testid="hero-inwl">{String(inWatchlist)}</span>
      <span data-testid="hero-reqstate">{requestState}</span>
      <span data-testid="hero-taste">{tasteSignal ?? "none"}</span>
      <button onClick={onPlay}>play</button>
      <button onClick={onClose}>close</button>
      <button onClick={onToggleWatchlist}>toggle-wl</button>
      <button onClick={() => onTasteSignal?.("liked")}>like</button>
      <button onClick={() => onTasteSignal?.("disliked")}>dislike</button>
      {onRequest && <button onClick={onRequest}>request</button>}
    </div>
  ),
}));

vi.mock("../components/DetailAnalysis", () => ({
  DetailAnalysis: () => <div data-testid="analysis" />,
}));

vi.mock("../components/OmdbRatings", () => ({
  OmdbRatings: ({ imdbId }: any) => (
    <div data-testid="omdb" data-imdb={imdbId ?? ""} />
  ),
}));

vi.mock("../components/StreamPicker", () => ({
  StreamPicker: ({ onOpenSettings }: any) => (
    <div data-testid="streampicker">
      <button onClick={onOpenSettings}>open-settings</button>
    </div>
  ),
}));

vi.mock("../components/EpisodePicker", () => ({
  EpisodePicker: ({ onSelect }: any) => (
    <button
      data-testid="pick-episode"
      onClick={() => onSelect({ season: 1, episode: 3 })}
    >
      pick-ep
    </button>
  ),
}));

vi.mock("../components/CastRail", () => ({
  CastRail: ({ cast }: any) => (
    <div data-testid="castrail" data-count={cast.length} />
  ),
}));

vi.mock("../components/Rail", () => ({
  Rail: ({ title, items, onSelect }: any) => (
    <div data-testid="related" data-title={title}>
      {items.map((it: MediaPreview) => (
        <button key={it.id} onClick={() => onSelect?.(it)}>
          related-{it.id}
        </button>
      ))}
    </div>
  ),
}));

vi.mock("../components/Spinner", () => ({
  Spinner: () => <div data-testid="spinner" />,
}));

vi.mock("../components/VideoPlayer", () => ({
  VideoPlayer: ({ title }: any) => (
    <div data-testid="player" data-title={title} />
  ),
}));

import { Detail } from "./Detail";

// --- fixtures ---------------------------------------------------------------

function preview(id: string, over: Partial<MediaPreview> = {}): MediaPreview {
  return { id, type: "movie", title: `Title ${id}`, ...over };
}

function mediaItem(over: Partial<MediaItem> = {}): MediaItem {
  return {
    id: "tt100",
    type: "movie",
    title: "The Movie",
    year: 2020,
    posterPath: null,
    backdropPath: null,
    overview: "An overview.",
    genres: ["Drama", "Mystery"],
    imdbRating: 7.5,
    rtRating: null,
    runtime: 120,
    status: null,
    tmdbId: 100,
    lastFetched: new Date().toISOString(),
    ...over,
  };
}

function detailState(over: Partial<DetailState["data"]> = {}): DetailState {
  return {
    data: {
      item: mediaItem(),
      cast: [],
      related: [],
      imdbId: "tt100",
      ...over,
    },
    loading: false,
    error: null,
    source: "live",
  };
}

function streamsState(): StreamsState {
  return { rows: [], loading: false, error: null } as unknown as StreamsState;
}

beforeEach(() => {
  mockDetailItem = preview("m1", { type: "movie", title: "Selected" });
  mockDetail = detailState();
  mockStreams = streamsState();
  mockWatchlist = [];
  inWatchlistResult = false;
  mockCached = null;
  mockContinueWatching = [];
  serverModeOn = false;
  mockServices = {
    tmdb: null,
    indexers: null,
    debrid: null,
    ai: null,
    subtitles: null,
    translator: null,
  };
  mockSettings = { transcode: false };
  vi.clearAllMocks();
  recentTasteEvents.mockResolvedValue([]);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("Detail null guard", () => {
  it("renders nothing when there is no selected item", () => {
    mockDetailItem = null;
    const { container } = render(<Detail />);
    expect(container.firstChild).toBeNull();
  });
});

describe("Detail base render", () => {
  it("renders hero, omdb, stream picker, cast rail and related", () => {
    mockDetail = detailState({
      cast: [{ id: 1, name: "Actor", character: "Role", profilePath: null } as any],
      related: [preview("rel1")],
    });
    render(<Detail />);
    expect(screen.getByTestId("hero")).toBeInTheDocument();
    expect(screen.getByTestId("hero-title").textContent).toBe("The Movie");
    expect(screen.getByTestId("omdb").getAttribute("data-imdb")).toBe("tt100");
    expect(screen.getByTestId("streampicker")).toBeInTheDocument();
    expect(screen.getByTestId("castrail").getAttribute("data-count")).toBe("1");
    expect(screen.getByText("related-rel1")).toBeInTheDocument();
  });

  it("omits the hero when the detail item is null (no metadata yet)", () => {
    mockDetail = detailState({ item: null });
    render(<Detail />);
    expect(screen.queryByTestId("hero")).toBeNull();
    // The stream picker still renders even without metadata.
    expect(screen.getByTestId("streampicker")).toBeInTheDocument();
  });

  it("series: streams open on a dedicated page, not inline at the bottom", async () => {
    mockDetailItem = preview("s1", { type: "series", title: "The Series", tmdbId: 200 });
    mockDetail = detailState({ item: mediaItem({ type: "series", id: "s1", tmdbId: 200 }) });
    render(<Detail />);
    // For a series the picker is NOT inline — it lives on its own page.
    expect(screen.queryByTestId("streampicker")).not.toBeInTheDocument();
    // Picking an episode opens the dedicated streams page.
    await userEvent.click(screen.getByTestId("pick-episode"));
    expect(screen.getByRole("dialog", { name: /Streams/ })).toBeInTheDocument();
    expect(screen.getByTestId("streampicker")).toBeInTheDocument();
    // "‹ Episodes" back button returns to the episode list (closes the page).
    await userEvent.click(screen.getByRole("button", { name: /Episodes/ }));
    expect(screen.queryByTestId("streampicker")).not.toBeInTheDocument();
  });

  it("renders the AI analysis only when the provider exposes analyzeTitle", () => {
    mockServices.ai = { analyzeTitle: vi.fn() };
    render(<Detail />);
    expect(screen.getByTestId("analysis")).toBeInTheDocument();
  });

  it("omits the AI analysis when no analyzeTitle provider is configured", () => {
    mockServices.ai = null;
    render(<Detail />);
    expect(screen.queryByTestId("analysis")).toBeNull();
  });

  it("reflects watchlist membership in the hero", () => {
    inWatchlistResult = true;
    render(<Detail />);
    expect(screen.getByTestId("hero-inwl").textContent).toBe("true");
  });
});

describe("Detail actions", () => {
  it("closes via the hero back/close button", async () => {
    render(<Detail />);
    await userEvent.click(screen.getByText("close"));
    expect(closeDetail).toHaveBeenCalledTimes(1);
  });

  it("toggles the watchlist for the selected item", async () => {
    render(<Detail />);
    await userEvent.click(screen.getByText("toggle-wl"));
    expect(toggleWatchlist).toHaveBeenCalledWith(
      expect.objectContaining({ id: "m1" }),
    );
  });

  it("opens settings from the stream picker (closes detail + navigates)", async () => {
    render(<Detail />);
    await userEvent.click(screen.getByText("open-settings"));
    expect(closeDetail).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith("settings");
  });

  it("forwards a related-item click to openDetail", async () => {
    mockDetail = detailState({ related: [preview("rel9")] });
    render(<Detail />);
    await userEvent.click(screen.getByText("related-rel9"));
    expect(openDetail).toHaveBeenCalledWith(
      expect.objectContaining({ id: "rel9" }),
    );
  });
});

describe("Detail play", () => {
  it("scrolls to the stream picker when there is no cached resolution", async () => {
    const scrollIntoView = vi.fn();
    const orig = document.getElementById.bind(document);
    vi.spyOn(document, "getElementById").mockImplementation((id) => {
      const el = orig(id);
      if (el) (el as any).scrollIntoView = scrollIntoView;
      return el;
    });
    render(<Detail />);
    await userEvent.click(screen.getByText("play"));
    await waitFor(() => expect(scrollIntoView).toHaveBeenCalled());
  });

  it("instant-plays a browser-playable cached stream in-window", async () => {
    mockCached = {
      stream: {
        fileName: "movie.mp4",
        streamURL: "https://cdn/movie.mp4",
        codec: "H.264",
      },
    };
    render(<Detail />);
    await userEvent.click(screen.getByText("play"));
    await waitFor(() => {
      expect(screen.getByTestId("player")).toBeInTheDocument();
    });
    expect(screen.getByTestId("player").getAttribute("data-title")).toBe(
      "movie.mp4",
    );
  });

  it("requests a transcode HLS url for an MKV cached stream", async () => {
    const getTranscodeHLS = vi.fn(async () => "https://cdn/stream.m3u8");
    mockServices.debrid = { getTranscodeHLS };
    mockCached = {
      stream: {
        fileName: "movie.mkv",
        streamURL: "https://cdn/movie.mkv",
        codec: "H.264",
      },
    };
    render(<Detail />);
    await userEvent.click(screen.getByText("play"));
    await waitFor(() => expect(getTranscodeHLS).toHaveBeenCalled());
    await waitFor(() =>
      expect(screen.getByTestId("player")).toBeInTheDocument(),
    );
  });

  it("falls back to the external player when HLS transcode is unavailable", async () => {
    const getTranscodeHLS = vi.fn(async () => null);
    mockServices.debrid = { getTranscodeHLS };
    mockCached = {
      stream: {
        fileName: "movie.mkv",
        streamURL: "https://cdn/movie.mkv",
        codec: "H.265",
      },
    };
    render(<Detail />);
    await userEvent.click(screen.getByText("play"));
    await waitFor(() =>
      expect(screen.getByTestId("player")).toBeInTheDocument(),
    );
    expect(getTranscodeHLS).toHaveBeenCalled();
  });
});

describe("Detail taste signal", () => {
  it("reads the newest taste event to seed the hero thumb on mount", async () => {
    recentTasteEvents.mockResolvedValue([
      { mediaId: "m1", eventType: "liked" },
    ]);
    render(<Detail />);
    await waitFor(() =>
      expect(screen.getByTestId("hero-taste").textContent).toBe("liked"),
    );
  });

  it("records a like and rebuilds the taste context", async () => {
    render(<Detail />);
    await userEvent.click(screen.getByText("like"));
    expect(screen.getByTestId("hero-taste").textContent).toBe("liked");
    await waitFor(() => expect(addTasteEvent).toHaveBeenCalled());
    const evt = addTasteEvent.mock.calls[0][0] as any;
    expect(evt.eventType).toBe("liked");
    expect(evt.mediaId).toBe("m1");
    expect(evt.signalStrength).toBe(1);
    // genres carried in metadata from the loaded item.
    expect(evt.metadata.genres).toContain("Mystery");
    await waitFor(() => expect(rebuildTasteContext).toHaveBeenCalled());
  });

  it("toggles an active like back off as a not_interested event", async () => {
    recentTasteEvents.mockResolvedValue([
      { mediaId: "m1", eventType: "liked" },
    ]);
    render(<Detail />);
    await waitFor(() =>
      expect(screen.getByTestId("hero-taste").textContent).toBe("liked"),
    );
    await userEvent.click(screen.getByText("like"));
    expect(screen.getByTestId("hero-taste").textContent).toBe("none");
    await waitFor(() => expect(addTasteEvent).toHaveBeenCalled());
    const evt = addTasteEvent.mock.calls[0][0] as any;
    expect(evt.eventType).toBe("not_interested");
    expect(evt.signalStrength).toBe(0);
  });

  it("records a dislike with negative signal strength", async () => {
    render(<Detail />);
    await userEvent.click(screen.getByText("dislike"));
    expect(screen.getByTestId("hero-taste").textContent).toBe("disliked");
    await waitFor(() => expect(addTasteEvent).toHaveBeenCalled());
    expect((addTasteEvent.mock.calls[0][0] as any).signalStrength).toBe(-1);
  });
});

describe("Detail server-mode title request", () => {
  it("does not expose a request action outside server mode", () => {
    serverModeOn = false;
    render(<Detail />);
    expect(screen.queryByText("request")).toBeNull();
    expect(screen.getByTestId("hero-reqstate").textContent).toBe("idle");
  });

  it("files a request and moves to the requested state", async () => {
    serverModeOn = true;
    createRequest.mockResolvedValue(undefined);
    render(<Detail />);
    await userEvent.click(screen.getByText("request"));
    await waitFor(() =>
      expect(screen.getByTestId("hero-reqstate").textContent).toBe(
        "requested",
      ),
    );
    expect(createRequest).toHaveBeenCalledWith(
      "m1",
      expect.objectContaining({ id: "m1" }),
    );
  });

  it("treats a 409 as an already-pending request", async () => {
    serverModeOn = true;
    createRequest.mockRejectedValue({ status: 409 });
    render(<Detail />);
    await userEvent.click(screen.getByText("request"));
    await waitFor(() =>
      expect(screen.getByTestId("hero-reqstate").textContent).toBe("already"),
    );
  });

  it("returns to idle on a non-409 request failure", async () => {
    serverModeOn = true;
    createRequest.mockRejectedValue({ status: 500 });
    render(<Detail />);
    await userEvent.click(screen.getByText("request"));
    await waitFor(() => expect(createRequest).toHaveBeenCalled());
    expect(screen.getByTestId("hero-reqstate").textContent).toBe("idle");
  });
});
