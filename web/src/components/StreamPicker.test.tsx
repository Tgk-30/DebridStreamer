// @vitest-environment jsdom
//
// Behavioral tests for StreamPicker: loading skeleton, no-indexers / error /
// no-streams empty states, the row list (quality + cached/will-cache badges,
// metadata), the Cached-only toggle + its filtered-empty state, row selection
// (resolve -> onPlay), the resolving badge + disabled state, resolve errors,
// and the "no debrid configured" guard.

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";

import type { StreamRow, StreamsState } from "../data/streams";
import type { StreamMaxQuality } from "../data/settings";
import { DebridServiceType, type StreamInfo } from "../services/debrid/models";
import { TorrentResult } from "../services/indexers/models";

// --- Mocks --------------------------------------------------------------

// Only the four fields filterStreamRows / effectiveDataSaver actually read.
interface TestSettings {
  dataSaver: boolean;
  streamCachedOnly: boolean;
  streamMaxQuality: StreamMaxQuality;
  streamMaxSizeGB: number;
}

// Default settings make filterStreamRows a pure no-op (Data Saver off, no caps).
let storeSettings: TestSettings = {
  dataSaver: false,
  streamCachedOnly: false,
  streamMaxQuality: "any",
  streamMaxSizeGB: 0,
};

vi.mock("../store/AppStore", () => ({
  useAppStore: () => ({ settings: storeSettings }),
}));

vi.mock("./Icon", () => ({
  Icon: ({ name }: { name: string }) => <i data-icon={name} />,
}));

vi.mock("./StreamPicker.css", () => ({}));

import { StreamPicker } from "./StreamPicker";

// --- Fixtures -----------------------------------------------------------

function makeRow(opts: {
  hash: string;
  title: string;
  sizeBytes?: number;
  seeders?: number;
  indexerName?: string;
  cachedOn?: DebridServiceType | null;
}): StreamRow {
  const result = TorrentResult.fromSearch({
    infoHash: opts.hash,
    title: opts.title,
    sizeBytes: opts.sizeBytes ?? 1_500_000_000,
    seeders: opts.seeders ?? 42,
    leechers: 1,
    indexerName: opts.indexerName ?? "Jackett",
  });
  return { result, cachedOn: opts.cachedOn ?? null };
}

function baseState(over: Partial<StreamsState> = {}): StreamsState {
  return {
    rows: [],
    loading: false,
    error: null,
    hasIndexers: true,
    hasDebrid: true,
    ...over,
  };
}

const noop = () => {};
const neverResolve = async (): Promise<StreamInfo> => {
  throw new Error("should not be called");
};

afterEach(() => {
  cleanup();
  storeSettings = {
    dataSaver: false,
    streamCachedOnly: false,
    streamMaxQuality: "any",
    streamMaxSizeGB: 0,
  };
});

