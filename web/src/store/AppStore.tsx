// App store - the single source of truth for routing, the Detail overlay, the
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
  applyDesignRefresh,
  buildServices,
  loadSettings,
  loadSettingsFromStore,
  markDesignRefreshApplied,
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
import type {
  CachedResolutionRecord,
  PlaybackPrefs,
  WatchHistoryRecord,
} from "../storage/models";
import { getStore } from "../storage";
import { RemoteStore } from "../storage/RemoteStore";
import { AutoResolveScheduler } from "../lib/autoResolve";
import { isServerMode } from "../lib/serverMode";
import { useServerSession } from "../lib/ServerSessionContext";

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
  /** Effective Simple/Advanced experience: Server Mode reads the profile
   * session; Local Mode reads AppSettings. Drives progressive disclosure. */
  simpleMode: boolean;
  /** True once the durable Store has hydrated over the bootstrap defaults. */
  hydrated: boolean;

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
  /** Bulk-add already-resolved previews to the watchlist (used by import),
   * skipping any already present. Refreshes state + kicks a pre-resolve pass
   * once at the end. Resolves to how many were added vs skipped. */
  importToWatchlist: (
    previews: MediaPreview[],
  ) => Promise<{ added: number; skipped: number }>;
  /** Re-hydrate all per-profile data from the Store (watchlist / history /
   * continue-watching / settings). Called after a Server-Mode "who's watching"
   * profile switch so the UI reflects the newly-active profile's data. */
  reloadProfileData: () => Promise<void>;
  /** Record a real resume position (called from the player). For series pass
   *  the playing episode's id (`s2e5`); movies omit it / pass null. */
  recordResume: (
    item: MediaPreview,
    progressSeconds: number,
    durationSeconds: number | null,
    episodeId?: string | null,
    prefs?: PlaybackPrefs,
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
  // True once the durable Store has hydrated over the synchronous bootstrap. The
  // first-run wizard waits for this so its choice (e.g. Advanced → simpleMode
  // false) isn't racily clobbered by a late hydration setSettings().
  const [hydrated, setHydrated] = useState(false);

  // Hydrate everything from the Store once on mount.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      // Hydrate each slice independently: a single failing Store read (IndexedDB
      // blocked/corrupt, or a transient RemoteStore network error in Server Mode)
      // must degrade that one slice to a safe default - never reject the whole
      // Promise.all and leave `hydrated` false forever (a permanent blank screen).
      const [loadedSettings, wl, hist, cw, cached] = await Promise.all([
        loadSettingsFromStore().catch(() => loadSettings()),
        loadWatchlist().catch(() => []),
        loadHistory().catch(() => []),
        loadContinueWatching().catch(() => []),
        getStore().listCachedResolutions().catch(() => []),
      ]);
      if (cancelled) return;
      // One-time premium-redesign refresh: adopt the spacious appearance
      // defaults for installs that predate it (no-op after it has run once).
      // Mark it applied ONLY after a successful persist, so a failed Store write
      // retries next load instead of leaving the reset marked-done-but-lost.
      const refreshedSettings = applyDesignRefresh(loadedSettings);
      setSettings(refreshedSettings);
      if (refreshedSettings !== loadedSettings) {
        void saveSettingsToStore(refreshedSettings)
          .then(() => markDesignRefreshApplied())
          .catch(() => {
            /* leave the marker unset so the refresh retries next load */
          });
      }
      // Land on the user's chosen default tab. Only here, on first hydration - 
      // the app is still gated behind the wizard/hydration, so this can't stomp
      // a mid-session navigation. If the chosen tab is hidden under the active
      // modes, App's redirect effect sends it back to Discover.
      if (refreshedSettings.appearanceDefaultTab !== "discover") {
        setRoute(refreshedSettings.appearanceDefaultTab);
      }
      setWatchlist(wl);
      setHistory(hist);
      setContinueWatching(cw);
      const map: Record<string, CachedResolutionRecord> = {};
      for (const r of cached) map[r.mediaId] = r;
      setCachedResolutions(map);
      setHydrated(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Re-pull every per-profile slice from the Store. Used after a Server-Mode
  // profile switch: the RemoteStore's cached settings are dropped first so the
  // refetch reflects the NEW active profile (the server resolves the active
  // profile from the session, so the same endpoints now return its data).
  const reloadProfileData = useCallback(async () => {
    const store = getStore();
    if (store instanceof RemoteStore) store.resetProfileCache();
    const [loadedSettings, wl, hist, cw] = await Promise.all([
      loadSettingsFromStore(),
      loadWatchlist(),
      loadHistory(),
      loadContinueWatching(),
    ]);
    setSettings(loadedSettings);
    setWatchlist(wl);
    setHistory(hist);
    setContinueWatching(cw);
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
      setCachedResolutions((prev) => {
        // The 30s badge poll almost always returns an identical set. Replacing
        // the map with a fresh object each tick changes the context value's
        // identity and re-renders EVERY useAppStore() consumer - expensive idle
        // churn. Bail out (return the same reference) unless a resolution
        // actually changed, comparing only the scalar identity fields (`stream`
        // is a freshly-built object every fetch, so it can't be compared by ref).
        const unchanged =
          rows.length === Object.keys(prev).length &&
          rows.every((r) => {
            const p = prev[r.mediaId];
            return (
              p != null &&
              p.infoHash === r.infoHash &&
              p.resolvedAt === r.resolvedAt &&
              p.debridService === r.debridService
            );
          });
        if (unchanged) return prev;
        const map: Record<string, CachedResolutionRecord> = {};
        for (const r of rows) map[r.mediaId] = r;
        return map;
      });
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
  // A ref so the scheduler's deps closure always reads the CURRENT settings (for
  // the data-saver caps), not the ones captured when it was first constructed.
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const schedulerRef = useRef<AutoResolveScheduler | null>(null);
  if (schedulerRef.current == null) {
    schedulerRef.current = new AutoResolveScheduler(() => ({
      tmdb: servicesRef.current.tmdb,
      indexers: servicesRef.current.indexers,
      debrid: servicesRef.current.debrid,
      store: getStore(),
      settings: settingsRef.current,
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
    // resolutions produced by background passes. PERF: skip ticks while the
    // window is hidden (nobody can see the badges) and catch up once when it
    // becomes visible again.
    const refresh = setInterval(() => {
      if (!document.hidden) void refreshCachedResolutions();
    }, 30_000);
    const onVisible = () => {
      if (!document.hidden) void refreshCachedResolutions();
    };
    document.addEventListener("visibilitychange", onVisible);
    void refreshCachedResolutions();
    return () => {
      clearInterval(refresh);
      document.removeEventListener("visibilitychange", onVisible);
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
    // fails closed (desktop) - surface it to the console rather than leaving an
    // unhandled rejection; the in-memory value is still usable for the session.
    setSettings(next);
    void saveSettingsToStore(next).catch((err) => {
      // eslint-disable-next-line no-console
      console.error("Failed to persist settings:", err);
    });
  }, []);

  // Coalesce concurrent watchlist mutations of the SAME item: each
  // toggle/remove is an independent read-modify-write against the store, so a
  // fast double-tap could interleave (both read "absent", both add) and corrupt
  // the persisted list or commit a stale in-memory array out of order.
  const watchlistMutating = useRef<Set<string>>(new Set());

  const toggleWatchlist = useCallback(
    (item: MediaPreview) => {
      if (watchlistMutating.current.has(item.id)) return;
      watchlistMutating.current.add(item.id);
      void toggleWatchlistStore(item)
        .then((next) => {
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
        })
        .finally(() => watchlistMutating.current.delete(item.id));
    },
    [refreshCachedResolutions],
  );

  const removeFromWatchlist = useCallback(
    (id: string) => {
      if (watchlistMutating.current.has(id)) return;
      watchlistMutating.current.add(id);
      void removeFromWatchlistStore(id)
        .then((next) => {
          setWatchlist(next);
          void getStore()
            .deleteCachedResolution(id)
            .then(() => void refreshCachedResolutions());
        })
        .finally(() => watchlistMutating.current.delete(id));
    },
    [refreshCachedResolutions],
  );

  const importToWatchlist = useCallback(
    async (previews: MediaPreview[]) => {
      const store = getStore();
      let added = 0;
      let skipped = 0;
      for (const preview of previews) {
        if (await store.isInWatchlist(preview.id)) {
          skipped += 1;
          continue;
        }
        await store.addToWatchlist(preview);
        added += 1;
      }
      if (added > 0) {
        // One state refresh + one pre-resolve kick for the whole batch.
        setWatchlist(await loadWatchlist());
        void schedulerRef.current?.kick().then(() => void refreshCachedResolutions());
      }
      return { added, skipped };
    },
    [refreshCachedResolutions],
  );

  const recordResume = useCallback(
    (
      item: MediaPreview,
      progressSeconds: number,
      durationSeconds: number | null,
      episodeId?: string | null,
      prefs?: PlaybackPrefs,
    ) => {
      const completed =
        durationSeconds != null &&
        durationSeconds > 0 &&
        progressSeconds / durationSeconds >= 0.95;
      void recordHistory(item, {
        progressSeconds,
        durationSeconds,
        completed,
        episodeId: episodeId ?? null,
        preferredAudioId: prefs?.preferredAudioId,
        preferredAudioLang: prefs?.preferredAudioLang,
        preferredSubId: prefs?.preferredSubId,
        playbackSpeed: prefs?.playbackSpeed,
      }).then(() => void refreshHistory());
    },
    [refreshHistory],
  );

  // Effective experience tier. Server Mode is authoritative from the profile
  // session (default Simple when the session hasn't loaded yet); Local Mode uses
  // the AppSettings flag.
  const serverSession = useServerSession();
  const simpleMode = isServerMode()
    ? (serverSession?.simpleMode ?? true)
    : settings.simpleMode;

  // PERF: memoize the context value. Every member below is already referentially
  // stable between unrelated updates (useCallback/useState); without useMemo the
  // provider handed out a FRESH object on every render - so each 30s badge poll
  // re-rendered every `useAppStore()` consumer in the app.
  const value: AppStore = useMemo(
    () => ({
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
      simpleMode,
      hydrated,
      watchlist,
      history,
      continueWatching,
      cachedResolutions,
      refreshCachedResolutions,
      toggleWatchlist,
      removeFromWatchlist,
      importToWatchlist,
      reloadProfileData,
      recordResume,
    }),
    [
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
      simpleMode,
      hydrated,
      watchlist,
      history,
      continueWatching,
      cachedResolutions,
      refreshCachedResolutions,
      toggleWatchlist,
      removeFromWatchlist,
      importToWatchlist,
      reloadProfileData,
      recordResume,
    ],
  );

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

/** Convenience hook for the effective Simple/Advanced experience tier. */
export function useSimpleMode(): boolean {
  return useAppStore().simpleMode;
}
