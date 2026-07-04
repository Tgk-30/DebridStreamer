// @vitest-environment jsdom
//
// Component/hook tests for the AppStore provider — the single source of truth for
// routing, the Detail/Browse overlays, the shared services, and the persisted
// settings / watchlist / history.
//
// Strategy: mock every collaborator the provider imports (../data/settings,
// ../data/library, ../storage, ../lib/autoResolve, ../lib/serverMode) so the
// provider can be rendered in jsdom and every public action driven in isolation.
// We render the real <AppStoreProvider> wrapped in a real <ServerSessionProvider>
// (to exercise the simpleMode wiring) and read the store via renderHook.

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import type { MediaPreview } from "../models/media";
import type { AppServices, AppSettings } from "../data/settings";

// ---- Mockable collaborators ------------------------------------------------

// A controllable "services" object buildServices returns. Tests mutate
// `fakeServices.hasDebrid` then call rebuild to verify the scheduler effect.
const fakeServices: AppServices = {
  tmdb: null,
  omdb: null,
  debrid: null,
  indexers: { activeIndexers: [] } as unknown as AppServices["indexers"],
  ai: null,
  subtitles: null,
  translator: null,
  hasTMDB: false,
  hasDebrid: false,
  hasIndexers: false,
  hasAI: false,
  hasSubtitles: false,
};

const buildServices = vi.fn((_s: AppSettings): AppServices => ({ ...fakeServices }));
const loadSettings = vi.fn<() => AppSettings>();
const loadSettingsFromStore = vi.fn<() => Promise<AppSettings>>();
const saveSettingsToStore = vi.fn<(s: AppSettings) => Promise<void>>();

vi.mock("../data/settings", () => ({
  buildServices: (s: AppSettings) => buildServices(s),
  loadSettings: () => loadSettings(),
  loadSettingsFromStore: () => loadSettingsFromStore(),
  saveSettingsToStore: (s: AppSettings) => saveSettingsToStore(s),
  // Identity in tests: the one-time design refresh is exercised in its own
  // unit suite; here it must not mutate the hydrated fixture.
  applyDesignRefresh: (s: AppSettings) => s,
  markDesignRefreshApplied: () => {},
}));

const loadWatchlist = vi.fn<() => Promise<MediaPreview[]>>();
const loadHistory = vi.fn<() => Promise<MediaPreview[]>>();
const loadContinueWatching = vi.fn<() => Promise<unknown[]>>();
const recordHistory = vi.fn<(item: MediaPreview, opts?: unknown) => Promise<MediaPreview[]>>();
const toggleWatchlistStore = vi.fn<(item: MediaPreview) => Promise<MediaPreview[]>>();
const removeFromWatchlistStore = vi.fn<(id: string) => Promise<MediaPreview[]>>();

vi.mock("../data/library", () => ({
  loadWatchlist: () => loadWatchlist(),
  loadHistory: () => loadHistory(),
  loadContinueWatching: () => loadContinueWatching(),
  recordHistory: (item: MediaPreview, opts?: unknown) => recordHistory(item, opts),
  toggleWatchlist: (item: MediaPreview) => toggleWatchlistStore(item),
  removeFromWatchlist: (id: string) => removeFromWatchlistStore(id),
}));

const listCachedResolutions = vi.fn<() => Promise<Array<{ mediaId: string }>>>();
const deleteCachedResolution = vi.fn<(id: string) => Promise<void>>();
const isInWatchlist = vi.fn<(id: string) => Promise<boolean>>();
const addToWatchlist = vi.fn<(preview: MediaPreview) => Promise<void>>();
const fakeStore = {
  listCachedResolutions: () => listCachedResolutions(),
  deleteCachedResolution: (id: string) => deleteCachedResolution(id),
  isInWatchlist: (id: string) => isInWatchlist(id),
  addToWatchlist: (preview: MediaPreview) => addToWatchlist(preview),
  resetProfileCache: vi.fn(),
};
const getStore = vi.fn(() => fakeStore);

