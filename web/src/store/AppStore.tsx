// App store — the single source of truth for routing, the Detail overlay, the
// shared service instances, and the persisted settings / watchlist / history.
// Implemented as a small React context + provider (no extra deps), with a
// `useAppStore()` hook plus a couple of focused selector hooks.
//
// Persistence is the storage port: a typed, cross-platform `Store` (IndexedDB
// via Dexie) that works in a plain browser AND the Tauri webview. The provider
// renders immediately from a synchronous bootstrap (env defaults + the legacy
// localStorage snapshot), then hydrates from the durable Store on mount; every
// mutation writes through the Store and refreshes the in-memory state.
//
// Services are rebuilt whenever settings change (buildServices reads the keys/
// tokens/sources), so saving a TMDB key in Settings immediately lights up live
// data without a reload. Everything imports the ported services READ-ONLY.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { ScreenId } from "../components/NavRail";
import type { MediaPreview } from "../models/media";
import type { BrowseContext } from "../data/browse";
import {
  type AppServices,
  type AppSettings,
  buildServices,
  loadSettings,
  loadSettingsFromStore,
  saveSettingsToStore,
} from "../data/settings";
import {
  loadContinueWatching,
  loadHistory,
  loadWatchlist,
  recordHistory,
  removeFromWatchlist as removeFromWatchlistStore,
  toggleWatchlist as toggleWatchlistStore,
} from "../data/library";
import type { CachedResolutionRecord, WatchHistoryRecord } from "../storage/models";
import { getStore } from "../storage";
import { AutoResolveScheduler } from "../lib/autoResolve";

export interface AppStore {
  // Routing
  route: ScreenId;
  navigate: (route: ScreenId) => void;

  // Detail overlay
  detailItem: MediaPreview | null;
  openDetail: (item: MediaPreview) => void;
  closeDetail: () => void;

  // Browse overlay ("See all" + advanced filters). Non-null mounts the Browse
  // screen over the current content (like Detail). Opened from rail "See all"
  // headers and Search with a context (category | genre | discover | search).
  browseContext: BrowseContext | null;
  openBrowse: (ctx: BrowseContext) => void;
  closeBrowse: () => void;

  // A pending query handed to the Search screen from the global search field.
  pendingSearch: string | null;
  search: (query: string) => void;
  consumePendingSearch: () => void;

  // Shared, read-only service instances (rebuilt when settings change).
  services: AppServices;

  // Settings (storage-port backed)
  settings: AppSettings;
  updateSettings: (next: AppSettings) => void;

  // Watchlist + History (storage-port backed)
  watchlist: MediaPreview[];
  history: MediaPreview[];
  /** Incomplete items with resume positions (the Continue Watching rail). */
  continueWatching: WatchHistoryRecord[];
  /** Cached, ready-to-play resolutions keyed by mediaId (the watchlist
   * "Ready to play" badge + instant playback). Populated by the background
   * auto-resolve job; empty in a plain browser. */
  cachedResolutions: Record<string, CachedResolutionRecord>;
  /** Re-read the cached-resolution table from the Store (after a pass). */
  refreshCachedResolutions: () => void;
  toggleWatchlist: (item: MediaPreview) => void;
  removeFromWatchlist: (id: string) => void;
  /** Record a real resume position (called from the player). */
  recordResume: (
    item: MediaPreview,
    progressSeconds: number,
    durationSeconds: number | null,
  ) => void;
}

const AppStoreContext = createContext<AppStore | null>(null);

