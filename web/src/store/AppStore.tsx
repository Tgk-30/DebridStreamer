// App store — the single source of truth for routing, the Detail overlay, the
// shared service instances, and the (localStorage-backed) settings / watchlist /
// history. Implemented as a small React context + provider (no extra deps), with
// a `useAppStore()` hook plus a couple of focused selector hooks.
//
// Services are rebuilt whenever settings change (buildServices reads the keys/
// tokens/sources), so saving a TMDB key in Settings immediately lights up live
// data without a reload. Everything imports the ported services READ-ONLY.

import {
  createContext,
  useCallback,
  useContext,
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
  saveSettings,
} from "../data/settings";
import {
  loadHistory,
  loadWatchlist,
  recordHistory,
  removeFromWatchlist as removeFromWatchlistStore,
  toggleWatchlist as toggleWatchlistStore,
} from "../data/library";

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

  // Settings (localStorage-backed this phase)
  settings: AppSettings;
  updateSettings: (next: AppSettings) => void;

  // Watchlist + History (localStorage-backed this phase)
  watchlist: MediaPreview[];
  history: MediaPreview[];
  toggleWatchlist: (item: MediaPreview) => void;
  removeFromWatchlist: (id: string) => void;
}

const AppStoreContext = createContext<AppStore | null>(null);

export function AppStoreProvider({ children }: { children: ReactNode }) {
  const [route, setRoute] = useState<ScreenId>("discover");
  const [detailItem, setDetailItem] = useState<MediaPreview | null>(null);
  const [pendingSearch, setPendingSearch] = useState<string | null>(null);

  const [settings, setSettings] = useState<AppSettings>(() => loadSettings());
  const [watchlist, setWatchlist] = useState<MediaPreview[]>(() =>
    loadWatchlist(),
  );
  const [history, setHistory] = useState<MediaPreview[]>(() => loadHistory());

  // Rebuild services only when settings actually change.
  const services = useMemo(() => buildServices(settings), [settings]);

  const navigate = useCallback((next: ScreenId) => setRoute(next), []);

  const openDetail = useCallback((item: MediaPreview) => {
    setDetailItem(item);
    // Recording a view also feeds the History screen.
    setHistory(recordHistory(item));
  }, []);

  const closeDetail = useCallback(() => setDetailItem(null), []);

  const search = useCallback((query: string) => {
    const q = query.trim();
    if (q.length === 0) return;
    setPendingSearch(q);
    setRoute("search");
  }, []);

  const consumePendingSearch = useCallback(() => setPendingSearch(null), []);

  const updateSettings = useCallback((next: AppSettings) => {
    saveSettings(next);
    setSettings(next);
  }, []);

  const toggleWatchlist = useCallback((item: MediaPreview) => {
    setWatchlist(toggleWatchlistStore(item));
  }, []);

  const removeFromWatchlist = useCallback((id: string) => {
    setWatchlist(removeFromWatchlistStore(id));
  }, []);

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
    toggleWatchlist,
    removeFromWatchlist,
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