vi.mock("../storage", () => ({
  getStore: () => getStore(),
}));

// RemoteStore identity matters: AppStore does `store instanceof RemoteStore`.
// The class is defined INSIDE the (hoisted) factory; tests import it back below.
vi.mock("../storage/RemoteStore", () => {
  class FakeRemoteStore {
    resetProfileCache = vi.fn();
  }
  return { RemoteStore: FakeRemoteStore };
});

// Scheduler: a fake we can assert start/stop/kick on. The spies live on a
// hoisted holder (vitest allows referencing names prefixed with `mock`).
const mockScheduler = {
  start: vi.fn(),
  stop: vi.fn(),
  kick: vi.fn<() => Promise<unknown>>(),
};
vi.mock("../lib/autoResolve", () => {
  class FakeScheduler {
    constructor(public getDeps: () => unknown) {}
    start = mockScheduler.start;
    stop = mockScheduler.stop;
    kick = mockScheduler.kick;
  }
  return { AutoResolveScheduler: FakeScheduler };
});
const schedulerStart = mockScheduler.start;
const schedulerStop = mockScheduler.stop;
const schedulerKick = mockScheduler.kick;

const isServerMode = vi.fn<() => boolean>();
vi.mock("../lib/serverMode", () => ({
  isServerMode: () => isServerMode(),
}));

// Imported AFTER mocks (vi.mock is hoisted).
import { AppStoreProvider, useAppStore, useSimpleMode } from "./AppStore";
import {
  ServerSessionProvider,
  type ServerSession,
} from "../lib/ServerSessionContext";
// The mocked RemoteStore class, imported back so tests can build an instance
// that passes the `store instanceof RemoteStore` check in the provider.
import { RemoteStore as MockRemoteStore } from "../storage/RemoteStore";

// ---- Fixtures + helpers ----------------------------------------------------

function settings(overrides: Partial<AppSettings> = {}): AppSettings {
  return {
    tmdbKey: "",
    omdbKey: "",
    debridTokens: [],
    sources: [],
    builtInIndexersEnabled: true,
    aiProvider: "anthropic",
    aiApiKey: "",
    aiModel: "",
    ollamaEndpoint: "http://localhost:11434",
    theme: "midnight",
    appearanceAccent: "theme",
    appearanceDensity: "comfortable",
    appearanceTextSize: "m",
    appearanceMotion: "system",
    appearanceRadius: "default",
    appearanceBlur: 18,
    appearanceChrome: "balanced",
    appearanceBackdrop: "ambient",
    appearanceHeroScale: "standard",
    appearancePanelContrast: "standard",
    appearanceNavLabels: "auto",
    appearanceNavPosition: "side",
    appearanceNavTint: "balanced",
    appearancePosterSize: "default",
    subtitleFontScale: 1,
    subtitleTextColor: "#ffffff",
    subtitleBgOpacity: 0.55,
    openSubtitlesApiKey: "",
    simpleMode: true,
    autoUpdateChecks: true,
    autoInstallUpdates: false,
    streamCachedOnly: false,
    streamMaxQuality: "any",
    streamMaxSizeGB: 0,
    dataSaver: false,
    autoAdvanceEpisodes: true,
    showWatchStats: false,
    transcode: false,
    ratingScale: "ten",
    preferredExternalPlayer: "",
    userName: "",
    userAvatar: "",
    ...overrides,
  };
}

function media(id: string, title = id): MediaPreview {
  return { id, type: "movie", title };
}

/** Wrapper rendering the provider under a real ServerSessionProvider. */
function makeWrapper(session: ServerSession | null = null) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <ServerSessionProvider initial={session}>
        <AppStoreProvider>{children}</AppStoreProvider>
      </ServerSessionProvider>
    );
  };
}

/** Render the hook and wait until the async mount hydration has completed. */
async function renderStore(session: ServerSession | null = null) {
  // renderHook returns { result, rerender, unmount } where `result` is the ref
  // whose `.current` holds the latest hook value. Tests destructure the outer
  // `{ result }` and read `result.current`.
  const rendered = renderHook(() => useAppStore(), {
    wrapper: makeWrapper(session),
  });
  await waitFor(() => expect(rendered.result.current.hydrated).toBe(true));
  return rendered;
}

