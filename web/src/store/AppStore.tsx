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
  useState,
  type ReactNode,
} from "react";
import type { ScreenId } from "../components/NavRail";
import type { MediaPreview } from "../models/media";
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
import type { WatchHistoryRecord } from "../storage/models";

export interface AppStore {
  // Routing
  route: ScreenId;
  navigate: (route: ScreenId) => void;

  // Detail overlay
  detailItem: MediaPreview | null;
  openDetail: (item: MediaPreview) => void;
  closeDetail: () => void;

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
  const [pendingSearch, setPendingSearch] = useState<string | null>(null);

  // Synchronous bootstrap so the first paint has something sane; the durable
  // Store hydrates over it on mount.
  const [settings, setSettings] = useState<AppSettings>(() => loadSettings());
  const [watchlist, setWatchlist] = useState<MediaPreview[]>([]);
  const [history, setHistory] = useState<MediaPreview[]>([]);
  const [continueWatching, setContinueWatching] = useState<WatchHistoryRecord[]>(
    [],
  );

  // Hydrate everything from the Store once on mount.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [loadedSettings, wl, hist, cw] = await Promise.all([
        loadSettingsFromStore(),
        loadWatchlist(),
        loadHistory(),
        loadContinueWatching(),
      ]);
      if (cancelled) return;
      setSettings(loadedSettings);
      setWatchlist(wl);
      setHistory(hist);
      setContinueWatching(cw);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Rebuild services only when settings actually change.
  const services = useMemo(() => buildServices(settings), [settings]);

  const navigate = useCallback((next: ScreenId) => setRoute(next), []);

  const refreshHistory = useCallback(async () => {
    const [hist, cw] = await Promise.all([
      loadHistory(),
      loadContinueWatching(),
    ]);
    setHistory(hist);
    setContinueWatching(cw);
  }, []);

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
    // persist to the durable Store.
    setSettings(next);
    void saveSettingsToStore(next);
  }, []);

  const toggleWatchlist = useCallback((item: MediaPreview) => {
    void toggleWatchlistStore(item).then(setWatchlist);
  }, []);

  const removeFromWatchlist = useCallback((id: string) => {
    void removeFromWatchlistStore(id).then(setWatchlist);
  }, []);

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
    pendingSearch,
    search,
    consumePendingSearch,
    services,
    settings,
    updateSettings,
    watchlist,
    history,
    continueWatching,
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
