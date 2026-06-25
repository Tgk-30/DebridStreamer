// @vitest-environment jsdom
//
// React-hook tests for the three data-layer hooks that the existing `*.test.ts`
// files deliberately skip (those run in the node env and only exercise the pure
// helpers). Here we render the hooks under jsdom and drive their loading ->
// loaded / empty / error / server-mode-vs-local branches with mocked deps:
//   - useDebridLibrary (debridLibrary.ts): mocks a DebridManager-shaped object.
//   - useCalendar (calendar.ts): mocks getStore + serverApi + serverMode + metadata.
//   - useGenres (genres.ts): mocks serverApi + serverMode; fake TMDBService.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import type { DebridManager } from "../services/debrid/DebridManager";
import type { DebridTorrent } from "../services/debrid/models";
import type { MediaPreview, MediaType } from "../models/media";
import type { UpcomingEpisode } from "../lib/metadata";
import type { TMDBService } from "../services/metadata/TMDBService";
import type { Genre } from "../services/metadata/types";

// --- Module mocks (shared by useCalendar + useGenres) ---------------------
const listLibrary = vi.fn();
const listWatchlist = vi.fn();
vi.mock("../storage", () => ({
  getStore: () => ({ listLibrary, listWatchlist }),
}));

const isServerMode = vi.fn(() => false);
vi.mock("../lib/serverMode", () => ({
  isServerMode: () => isServerMode(),
}));

const fetchServerGenres = vi.fn();
const fetchServerUpcomingEpisodes = vi.fn();
vi.mock("../lib/serverApi", () => ({
  fetchServerGenres: (...a: unknown[]) => fetchServerGenres(...a),
  fetchServerUpcomingEpisodes: (...a: unknown[]) => fetchServerUpcomingEpisodes(...a),
}));

const getUpcomingEpisodesForSeries = vi.fn();
vi.mock("../lib/metadata", async (importActual) => {
  const actual = await importActual<typeof import("../lib/metadata")>();
  return {
    ...actual,
    getUpcomingEpisodesForSeries: (...a: unknown[]) => getUpcomingEpisodesForSeries(...a),
  };
});

// Import the hooks AFTER the mocks are registered.
import { useDebridLibrary } from "./debridLibrary";
import { useCalendar } from "./calendar";
import { useGenres } from "./genres";

// --- helpers --------------------------------------------------------------

function torrent(partial: Partial<DebridTorrent>): DebridTorrent {
  return {
    id: partial.id ?? "1",
    name: partial.name ?? "Some.Movie.2024.1080p.mkv",
    sizeBytes: partial.sizeBytes ?? 1024 * 1024 * 1024,
    status: partial.status ?? "downloaded",
    infoHash: partial.infoHash ?? null,
    addedAt: partial.addedAt ?? null,
    host: partial.host ?? null,
    progress: partial.progress ?? null,
    debridService: partial.debridService ?? "RD",
  };
}

/** A DebridManager-shaped stub. `hasServices` + `listTorrents` are all the hook
 * touches. */
function fakeDebrid(opts: {
  hasServices: boolean;
  listTorrents?: () => Promise<DebridTorrent[]>;
}): DebridManager {
  return {
    hasServices: opts.hasServices,
    listTorrents: opts.listTorrents ?? vi.fn(async () => []),
  } as unknown as DebridManager;
}

function preview(id: string, type: MediaPreview["type"] = "series"): MediaPreview {
  return { id, type, title: `Title ${id}` };
}

function ep(airDate: string, n = 1): UpcomingEpisode {
  return { series: preview("s"), seasonNumber: 1, episodeNumber: n, title: `Ep ${n}`, airDate };
}