beforeEach(() => {
  vi.clearAllMocks();
  // Default happy-path resolutions.
  loadSettings.mockReturnValue(settings());
  loadSettingsFromStore.mockResolvedValue(settings());
  saveSettingsToStore.mockResolvedValue(undefined);
  loadWatchlist.mockResolvedValue([]);
  loadHistory.mockResolvedValue([]);
  loadContinueWatching.mockResolvedValue([]);
  recordHistory.mockResolvedValue([]);
  toggleWatchlistStore.mockResolvedValue([]);
  removeFromWatchlistStore.mockResolvedValue([]);
  listCachedResolutions.mockResolvedValue([]);
  deleteCachedResolution.mockResolvedValue(undefined);
  isInWatchlist.mockResolvedValue(false);
  addToWatchlist.mockResolvedValue(undefined);
  schedulerKick.mockResolvedValue(null);
  getStore.mockReturnValue(fakeStore);
  isServerMode.mockReturnValue(false);
  // Reset the controllable services flags.
  fakeServices.hasDebrid = false;
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useAppStore guard", () => {
  it("throws when used outside the provider", () => {
    // Silence the React error boundary console noise.
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => renderHook(() => useAppStore())).toThrow(
      /must be used within an <AppStoreProvider>/,
    );
    spy.mockRestore();
  });
});

describe("initial load / hydration", () => {
  it("starts on the discover route with overlays closed", async () => {
    const { result } = await renderStore();
    expect(result.current.route).toBe("discover");
    expect(result.current.detailItem).toBeNull();
    expect(result.current.browseContext).toBeNull();
    expect(result.current.pendingSearch).toBeNull();
  });

  it("hydrates settings/watchlist/history/continueWatching/cachedResolutions from the Store", async () => {
    loadSettingsFromStore.mockResolvedValue(settings({ theme: "aurora" }));
    loadWatchlist.mockResolvedValue([media("w1")]);
    loadHistory.mockResolvedValue([media("h1")]);
    loadContinueWatching.mockResolvedValue([{ mediaId: "cw1" }]);
    listCachedResolutions.mockResolvedValue([{ mediaId: "w1" }, { mediaId: "w2" }]);

    const { result } = await renderStore();

    expect(result.current.settings.theme).toBe("aurora");
    expect(result.current.watchlist).toEqual([media("w1")]);
    expect(result.current.history).toEqual([media("h1")]);
    expect(result.current.continueWatching).toEqual([{ mediaId: "cw1" }]);
    // cachedResolutions is keyed by mediaId.
    expect(Object.keys(result.current.cachedResolutions).sort()).toEqual([
      "w1",
      "w2",
    ]);
    expect(result.current.cachedResolutions.w1).toEqual({ mediaId: "w1" });
  });

  it("tolerates listCachedResolutions rejecting on mount (caught -> empty map)", async () => {
    listCachedResolutions.mockRejectedValue(new Error("no idb"));
    const { result } = await renderStore();
    expect(result.current.hydrated).toBe(true);
    expect(result.current.cachedResolutions).toEqual({});
  });

  it("still hydrates (never bricks) when a core Store read rejects on mount", async () => {
    // A blocked/corrupt IndexedDB, or a transient RemoteStore network error in
    // Server Mode, must not leave `hydrated` false forever (a blank screen). Each
    // slice degrades to a safe default; settings fall back to the sync bootstrap.
    loadSettingsFromStore.mockRejectedValue(new Error("idb blocked"));
    loadWatchlist.mockRejectedValue(new Error("idb blocked"));
    loadHistory.mockRejectedValue(new Error("idb blocked"));
    loadContinueWatching.mockRejectedValue(new Error("idb blocked"));
    loadSettings.mockReturnValue(settings({ theme: "aurora" }));

    const { result } = await renderStore();

    expect(result.current.hydrated).toBe(true);
    expect(result.current.settings.theme).toBe("aurora"); // bootstrap fallback
    expect(result.current.watchlist).toEqual([]);
    expect(result.current.history).toEqual([]);
    expect(result.current.continueWatching).toEqual([]);
  });

  it("builds services from the bootstrap settings", async () => {
    await renderStore();
    expect(buildServices).toHaveBeenCalled();
  });
});