describe("StreamPicker", () => {
  it("renders the loading skeleton when state.loading is true", () => {
    const { container } = render(
      <StreamPicker
        state={baseState({ loading: true })}
        resolveStream={neverResolve}
        onPlay={noop}
      />,
    );
    const list = container.querySelector(".streams-skeleton");
    expect(list).not.toBeNull();
    expect(list).toHaveAttribute("aria-busy", "true");
    // 4 skeleton rows.
    expect(container.querySelectorAll(".stream-row-skel")).toHaveLength(4);
  });

  it("shows the 'no sources configured' empty state and an Open settings button", () => {
    const onOpenSettings = vi.fn();
    render(
      <StreamPicker
        state={baseState({ hasIndexers: false })}
        resolveStream={neverResolve}
        onPlay={noop}
        onOpenSettings={onOpenSettings}
      />,
    );
    expect(screen.getByText("No sources yet")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Open settings/ }));
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
  });

  it("omits the settings button when no onOpenSettings is given", () => {
    render(
      <StreamPicker
        state={baseState({ hasIndexers: false })}
        resolveStream={neverResolve}
        onPlay={noop}
      />,
    );
    expect(screen.getByText("No sources yet")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Open settings/ })).toBeNull();
  });

  it("renders an error state when state.error is set", () => {
    render(
      <StreamPicker
        state={baseState({ error: "Indexer timed out" })}
        resolveStream={neverResolve}
        onPlay={noop}
      />,
    );
    expect(screen.getByText("Couldn't search streams")).toBeInTheDocument();
    expect(screen.getByText("Indexer timed out")).toBeInTheDocument();
  });

  it("renders the 'No streams found' empty state when there are no rows", () => {
    render(
      <StreamPicker
        state={baseState({ rows: [] })}
        resolveStream={neverResolve}
        onPlay={noop}
      />,
    );
    expect(screen.getByText("No streams found")).toBeInTheDocument();
  });

  it("tells the truth with no debrid service and routes to the guided setup", () => {
    const onEvent = vi.fn();
    window.addEventListener("ds:open-first-run", onEvent);
    try {
      render(
        <StreamPicker
          state={baseState({ rows: [], hasDebrid: false })}
          resolveStream={neverResolve}
          onPlay={noop}
        />,
      );
      // NOT the misleading "sources did not return a match" copy — nothing was
      // searched for playback without a debrid service.
      expect(
        screen.getByText("Almost there — add a debrid service"),
      ).toBeInTheDocument();
      expect(screen.queryByText("No streams found")).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: "Run guided setup" }));
      expect(onEvent).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener("ds:open-first-run", onEvent);
    }
  });

  it("lists rows with quality, metadata and the correct cached / will-cache badge", () => {
    const rows = [
      makeRow({
        hash: "AAA",
        title: "Dune.2021.1080p.BluRay.x265",
        sizeBytes: 4_000_000_000,
        seeders: 99,
        indexerName: "Jackett",
        cachedOn: DebridServiceType.realDebrid,
      }),
      makeRow({
        hash: "BBB",
        title: "Dune.2021.720p.WEB-DL",
        cachedOn: null,
      }),
    ];
    render(
      <StreamPicker
        state={baseState({ rows })}
        resolveStream={neverResolve}
        onPlay={noop}
      />,
    );

    // Cached row: green "Instant · RD" badge.
    const cached = screen.getByText("Dune.2021.1080p.BluRay.x265").closest("button")!;
    expect(within(cached).getByText(/Instant/)).toBeInTheDocument();
    expect(within(cached).getByText(/RD/)).toBeInTheDocument();
    // Quality chip + seeders + indexer metadata are shown.
    expect(within(cached).getByText("1080p")).toBeInTheDocument();
    expect(within(cached).getByText("99 seeders")).toBeInTheDocument();
    expect(within(cached).getByText("Jackett")).toBeInTheDocument();

    // Non-cached row: grey "Will cache" badge.
    const willCache = screen.getByText("Dune.2021.720p.WEB-DL").closest("button")!;
    expect(within(willCache).getByText("Will cache")).toBeInTheDocument();
  });

  it("shows the instant/total counts in the header", () => {
    const rows = [
      makeRow({ hash: "A", title: "A 1080p", cachedOn: DebridServiceType.allDebrid }),
      makeRow({ hash: "B", title: "B 1080p", cachedOn: null }),
      makeRow({ hash: "C", title: "C 1080p", cachedOn: null }),
    ];
    render(
      <StreamPicker state={baseState({ rows })} resolveStream={neverResolve} onPlay={noop} />,
    );
    expect(screen.getByText(/1 instant · 3 total/)).toBeInTheDocument();
  });

  it("cached-first sorts the rows (instant rows render before will-cache ones)", () => {
    const rows = [
      makeRow({ hash: "A", title: "Uncached First 1080p", cachedOn: null }),
      makeRow({ hash: "B", title: "Cached Second 1080p", cachedOn: DebridServiceType.torBox }),
    ];
    const { container } = render(
      <StreamPicker state={baseState({ rows })} resolveStream={neverResolve} onPlay={noop} />,
    );
    const names = Array.from(container.querySelectorAll(".stream-name")).map(
      (n) => n.textContent,
    );
    expect(names[0]).toBe("Cached Second 1080p");
    expect(names[1]).toBe("Uncached First 1080p");
  });

  it("Cached-only toggle filters to instant streams, with a show-all escape hatch", () => {
    const rows = [
      makeRow({ hash: "A", title: "Cached One 1080p", cachedOn: DebridServiceType.premiumize }),
      makeRow({ hash: "B", title: "Uncached Two 1080p", cachedOn: null }),
    ];
    render(
      <StreamPicker state={baseState({ rows })} resolveStream={neverResolve} onPlay={noop} />,
    );

    const toggle = screen.getByRole("checkbox", { name: /Cached only/ });
    fireEvent.click(toggle);

    expect(screen.getByText("Cached One 1080p")).toBeInTheDocument();
    expect(screen.queryByText("Uncached Two 1080p")).toBeNull();
  });

  it("Cached-only with zero cached rows shows the instant-empty state + Show all", () => {
    const rows = [
      makeRow({ hash: "A", title: "Uncached A 1080p", cachedOn: null }),
      makeRow({ hash: "B", title: "Uncached B 1080p", cachedOn: null }),
    ];
    render(
      <StreamPicker state={baseState({ rows })} resolveStream={neverResolve} onPlay={noop} />,
    );

    fireEvent.click(screen.getByRole("checkbox", { name: /Cached only/ }));
    expect(screen.getByText("No instant streams shown")).toBeInTheDocument();

    // "Show all streams" turns the toggle back off and re-reveals the rows.
    fireEvent.click(screen.getByRole("button", { name: "Show all streams" }));
    expect(screen.getByText("Uncached A 1080p")).toBeInTheDocument();
  });

  it("resolves a selected stream and calls onPlay with the StreamInfo + torrent", async () => {
    const row = makeRow({ hash: "AAA", title: "Pick Me 1080p", cachedOn: DebridServiceType.realDebrid });
    const resolved: StreamInfo = {
      streamURL: "https://cdn.example/stream.mkv",
      quality: "1080p",
      codec: "H.265",
      audio: "Atmos",
      source: "BluRay",
      sizeBytes: 1234,
      fileName: "pick.mkv",
      debridService: "RD",
    };
    const resolveStream = vi.fn().mockResolvedValue(resolved);
    const onPlay = vi.fn();

    render(
      <StreamPicker
        state={baseState({ rows: [row] })}
        resolveStream={resolveStream}
        onPlay={onPlay}
      />,
    );

    fireEvent.click(screen.getByText("Pick Me 1080p").closest("button")!);

    await waitFor(() => expect(onPlay).toHaveBeenCalledTimes(1));
    expect(resolveStream).toHaveBeenCalledWith(row);
    expect(onPlay).toHaveBeenCalledWith(resolved, row.result);
  });

  it("shows a Resolving… badge and disables the row while resolving", async () => {
    const row = makeRow({ hash: "AAA", title: "Slow Pick 1080p", cachedOn: null });
    let release!: (s: StreamInfo) => void;
    const resolveStream = vi.fn(
      () => new Promise<StreamInfo>((res) => {
        release = res;
      }),
    );

    render(
      <StreamPicker
        state={baseState({ rows: [row] })}
        resolveStream={resolveStream}
        onPlay={noop}
      />,
    );

    const button = screen.getByText("Slow Pick 1080p").closest("button")!;
    fireEvent.click(button);

    await waitFor(() => expect(screen.getByText(/Resolving/)).toBeInTheDocument());
    expect(button).toBeDisabled();

    // Resolve to let the pending promise settle.
    release({
      streamURL: "u",
      quality: "1080p",
      codec: "Unknown",
      audio: "Unknown",
      source: "Unknown",
      sizeBytes: 0,
      fileName: "f",
      debridService: "RD",
    });
    await waitFor(() => expect(button).not.toBeDisabled());
  });

  it("surfaces a resolve error message and clears the resolving state", async () => {
    const row = makeRow({ hash: "AAA", title: "Bad Pick 1080p", cachedOn: null });
    const resolveStream = vi.fn().mockRejectedValue(new Error("Debrid 429"));

    render(
      <StreamPicker
        state={baseState({ rows: [row] })}
        resolveStream={resolveStream}
        onPlay={noop}
      />,
    );

    fireEvent.click(screen.getByText("Bad Pick 1080p").closest("button")!);

    await waitFor(() => expect(screen.getByText("Debrid 429")).toBeInTheDocument());
    // Row is interactive again (resolving cleared).
    expect(screen.getByText("Bad Pick 1080p").closest("button")!).not.toBeDisabled();
  });

  it("blocks selection with a guidance message when no debrid is configured", async () => {
    const row = makeRow({ hash: "AAA", title: "No Debrid 1080p", cachedOn: null });
    const resolveStream = vi.fn();

    render(
      <StreamPicker
        state={baseState({ rows: [row], hasDebrid: false })}
        resolveStream={resolveStream}
        onPlay={noop}
      />,
    );

    fireEvent.click(screen.getByText("No Debrid 1080p").closest("button")!);

    expect(await screen.findByText(/Add a debrid service in Settings to play/)).toBeInTheDocument();
    expect(resolveStream).not.toHaveBeenCalled();
  });

  it("shows the 'filters hid every stream' empty state when Data Saver removes all rows", () => {
    // Tighten settings so the 1080p / 4 GB row is filtered out entirely.
    storeSettings = {
      dataSaver: false,
      streamCachedOnly: false,
      streamMaxQuality: "480p",
      streamMaxSizeGB: 0,
    };
    const rows = [makeRow({ hash: "A", title: "Big 1080p File", cachedOn: null })];

    render(
      <StreamPicker state={baseState({ rows })} resolveStream={neverResolve} onPlay={noop} />,
    );
    expect(screen.getByText("Playback filters hid every stream")).toBeInTheDocument();
  });

  // --- Resolution / codec filter chips (opt-in) -------------------------

  it("renders resolution + codec chips only when >1 value is present, and filters by resolution", () => {
    const rows = [
      makeRow({ hash: "A", title: "Movie 2160p x265", cachedOn: null }),
      makeRow({ hash: "B", title: "Movie 1080p x264", cachedOn: null }),
      makeRow({ hash: "C", title: "Movie 720p x264", cachedOn: null }),
    ];
    render(
      <StreamPicker state={baseState({ rows })} resolveStream={neverResolve} onPlay={noop} />,
    );

    const group = screen.getByRole("group", { name: "Filter streams" });
    expect(group).toBeInTheDocument();
    // A chip per present resolution (4K/1080p/720p) and codec (H.265/H.264).
    const chip4k = within(group).getByRole("button", { name: "4K" });
    expect(chip4k).toHaveAttribute("aria-pressed", "false");
    // All three rows are listed before filtering.
    expect(screen.getAllByText(/^Movie /)).toHaveLength(3);

    // Click the 4K chip → only the 2160p row remains, chip is pressed.
    fireEvent.click(chip4k);
    expect(chip4k).toHaveAttribute("aria-pressed", "true");
    const list = document.querySelector(".streams-list")!;
    expect(within(list as HTMLElement).getAllByText(/^Movie /)).toHaveLength(1);
    expect(within(list as HTMLElement).getByText("Movie 2160p x265")).toBeInTheDocument();

    // Clicking it again clears the filter (all three return).
    fireEvent.click(chip4k);
    expect(chip4k).toHaveAttribute("aria-pressed", "false");
    expect(screen.getAllByText(/^Movie /)).toHaveLength(3);
  });

  it("does not render the chip row when only one resolution and one codec are present", () => {
    const rows = [
      makeRow({ hash: "A", title: "Movie 1080p x264 one", cachedOn: null }),
      makeRow({ hash: "B", title: "Movie 1080p x264 two", cachedOn: null }),
    ];
    render(
      <StreamPicker state={baseState({ rows })} resolveStream={neverResolve} onPlay={noop} />,
    );
    expect(screen.queryByRole("group", { name: "Filter streams" })).not.toBeInTheDocument();
  });

  it("clears active chips when a new title's results arrive (no stale pre-filtering)", () => {
    const rowsA = [
      makeRow({ hash: "A", title: "Title A 2160p x265", cachedOn: null }),
      makeRow({ hash: "B", title: "Title A 1080p x264", cachedOn: null }),
    ];
    const { rerender } = render(
      <StreamPicker state={baseState({ rows: rowsA })} resolveStream={neverResolve} onPlay={noop} />,
    );
    const chip4k = within(
      screen.getByRole("group", { name: "Filter streams" }),
    ).getByRole("button", { name: "4K" });
    fireEvent.click(chip4k);
    expect(chip4k).toHaveAttribute("aria-pressed", "true");

    // A different title resolves (new rows identity) that also has a 4K option —
    // the old 4K chip must NOT carry over and silently pre-filter it.
    const rowsB = [
      makeRow({ hash: "C", title: "Title B 2160p x265", cachedOn: null }),
      makeRow({ hash: "D", title: "Title B 1080p x264", cachedOn: null }),
    ];
    rerender(
      <StreamPicker state={baseState({ rows: rowsB })} resolveStream={neverResolve} onPlay={noop} />,
    );
    expect(
      within(screen.getByRole("group", { name: "Filter streams" })).getByRole("button", {
        name: "4K",
      }),
    ).toHaveAttribute("aria-pressed", "false");
    // Both of Title B's rows are shown (unfiltered).
    expect(screen.getAllByText(/^Title B /)).toHaveLength(2);
  });

  it("shows the chip-empty state with a Clear filters button when a resolution+codec combo matches nothing", () => {
    // 4K is only H.265, 1080p is only H.264 → selecting 4K + H.264 is empty.
    const rows = [
      makeRow({ hash: "A", title: "Movie 2160p x265", cachedOn: null }),
      makeRow({ hash: "B", title: "Movie 1080p x264", cachedOn: null }),
    ];
    render(
      <StreamPicker state={baseState({ rows })} resolveStream={neverResolve} onPlay={noop} />,
    );
    const group = screen.getByRole("group", { name: "Filter streams" });
    fireEvent.click(within(group).getByRole("button", { name: "4K" }));
    fireEvent.click(within(group).getByRole("button", { name: "H.264" }));

    expect(screen.getByText("No streams match those filters")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Clear filters/ }));
    // Both rows return after clearing.
    expect(screen.getAllByText(/^Movie /)).toHaveLength(2);
  });
});