beforeEach(() => {
  listLibrary.mockReset().mockResolvedValue([]);
  listWatchlist.mockReset().mockResolvedValue([]);
  isServerMode.mockReset().mockReturnValue(false);
  fetchServerGenres.mockReset();
  fetchServerUpcomingEpisodes.mockReset();
  getUpcomingEpisodesForSeries.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// =========================================================================
// useDebridLibrary
// =========================================================================
describe("useDebridLibrary", () => {
  it("starts loading then resolves rows with a duplicate count", async () => {
    const list = vi.fn(async () => [
      torrent({ id: "a", infoHash: "dup" }),
      torrent({ id: "b", infoHash: "dup" }),
      torrent({ id: "c", infoHash: "uniq" }),
    ]);
    const debrid = fakeDebrid({ hasServices: true, listTorrents: list });

    const { result } = renderHook(() => useDebridLibrary(debrid));

    // hasDebrid is true so the initial state is loading.
    expect(result.current.state.hasDebrid).toBe(true);

    await waitFor(() => expect(result.current.state.loading).toBe(false));
    expect(result.current.state.rows.map((r) => r.torrent.id)).toEqual(["a", "b", "c"]);
    expect(result.current.state.duplicateCount).toBe(2);
    expect(result.current.state.error).toBeNull();
    expect(list).toHaveBeenCalledTimes(1);
  });

  it("resolves to an empty, non-loading, non-error state for an empty account", async () => {
    const debrid = fakeDebrid({ hasServices: true, listTorrents: vi.fn(async () => []) });
    const { result } = renderHook(() => useDebridLibrary(debrid));

    await waitFor(() => expect(result.current.state.loading).toBe(false));
    expect(result.current.state.rows).toEqual([]);
    expect(result.current.state.duplicateCount).toBe(0);
    expect(result.current.state.error).toBeNull();
    expect(result.current.state.hasDebrid).toBe(true);
  });

  it("captures an Error message when listTorrents rejects", async () => {
    const debrid = fakeDebrid({
      hasServices: true,
      listTorrents: vi.fn(async () => {
        throw new Error("RD exploded");
      }),
    });
    const { result } = renderHook(() => useDebridLibrary(debrid));

    await waitFor(() => expect(result.current.state.loading).toBe(false));
    expect(result.current.state.error).toBe("RD exploded");
    expect(result.current.state.rows).toEqual([]);
    expect(result.current.state.hasDebrid).toBe(true);
    expect(result.current.state.duplicateCount).toBe(0);
  });

  it("stringifies a non-Error rejection value", async () => {
    const debrid = fakeDebrid({
      hasServices: true,
      listTorrents: vi.fn(async () => {
        throw "plain string failure";
      }),
    });
    const { result } = renderHook(() => useDebridLibrary(debrid));

    await waitFor(() => expect(result.current.state.loading).toBe(false));
    expect(result.current.state.error).toBe("plain string failure");
  });

  it("treats a null manager as no-debrid: not loading, empty, hasDebrid false", async () => {
    const { result } = renderHook(() => useDebridLibrary(null));

    await waitFor(() => expect(result.current.state.loading).toBe(false));
    expect(result.current.state.hasDebrid).toBe(false);
    expect(result.current.state.rows).toEqual([]);
    expect(result.current.state.error).toBeNull();
  });

  it("treats a manager with no services configured as no-debrid", async () => {
    const list = vi.fn(async () => [torrent({ id: "x" })]);
    const debrid = fakeDebrid({ hasServices: false, listTorrents: list });
    const { result } = renderHook(() => useDebridLibrary(debrid));

    await waitFor(() => expect(result.current.state.loading).toBe(false));
    expect(result.current.state.hasDebrid).toBe(false);
    expect(result.current.state.rows).toEqual([]);
    // listTorrents must never be called when no service is configured.
    expect(list).not.toHaveBeenCalled();
  });

  it("reload() re-fetches and picks up fresh data", async () => {
    let calls = 0;
    const list = vi.fn(async () => {
      calls += 1;
      return calls === 1
        ? [torrent({ id: "old" })]
        : [torrent({ id: "new1" }), torrent({ id: "new2" })];
    });
    const debrid = fakeDebrid({ hasServices: true, listTorrents: list });
    const { result } = renderHook(() => useDebridLibrary(debrid));

    await waitFor(() => expect(result.current.state.rows.map((r) => r.torrent.id)).toEqual(["old"]));

    await act(async () => {
      result.current.reload();
    });

    await waitFor(() =>
      expect(result.current.state.rows.map((r) => r.torrent.id)).toEqual(["new1", "new2"]),
    );
    expect(list).toHaveBeenCalledTimes(2);
  });
});

// =========================================================================
// useCalendar
// =========================================================================
describe("useCalendar", () => {
  const tmdb = {} as TMDBService;

  it("loads series, resolves episodes via TMDB (local mode), and groups them", async () => {
    listLibrary.mockResolvedValue([{ preview: preview("s1") }]);
    // groupEpisodes uses the real Date.now(); use a far-future date so it lands
    // in 'later' deterministically regardless of the machine clock.
    getUpcomingEpisodesForSeries.mockResolvedValue([ep("2999-01-01", 1)]);

    const { result } = renderHook(() => useCalendar(tmdb));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.hasSeries).toBe(true);
    expect(result.current.hasTMDB).toBe(true);
    expect(result.current.error).toBeNull();
    expect(result.current.groups.map((g) => g.bucket)).toEqual(["later"]);
    expect(getUpcomingEpisodesForSeries).toHaveBeenCalledTimes(1);
    expect(fetchServerUpcomingEpisodes).not.toHaveBeenCalled();
  });

  it("empty library yields hasSeries=false and no episode fetch", async () => {
    // Both lists empty (default from beforeEach).
    const { result } = renderHook(() => useCalendar(tmdb));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.hasSeries).toBe(false);
    expect(result.current.groups).toEqual([]);
    expect(getUpcomingEpisodesForSeries).not.toHaveBeenCalled();
  });

  it("with series but no TMDB key (local mode) reports hasSeries=true, hasTMDB=false, no fetch", async () => {
    listLibrary.mockResolvedValue([{ preview: preview("s1") }]);
    const { result } = renderHook(() => useCalendar(null));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.hasSeries).toBe(true);
    expect(result.current.hasTMDB).toBe(false);
    expect(result.current.groups).toEqual([]);
    expect(getUpcomingEpisodesForSeries).not.toHaveBeenCalled();
  });

  it("uses the SERVER episode endpoint in server mode even with a null tmdb", async () => {
    isServerMode.mockReturnValue(true);
    listWatchlist.mockResolvedValue([{ preview: preview("s2") }]);
    getUpcomingEpisodesForSeries.mockResolvedValue([ep("2999-02-02", 1)]); // should NOT be used
    fetchServerUpcomingEpisodes.mockResolvedValue([ep("2999-03-03", 1)]);

    const { result } = renderHook(() => useCalendar(null));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.hasTMDB).toBe(true); // server mode counts as having metadata
    expect(result.current.hasSeries).toBe(true);
    expect(result.current.groups.map((g) => g.bucket)).toEqual(["later"]);
    expect(fetchServerUpcomingEpisodes).toHaveBeenCalledTimes(1);
    expect(getUpcomingEpisodesForSeries).not.toHaveBeenCalled();
  });

  it("captures an error and clears hasSeries when episode resolution rejects", async () => {
    listLibrary.mockResolvedValue([{ preview: preview("s1") }]);
    getUpcomingEpisodesForSeries.mockRejectedValue(new Error("tmdb 500"));

    const { result } = renderHook(() => useCalendar(tmdb));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("tmdb 500");
    expect(result.current.hasSeries).toBe(false);
    expect(result.current.groups).toEqual([]);
  });

  it("stringifies a non-Error rejection from episode resolution", async () => {
    listLibrary.mockResolvedValue([{ preview: preview("s1") }]);
    getUpcomingEpisodesForSeries.mockRejectedValue("string boom");

    const { result } = renderHook(() => useCalendar(tmdb));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("string boom");
  });
});