describe("navigate", () => {
  it("changes the route and dismisses open overlays", async () => {
    const { result } = await renderStore();

    act(() => {
      result.current.openDetail(media("d1"));
      result.current.openBrowse({ kind: "search", query: "x" } as never);
    });
    expect(result.current.detailItem).not.toBeNull();
    expect(result.current.browseContext).not.toBeNull();

    act(() => result.current.navigate("settings"));
    expect(result.current.route).toBe("settings");
    expect(result.current.detailItem).toBeNull();
    expect(result.current.browseContext).toBeNull();
  });
});

describe("browse overlay", () => {
  it("opens and closes the browse context", async () => {
    const { result } = await renderStore();
    const ctx = { kind: "genre", genreId: 28 } as never;

    act(() => result.current.openBrowse(ctx));
    expect(result.current.browseContext).toBe(ctx);

    act(() => result.current.closeBrowse());
    expect(result.current.browseContext).toBeNull();
  });
});

describe("openDetail / closeDetail", () => {
  it("sets the detail item and records a (viewed) history entry, then refreshes history", async () => {
    recordHistory.mockResolvedValue([]);
    loadHistory.mockResolvedValueOnce([]); // mount
    const { result } = await renderStore();

    // After mount, loadHistory is refreshed via recordHistory().then(refreshHistory).
    loadHistory.mockResolvedValue([media("d1")]);
    loadContinueWatching.mockResolvedValue([]);

    act(() => result.current.openDetail(media("d1")));
    expect(result.current.detailItem).toEqual(media("d1"));
    // openDetail records a plain "viewed" event (no resume opts). The mock
    // wrapper forwards the (undefined) second arg, so match it explicitly.
    expect(recordHistory).toHaveBeenCalledWith(media("d1"), undefined);

    await waitFor(() =>
      expect(result.current.history).toEqual([media("d1")]),
    );

    act(() => result.current.closeDetail());
    expect(result.current.detailItem).toBeNull();
  });
});

describe("search / pendingSearch", () => {
  it("sets a trimmed pending query and routes to search", async () => {
    const { result } = await renderStore();
    act(() => result.current.search("  hello world  "));
    expect(result.current.pendingSearch).toBe("hello world");
    expect(result.current.route).toBe("search");
  });

  it("ignores a blank/whitespace-only query (no route change, no pending)", async () => {
    const { result } = await renderStore();
    act(() => result.current.navigate("library"));
    act(() => result.current.search("   "));
    expect(result.current.pendingSearch).toBeNull();
    expect(result.current.route).toBe("library");
  });

  it("consumePendingSearch clears the pending query", async () => {
    const { result } = await renderStore();
    act(() => result.current.search("query"));
    expect(result.current.pendingSearch).toBe("query");
    act(() => result.current.consumePendingSearch());
    expect(result.current.pendingSearch).toBeNull();
  });
});

describe("updateSettings", () => {
  it("optimistically updates in-memory settings, rebuilds services, and persists", async () => {
    const { result } = await renderStore();
    buildServices.mockClear();

    const next = settings({ theme: "noir", dataSaver: true });
    act(() => result.current.updateSettings(next));

    expect(result.current.settings).toEqual(next);
    // services rebuilt because settings identity changed.
    expect(buildServices).toHaveBeenCalledWith(next);
    await waitFor(() => expect(saveSettingsToStore).toHaveBeenCalledWith(next));
  });

  it("surfaces a persistence failure to console.error without throwing", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    saveSettingsToStore.mockRejectedValue(new Error("keychain locked"));
    const { result } = await renderStore();

    const next = settings({ theme: "noir" });
    act(() => result.current.updateSettings(next));
    // In-memory value is still applied for the session.
    expect(result.current.settings).toEqual(next);
    await waitFor(() =>
      expect(spy).toHaveBeenCalledWith(
        "Failed to persist settings:",
        expect.any(Error),
      ),
    );
    spy.mockRestore();
  });
});