export function AppStoreProvider({ children }: { children: ReactNode }) {
  const [route, setRoute] = useState<ScreenId>("discover");
  const [detailItem, setDetailItem] = useState<MediaPreview | null>(null);
  const [browseContext, setBrowseContext] = useState<BrowseContext | null>(null);
  const [pendingSearch, setPendingSearch] = useState<string | null>(null);

  // Synchronous bootstrap so the first paint has something sane; the durable
  // Store hydrates over it on mount.
  const [settings, setSettings] = useState<AppSettings>(() => loadSettings());
  const [watchlist, setWatchlist] = useState<MediaPreview[]>([]);
  const [history, setHistory] = useState<MediaPreview[]>([]);
  const [continueWatching, setContinueWatching] = useState<WatchHistoryRecord[]>(
    [],
  );
  const [cachedResolutions, setCachedResolutions] = useState<
    Record<string, CachedResolutionRecord>
  >({});

  // Hydrate everything from the Store once on mount.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [loadedSettings, wl, hist, cw, cached] = await Promise.all([
        loadSettingsFromStore(),
        loadWatchlist(),
        loadHistory(),
        loadContinueWatching(),
        getStore().listCachedResolutions().catch(() => []),
      ]);
      if (cancelled) return;
      setSettings(loadedSettings);
      setWatchlist(wl);
      setHistory(hist);
      setContinueWatching(cw);
      const map: Record<string, CachedResolutionRecord> = {};
      for (const r of cached) map[r.mediaId] = r;
      setCachedResolutions(map);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Rebuild services only when settings actually change.
  const services = useMemo(() => buildServices(settings), [settings]);

  const navigate = useCallback((next: ScreenId) => {
    // Switching primary destination dismisses any open overlays.
    setBrowseContext(null);
    setDetailItem(null);
    setRoute(next);
  }, []);

  const openBrowse = useCallback((ctx: BrowseContext) => {
    setBrowseContext(ctx);
  }, []);

  const closeBrowse = useCallback(() => setBrowseContext(null), []);

  const refreshCachedResolutions = useCallback(async () => {
    try {
      const rows = await getStore().listCachedResolutions();
      const map: Record<string, CachedResolutionRecord> = {};
      for (const r of rows) map[r.mediaId] = r;
      setCachedResolutions(map);
    } catch {
      // best-effort
    }
  }, []);

  // The background auto-resolve scheduler. It always reads the LATEST services
  // via the getter (so a settings change is picked up without rebuilding it),
  // and is Tauri-gated internally (a no-op in a plain browser). A ref keeps a
  // single instance across renders.
  const servicesRef = useRef(services);
  servicesRef.current = services;
  const schedulerRef = useRef<AutoResolveScheduler | null>(null);
  if (schedulerRef.current == null) {
    schedulerRef.current = new AutoResolveScheduler(() => ({
      tmdb: servicesRef.current.tmdb,
      indexers: servicesRef.current.indexers,
      debrid: servicesRef.current.debrid,
      store: getStore(),
    }));
  }

  const refreshHistory = useCallback(async () => {
    const [hist, cw] = await Promise.all([
      loadHistory(),
      loadContinueWatching(),
    ]);
    setHistory(hist);
    setContinueWatching(cw);
  }, []);

  // Drive the background auto-resolve scheduler. It only does work under Tauri
  // with debrid configured (gated internally); here we (re)start it whenever
  // debrid availability changes and refresh the cached-resolution badge state on
  // an interval so a completed pass shows up without a reload. No-op in browser.
  useEffect(() => {
    const scheduler = schedulerRef.current;
    if (scheduler == null) return;
    if (!services.hasDebrid) {
      scheduler.stop();
      return;
    }
    scheduler.start();
    // Poll the cached-resolution table so the watchlist badges reflect new
    // resolutions produced by background passes.
    const refresh = setInterval(() => void refreshCachedResolutions(), 30_000);
    void refreshCachedResolutions();
    return () => {
      clearInterval(refresh);
      scheduler.stop();
    };
  }, [services.hasDebrid, refreshCachedResolutions]);

  const openDetail = useCallback(
    (item: MediaPreview) => {
      setDetailItem(item);
      // Recording a view also feeds the History screen (zero-progress entry;
      // a real resume position is written later from the player).
      void recordHistory(item).then(() => void refreshHistory());
    },
    [refreshHistory],
  );

  const closeDetail = useCallback(() => setDetailItem(null), []);

  const search = useCallback((query: string) => {
    const q = query.trim();
    if (q.length === 0) return;
    setPendingSearch(q);
    setRoute("search");
  }, []);

  const consumePendingSearch = useCallback(() => setPendingSearch(null), []);

  const updateSettings = useCallback((next: AppSettings) => {
    // Optimistically update in-memory (rebuilds services immediately), then
    // persist to the durable Store. Persisting can reject if a keychain write
    // fails closed (desktop) — surface it to the console rather than leaving an
    // unhandled rejection; the in-memory value is still usable for the session.
    setSettings(next);
    void saveSettingsToStore(next).catch((err) => {
      // eslint-disable-next-line no-console
      console.error("Failed to persist settings:", err);
    });
  }, []);

  const toggleWatchlist = useCallback(
    (item: MediaPreview) => {
      void toggleWatchlistStore(item).then((next) => {
        setWatchlist(next);
        // If the item is now ON the watchlist, kick a pre-resolve pass so a
        // ready resolution is cached soon (Tauri-only; no-op in browser).
        if (next.some((i) => i.id === item.id)) {
          void schedulerRef.current?.kick().then(() => void refreshCachedResolutions());
        } else {
          // Removed → drop any cached resolution for it.
          void getStore()
            .deleteCachedResolution(item.id)
            .then(() => void refreshCachedResolutions());
        }
      });
    },
    [refreshCachedResolutions],
  );

  const removeFromWatchlist = useCallback(
    (id: string) => {
      void removeFromWatchlistStore(id).then((next) => {
        setWatchlist(next);
        void getStore()
          .deleteCachedResolution(id)
          .then(() => void refreshCachedResolutions());
      });
    },
    [refreshCachedResolutions],
  );

  const recordResume = useCallback(
    (
      item: MediaPreview,
      progressSeconds: number,
      durationSeconds: number | null,
    ) => {
      const completed =
        durationSeconds != null &&
        durationSeconds > 0 &&
        progressSeconds / durationSeconds >= 0.95;
      void recordHistory(item, {
        progressSeconds,
        durationSeconds,
        completed,
      }).then(() => void refreshHistory());
    },
    [refreshHistory],
  );

  const value: AppStore = {
    route,
    navigate,
    detailItem,
    openDetail,
    closeDetail,
    browseContext,
    openBrowse,
    closeBrowse,
    pendingSearch,
    search,
    consumePendingSearch,
    services,
    settings,
    updateSettings,
    watchlist,
    history,
    continueWatching,
    cachedResolutions,
    refreshCachedResolutions,
    toggleWatchlist,
    removeFromWatchlist,
    recordResume,
  };

  return (
    <AppStoreContext.Provider value={value}>
      {children}
    </AppStoreContext.Provider>
  );
}

/** Access the app store. Throws if used outside the provider. */
export function useAppStore(): AppStore {
  const store = useContext(AppStoreContext);
  if (store == null) {
    throw new Error("useAppStore must be used within an <AppStoreProvider>");
  }
  return store;
}