// =========================================================================
// useGenres
// =========================================================================
describe("useGenres", () => {
  it("seeds with the static movie fallback synchronously on first render", () => {
    const { result } = renderHook(() => useGenres(null, "movie"));
    // 18 canonical movie genres; first is Action.
    expect(result.current).toHaveLength(18);
    expect(result.current[0]).toEqual({ id: 28, name: "Action" });
  });

  it("seeds with the TV fallback for the series type", () => {
    const { result } = renderHook(() => useGenres(null, "series"));
    expect(result.current.some((g) => g.name === "Sci-Fi & Fantasy")).toBe(true);
    expect(result.current.some((g) => g.name === "Action & Adventure")).toBe(true);
  });

  it("swaps in the live list from TMDBService.getGenres (local mode)", async () => {
    const live: Genre[] = [{ id: 1, name: "Live A" }, { id: 2, name: "Live B" }];
    const getGenres = vi.fn(async () => live);
    const service = { getGenres } as unknown as TMDBService;

    const { result } = renderHook(() => useGenres(service, "movie"));

    await waitFor(() => expect(result.current).toEqual(live));
    expect(getGenres).toHaveBeenCalledWith("movie");
    expect(fetchServerGenres).not.toHaveBeenCalled();
  });

  it("keeps the fallback when the live list comes back empty", async () => {
    const getGenres = vi.fn(async () => []);
    const service = { getGenres } as unknown as TMDBService;

    const { result } = renderHook(() => useGenres(service, "movie"));

    // Give the resolved (empty) promise a chance to run; fallback must remain.
    await waitFor(() => expect(getGenres).toHaveBeenCalled());
    expect(result.current).toHaveLength(18);
    expect(result.current[0].name).toBe("Action");
  });

  it("keeps the fallback when getGenres rejects", async () => {
    const getGenres = vi.fn(async () => {
      throw new Error("network");
    });
    const service = { getGenres } as unknown as TMDBService;

    const { result } = renderHook(() => useGenres(service, "movie"));

    await waitFor(() => expect(getGenres).toHaveBeenCalled());
    expect(result.current).toHaveLength(18);
  });

  it("uses the SERVER genre endpoint in server mode (ignoring the TMDB service)", async () => {
    isServerMode.mockReturnValue(true);
    const serverGenres: Genre[] = [{ id: 99, name: "Server Genre" }];
    fetchServerGenres.mockResolvedValue(serverGenres);
    const getGenres = vi.fn();
    const service = { getGenres } as unknown as TMDBService;

    const { result } = renderHook(() => useGenres(service, "movie"));

    await waitFor(() => expect(result.current).toEqual(serverGenres));
    expect(fetchServerGenres).toHaveBeenCalledWith("movie");
    // The local TMDB path must not run in server mode.
    expect(getGenres).not.toHaveBeenCalled();
  });

  it("keeps the fallback when the server genre fetch rejects in server mode", async () => {
    isServerMode.mockReturnValue(true);
    fetchServerGenres.mockRejectedValue(new Error("server down"));

    const { result } = renderHook(() => useGenres(null, "movie"));

    await waitFor(() => expect(fetchServerGenres).toHaveBeenCalled());
    expect(result.current).toHaveLength(18);
    expect(result.current[0].name).toBe("Action");
  });

  it("resets to the new type's fallback when the type prop switches", async () => {
    const { result, rerender } = renderHook(({ t }: { t: MediaType }) => useGenres(null, t), {
      initialProps: { t: "movie" },
    });
    expect(result.current[0]).toEqual({ id: 28, name: "Action" });

    rerender({ t: "series" });
    await waitFor(() =>
      expect(result.current.some((g) => g.name === "Action & Adventure")).toBe(true),
    );
    // The movie-only "Adventure" entry should be gone after switching to TV.
    expect(result.current.some((g) => g.name === "Adventure")).toBe(false);
  });
});