describe("toggleWatchlist", () => {
  it("adds an item, sets the list, and kicks the scheduler when now present", async () => {
    const item = media("m1");
    toggleWatchlistStore.mockResolvedValue([item]);
    schedulerKick.mockResolvedValue(null);
    const { result } = await renderStore();

    act(() => result.current.toggleWatchlist(item));
    await waitFor(() => expect(result.current.watchlist).toEqual([item]));
    // Now ON the watchlist -> kick a pre-resolve pass (not a cache delete).
    await waitFor(() => expect(schedulerKick).toHaveBeenCalled());
    expect(deleteCachedResolution).not.toHaveBeenCalled();
  });

  it("removing an item drops its cached resolution instead of kicking", async () => {
    const item = media("m2");
    // toggle returns a list WITHOUT the item -> treated as a removal.
    toggleWatchlistStore.mockResolvedValue([]);
    const { result } = await renderStore();

    act(() => result.current.toggleWatchlist(item));
    await waitFor(() => expect(deleteCachedResolution).toHaveBeenCalledWith("m2"));
    expect(schedulerKick).not.toHaveBeenCalled();
  });

  it("coalesces a concurrent toggle of the SAME item (second call is a no-op)", async () => {
    const item = media("m3");
    let resolveToggle: (v: MediaPreview[]) => void = () => {};
    toggleWatchlistStore.mockReturnValue(
      new Promise<MediaPreview[]>((res) => {
        resolveToggle = res;
      }),
    );
    const { result } = await renderStore();

    act(() => result.current.toggleWatchlist(item));
    // Second tap while the first is still in flight: must be ignored.
    act(() => result.current.toggleWatchlist(item));
    expect(toggleWatchlistStore).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveToggle([item]);
      await Promise.resolve();
    });
    // Once settled, a fresh toggle is allowed again.
    toggleWatchlistStore.mockResolvedValue([]);
    act(() => result.current.toggleWatchlist(item));
    await waitFor(() => expect(toggleWatchlistStore).toHaveBeenCalledTimes(2));
  });
});

describe("removeFromWatchlist", () => {
  it("removes by id, updates the list, and drops the cached resolution", async () => {
    removeFromWatchlistStore.mockResolvedValue([]);
    const { result } = await renderStore();

    act(() => result.current.removeFromWatchlist("rm1"));
    await waitFor(() =>
      expect(removeFromWatchlistStore).toHaveBeenCalledWith("rm1"),
    );
    await waitFor(() =>
      expect(deleteCachedResolution).toHaveBeenCalledWith("rm1"),
    );
  });

  it("coalesces a concurrent remove of the same id", async () => {
    let resolveRemove: (v: MediaPreview[]) => void = () => {};
    removeFromWatchlistStore.mockReturnValue(
      new Promise<MediaPreview[]>((res) => {
        resolveRemove = res;
      }),
    );
    const { result } = await renderStore();

    act(() => result.current.removeFromWatchlist("dup"));
    act(() => result.current.removeFromWatchlist("dup"));
    expect(removeFromWatchlistStore).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveRemove([]);
      await Promise.resolve();
    });
  });
});

describe("importToWatchlist", () => {
  it("adds titles that aren't present, skips those that are, and returns counts", async () => {
    // "have" is already on the watchlist; "new1"/"new2" are not.
    isInWatchlist.mockImplementation(async (id: string) => id === "have");
    loadWatchlist.mockResolvedValue([media("new1"), media("new2")]);
    const { result } = await renderStore();

    let outcome: { added: number; skipped: number } | undefined;
    await act(async () => {
      outcome = await result.current.importToWatchlist([
        media("new1"),
        media("have"),
        media("new2"),
      ]);
    });

    expect(outcome).toEqual({ added: 2, skipped: 1 });
    expect(addToWatchlist).toHaveBeenCalledTimes(2);
    expect(addToWatchlist).not.toHaveBeenCalledWith(
      expect.objectContaining({ id: "have" }),
    );
    // The in-memory list is refreshed once at the end.
    expect(result.current.watchlist).toEqual([media("new1"), media("new2")]);
  });

  it("does nothing (and skips the refresh) when every title is already present", async () => {
    isInWatchlist.mockResolvedValue(true);
    const { result } = await renderStore();
    loadWatchlist.mockClear();

    let outcome: { added: number; skipped: number } | undefined;
    await act(async () => {
      outcome = await result.current.importToWatchlist([media("a"), media("b")]);
    });

    expect(outcome).toEqual({ added: 0, skipped: 2 });
    expect(addToWatchlist).not.toHaveBeenCalled();
    expect(loadWatchlist).not.toHaveBeenCalled(); // no refresh when nothing added
  });
});

describe("recordResume", () => {
  it("records progress and marks completed at >=95% watched", async () => {
    const { result } = await renderStore();
    const item = media("r1");

    act(() => result.current.recordResume(item, 95, 100));
    expect(recordHistory).toHaveBeenCalledWith(item, {
      progressSeconds: 95,
      durationSeconds: 100,
      completed: true,
      episodeId: null,
    });
  });

  it("forwards a series episode id (and defaults to null when omitted)", async () => {
    const { result } = await renderStore();
    const item = media("r5");

    act(() => result.current.recordResume(item, 42, 100, "s2e5"));
    expect(recordHistory).toHaveBeenCalledWith(item, {
      progressSeconds: 42,
      durationSeconds: 100,
      completed: false,
      episodeId: "s2e5",
    });
  });

  it("does NOT mark completed below 95%, and treats null/zero duration as incomplete", async () => {
    const { result } = await renderStore();

    act(() => result.current.recordResume(media("r2"), 40, 100));
    expect(recordHistory).toHaveBeenCalledWith(media("r2"), {
      progressSeconds: 40,
      durationSeconds: 100,
      completed: false,
      episodeId: null,
    });

    recordHistory.mockClear();
    act(() => result.current.recordResume(media("r3"), 10, null));
    expect(recordHistory).toHaveBeenCalledWith(media("r3"), {
      progressSeconds: 10,
      durationSeconds: null,
      completed: false,
      episodeId: null,
    });

    recordHistory.mockClear();
    act(() => result.current.recordResume(media("r4"), 10, 0));
    expect(recordHistory).toHaveBeenCalledWith(media("r4"), {
      progressSeconds: 10,
      durationSeconds: 0,
      completed: false,
      episodeId: null,
    });
  });
});

describe("refreshCachedResolutions", () => {
  it("re-reads the cached-resolution table into the keyed map", async () => {
    const { result } = await renderStore();
    listCachedResolutions.mockResolvedValue([{ mediaId: "a" }, { mediaId: "b" }]);

    await act(async () => {
      await result.current.refreshCachedResolutions();
    });
    expect(Object.keys(result.current.cachedResolutions).sort()).toEqual([
      "a",
      "b",
    ]);
  });

  it("swallows a listCachedResolutions rejection (best-effort)", async () => {
    const { result } = await renderStore();
    const before = result.current.cachedResolutions;
    listCachedResolutions.mockRejectedValue(new Error("boom"));
    await act(async () => {
      await result.current.refreshCachedResolutions();
    });
    // No throw; map unchanged.
    expect(result.current.cachedResolutions).toEqual(before);
  });
});

describe("auto-resolve scheduler effect", () => {
  it("stops the scheduler when debrid is NOT available", async () => {
    fakeServices.hasDebrid = false;
    await renderStore();
    expect(schedulerStop).toHaveBeenCalled();
    expect(schedulerStart).not.toHaveBeenCalled();
  });

  it("starts the scheduler and refreshes resolutions when debrid IS available", async () => {
    fakeServices.hasDebrid = true;
    await renderStore();
    expect(schedulerStart).toHaveBeenCalled();
    // The effect calls refreshCachedResolutions() immediately on start.
    await waitFor(() => expect(listCachedResolutions).toHaveBeenCalled());
  });
});

describe("reloadProfileData", () => {
  it("re-pulls every per-profile slice and updates state", async () => {
    const { result } = await renderStore();

    loadSettingsFromStore.mockResolvedValue(settings({ theme: "ProfileB" }));
    loadWatchlist.mockResolvedValue([media("pw")]);
    loadHistory.mockResolvedValue([media("ph")]);
    loadContinueWatching.mockResolvedValue([{ mediaId: "pcw" }]);

    await act(async () => {
      await result.current.reloadProfileData();
    });

    expect(result.current.settings.theme).toBe("ProfileB");
    expect(result.current.watchlist).toEqual([media("pw")]);
    expect(result.current.history).toEqual([media("ph")]);
    expect(result.current.continueWatching).toEqual([{ mediaId: "pcw" }]);
  });

  it("resets the RemoteStore profile cache when the store is a RemoteStore", async () => {
    // A RemoteStore instance that ALSO carries the Store methods the mount-time
    // hydration calls, so `store instanceof RemoteStore` is true while
    // listCachedResolutions() still resolves.
    // The mocked RemoteStore ignores constructor args; cast away the real
    // signature so we can instantiate it bare.
    const Ctor = MockRemoteStore as unknown as new () => Record<string, unknown>;
    const remote = new Ctor() as unknown as {
      resetProfileCache: ReturnType<typeof vi.fn>;
      listCachedResolutions: () => Promise<unknown[]>;
      deleteCachedResolution: (id: string) => Promise<void>;
    };
    remote.listCachedResolutions = () => Promise.resolve([]);
    remote.deleteCachedResolution = () => Promise.resolve();
    getStore.mockReturnValue(remote as never);
    const { result } = await renderStore();

    await act(async () => {
      await result.current.reloadProfileData();
    });
    expect(remote.resetProfileCache).toHaveBeenCalled();
  });

  it("does NOT call resetProfileCache for a plain (non-Remote) store", async () => {
    // Default fakeStore is not a RemoteStore instance.
    const { result } = await renderStore();
    await act(async () => {
      await result.current.reloadProfileData();
    });
    expect(fakeStore.resetProfileCache).not.toHaveBeenCalled();
  });
});

describe("simpleMode wiring", () => {
  it("Local Mode reads simpleMode from AppSettings", async () => {
    isServerMode.mockReturnValue(false);
    loadSettingsFromStore.mockResolvedValue(settings({ simpleMode: false }));
    const { result } = await renderStore();
    expect(result.current.simpleMode).toBe(false);
  });

  it("Server Mode reads simpleMode from the profile session", async () => {
    isServerMode.mockReturnValue(true);
    // AppSettings says simple=true, but the session says false -> session wins.
    loadSettingsFromStore.mockResolvedValue(settings({ simpleMode: true }));
    const session: ServerSession = {
      profileId: "p1",
      username: "u",
      displayName: "U",
      role: "owner",
      simpleMode: false,
    };
    const { result } = await renderStore(session);
    expect(result.current.simpleMode).toBe(false);
  });

  it("Server Mode defaults to simple=true when the session has not loaded", async () => {
    isServerMode.mockReturnValue(true);
    loadSettingsFromStore.mockResolvedValue(settings({ simpleMode: false }));
    const { result } = await renderStore(null);
    expect(result.current.simpleMode).toBe(true);
  });
});

describe("useSimpleMode convenience hook", () => {
  it("returns the effective simple/advanced tier", async () => {
    isServerMode.mockReturnValue(false);
    loadSettingsFromStore.mockResolvedValue(settings({ simpleMode: false }));
    const { result } = renderHook(() => useSimpleMode(), {
      wrapper: makeWrapper(null),
    });
    await waitFor(() => expect(result.current).toBe(false));
  });
});
