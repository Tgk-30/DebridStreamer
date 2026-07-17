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
// Services rebuild only when their keys/tokens/sources change, so saving a TMDB
// key lights up live data without making unrelated preference saves restart
// service consumers. Everything imports the ported services READ-ONLY.

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
import { getStore, swapLocalProfileStore } from "../storage";
import { RemoteStore } from "../storage/RemoteStore";
import { AutoResolveScheduler } from "../lib/autoResolve";
import { isServerMode } from "../lib/serverMode";
import { setNetworkMode } from "../lib/networkPolicy";
import { useServerSession } from "../lib/ServerSessionContext";
import { verifyPassword } from "../lib/passwordHash";
import {
  dbNameForProfile,
  ensureDefaultProfile,
  getActiveProfileId,
  getProfile,
  isMultiUserEnabled,
  listProfiles,
  setActiveProfileId,
  updateProfileRecord,
  type LocalProfile,
} from "../storage/ProfileRegistry";

// Password unlocks deliberately live only for this renderer session. A reload
// returns protected Local Mode profiles to their lock screen.
const unlockedProfileIds = new Set<string>();

export function isLocalProfileUnlocked(id: string): boolean {
  return unlockedProfileIds.has(id);
}

/** Outcome of a durable settings write. Reported rather than thrown so the many
 *  fire-and-forget callers can't produce unhandled rejections. */
export interface SaveResult {
  ok: boolean;
}

export interface AppStore {
  // Routing
  route: ScreenId;
  navigate: (route: ScreenId) => void;

  // Detail overlay
  detailItem: MediaPreview | null;
  openDetail: (item: MediaPreview) => void;
  closeDetail: () => void;

  // Desktop local-file player. This is separate from Detail's stream player so
  // completed downloads can be played from any screen without fabricating a
  // debrid stream.
  localFilePlayer: { path: string; title: string } | null;
  playLocalFile: (path: string, title: string) => void;
  closeLocalFilePlayer: () => void;

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
  /** Applies in memory immediately and persists. Resolves to `{ok: false}` when
   *  the durable write fails, so a caller that reports success can avoid
   *  claiming a save that did not happen. Never rejects - safe to ignore. */
  updateSettings: (next: AppSettings) => Promise<SaveResult>;
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
  /** Re-read only Continue Watching after a playback session closes. Waits for
   * any final progress write already in flight before loading the slice. */
  refreshContinueWatching: () => Promise<void>;
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
  /** Local Mode profile registry state. Server Mode continues to use its
   * session profile context and never reads this registry. */
  activeProfile: LocalProfile | null;
  profiles: LocalProfile[];
  multiUserEnabled: boolean;
  refreshProfiles: () => Promise<void>;
  switchLocalProfile: (
    id: string,
    password?: string,
  ) => Promise<{ ok: boolean; reason?: "bad-password" | "not-found" }>;
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

/** Stable command/service access for shell controls that do not render data. */
export interface AppActions {
  /** Read the current services inside an event path. Render-time service users
   * stay on useAppStore so a configuration change can update their UI. */
  getServices: () => AppServices;
  navigate: AppStore["navigate"];
  openDetail: AppStore["openDetail"];
  closeDetail: AppStore["closeDetail"];
  openBrowse: AppStore["openBrowse"];
  closeBrowse: AppStore["closeBrowse"];
  search: AppStore["search"];
  consumePendingSearch: AppStore["consumePendingSearch"];
  updateSettings: AppStore["updateSettings"];
  refreshContinueWatching: AppStore["refreshContinueWatching"];
  refreshCachedResolutions: AppStore["refreshCachedResolutions"];
  toggleWatchlist: AppStore["toggleWatchlist"];
  removeFromWatchlist: AppStore["removeFromWatchlist"];
  importToWatchlist: AppStore["importToWatchlist"];
  reloadProfileData: AppStore["reloadProfileData"];
  refreshProfiles: AppStore["refreshProfiles"];
  switchLocalProfile: AppStore["switchLocalProfile"];
  recordResume: AppStore["recordResume"];
}

const AppStoreContext = createContext<AppStore | null>(null);
const AppActionsContext = createContext<AppActions | null>(null);

export function AppStoreProvider({ children }: { children: ReactNode }) {
  const [route, setRoute] = useState<ScreenId>("discover");
  const [detailItem, setDetailItem] = useState<MediaPreview | null>(null);
  const [localFilePlayer, setLocalFilePlayer] = useState<{
    path: string;
    title: string;
  } | null>(null);
  const [browseContext, setBrowseContext] = useState<BrowseContext | null>(null);
  const [pendingSearch, setPendingSearch] = useState<string | null>(null);

  // Synchronous bootstrap so the first paint has something sane; the durable
  // Store hydrates over it on mount.
  const [settings, setSettings] = useState<AppSettings>(() => {
    const initial = loadSettings();
    // Apply the persisted privacy mode SYNCHRONOUSLY on first render, before any
    // child effect (auto-update check, discover fetch) can fire, so a fullLocal
    // or offline user never has a boot window running under the default mode.
    setNetworkMode(initial.networkMode);
    return initial;
  });
  const [watchlist, setWatchlist] = useState<MediaPreview[]>([]);
  const watchlistRef = useRef(watchlist);
  watchlistRef.current = watchlist;
  const [history, setHistory] = useState<MediaPreview[]>([]);
  const [continueWatching, setContinueWatching] = useState<WatchHistoryRecord[]>(
    [],
  );
  const pendingResumeWritesRef = useRef<Set<Promise<unknown>>>(new Set());
  const [cachedResolutions, setCachedResolutions] = useState<
    Record<string, CachedResolutionRecord>
  >({});
  // True once the durable Store has hydrated over the synchronous bootstrap. The
  // first-run wizard waits for this so its choice (e.g. Advanced → simpleMode
  // false) isn't racily clobbered by a late hydration setSettings().
  const [hydrated, setHydrated] = useState(false);
  const [activeProfile, setActiveProfile] = useState<LocalProfile | null>(null);
  const [profiles, setProfiles] = useState<LocalProfile[]>([]);
  const [multiUserEnabled, setMultiUserEnabledState] = useState(true);

  // Hydrate everything from the Store once on mount.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      // Hydrate each slice independently: a single failing Store read (IndexedDB
      // blocked/corrupt, or a transient RemoteStore network error in Server Mode)
      // must degrade that one slice to a safe default - never reject the whole
      // Promise.all and leave `hydrated` false forever (a permanent blank screen).
      // Resolve Local Mode's active database before any per-profile read. The
      // default keeps the literal legacy database name and therefore never
      // closes or migrates an existing single-user installation at boot.
      if (!isServerMode()) {
        // The whole profile-resolution chain is guarded: if the registry DB is
        // blocked/corrupt/quota-denied it must degrade to the implicit single
        // user on the legacy "debridstreamer" DB (no swap), NEVER reject before
        // setHydrated(true) and strand an existing user on a permanent spinner.
        try {
          const bootstrap = loadSettings();
          const defaultProfile = await ensureDefaultProfile({
            name: bootstrap.userName,
            avatar: bootstrap.userAvatar,
          });
          const activeId = (await getActiveProfileId()) ?? defaultProfile.id;
          const active = (await getProfile(activeId)) ?? defaultProfile;
          if (!active.isDefault) await swapLocalProfileStore(dbNameForProfile(active));
          const [registryProfiles, enabled] = await Promise.all([
            listProfiles(),
            isMultiUserEnabled(),
          ]);
          if (cancelled) return;
          setActiveProfile(active);
          setProfiles(registryProfiles);
          setMultiUserEnabledState(enabled);
        } catch {
          // Registry unavailable: stay on the already-open default DB and fall
          // through to hydration so the app still opens on the user's data.
          if (cancelled) return;
        }
      }
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
      setNetworkMode(refreshedSettings.networkMode);
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
    const [loadedSettings, wl, hist, cw, cached] = await Promise.all([
      loadSettingsFromStore(),
      loadWatchlist(),
      loadHistory(),
      loadContinueWatching(),
      store.listCachedResolutions(),
    ]);
    setNetworkMode(loadedSettings.networkMode);
    setSettings(loadedSettings);
    setWatchlist(wl);
    setHistory(hist);
    setContinueWatching(cw);
    const map: Record<string, CachedResolutionRecord> = {};
    for (const row of cached) map[row.mediaId] = row;
    setCachedResolutions(map);
    // Settings update changes serviceConfigKey, so useMemo rebuilds clients for
    // the newly selected Local Mode profile without a separate service reset.
  }, []);

  const refreshProfiles = useCallback(async () => {
    if (isServerMode()) return;
    const [nextProfiles, enabled, activeId] = await Promise.all([
      listProfiles(),
      isMultiUserEnabled(),
      getActiveProfileId(),
    ]);
    setProfiles(nextProfiles);
    setMultiUserEnabledState(enabled);
    setActiveProfile(nextProfiles.find((profile) => profile.id === activeId) ?? null);
  }, []);

  const switchLocalProfile = useCallback(async (
    id: string,
    password?: string,
  ): Promise<{ ok: boolean; reason?: "bad-password" | "not-found" }> => {
    if (isServerMode()) return { ok: false, reason: "not-found" };
    const profile = await getProfile(id);
    if (profile == null) return { ok: false, reason: "not-found" };
    if (profile.passwordHash != null) {
      const valid = await verifyPassword(password ?? "", profile.passwordHash);
      if (!valid) return { ok: false, reason: "bad-password" };
      unlockedProfileIds.add(id);
    }
    // Fail safe across the swap: the target profile's own mode is unknown until
    // reloadProfileData loads its settings, and getStore() now points at the new
    // profile's DB. Clamp to the most restrictive mode so a scheduler tick in
    // that sub-second window cannot make a call the target profile would block.
    setNetworkMode("offline");
    await swapLocalProfileStore(dbNameForProfile(profile));
    await setActiveProfileId(id);
    await updateProfileRecord(id, { lastUsedAt: Date.now() });
    await reloadProfileData(); // sets the target profile's real networkMode
    await refreshProfiles();
    return { ok: true };
  }, [refreshProfiles, reloadProfileData]);

  // Most settings are presentation or playback preferences. Rebuilding every
  // API client for those changes also used to restart the app-wide download
  // runtime, because the context handed App a fresh `services.debrid` path.
  // Build only when an input consumed by buildServices changes; settings still
  // update normally for consumers that actually use the changed preference.
  const serviceConfigKey = JSON.stringify({
    tmdbKey: settings.tmdbKey,
    omdbKey: settings.omdbKey,
    debridTokens: settings.debridTokens,
    sources: settings.sources,
    builtInIndexersEnabled: settings.builtInIndexersEnabled,
    aiProvider: settings.aiProvider,
    aiApiKey: settings.aiApiKey,
    aiModel: settings.aiModel,
    ollamaEndpoint: settings.ollamaEndpoint,
    openSubtitlesApiKey: settings.openSubtitlesApiKey,
  });
  const services = useMemo(
    () => buildServices(settings),
    [serviceConfigKey],
  );

  const openBrowse = useCallback((ctx: BrowseContext) => {
    setBrowseContext(ctx);
  }, []);

  const closeBrowse = useCallback(() => setBrowseContext(null), []);

  const refreshCachedResolutions = useCallback(async () => {
    try {
      const mediaIds = watchlistRef.current.map((item) => item.id);
      const rows = await getStore().getCachedResolutions(mediaIds);
      setCachedResolutions((prev) => {
        // The 30s badge poll reads only current watchlist ids. Replacing the map
        // with a fresh object each tick changes the context value's identity and
        // re-renders every useAppStore() consumer. Bail out unless a resolution
        // changed, comparing scalar identity fields because stream is rebuilt.
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

  const refreshContinueWatching = useCallback(async () => {
    // The webview player's final progress report is emitted during unmount.
    // Drain all writes visible at this session boundary before reading the
    // updated slice, including one added while an earlier write is settling.
    while (pendingResumeWritesRef.current.size > 0) {
      await Promise.all([...pendingResumeWritesRef.current]);
    }
    setContinueWatching(await loadContinueWatching());
  }, []);

  // Load the history slices only when a screen requests them. In particular,
  // durable progress ticks must not deserialize the full history table and
  // rebuild the provider context every few seconds while a player is open.
  const navigate = useCallback((next: ScreenId) => {
    setBrowseContext(null);
    setDetailItem(null);
    setRoute(next);
    if (next === "history") void refreshHistory();
  }, [refreshHistory]);

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

  const openDetail = useCallback((item: MediaPreview) => {
    setDetailItem(item);
    // Recording a view also feeds the History screen (zero-progress entry;
    // a real resume position is written later from the player).
    // `recordHistory` already reads the refreshed history list back, so adopt
    // ITS result rather than calling refreshHistory(): that re-read history a
    // second time AND ran the unbounded continueWatching scan on every title
    // open. Continue Watching cannot change here anyway - a viewed-only record
    // preserves the existing progress fields, so the resumable set is
    // identical; only its lastWatched order could shift, and the playback-close
    // refresh plus the History route refresh already cover that.
    void recordHistory(item).then(setHistory);
  }, []);

  const closeDetail = useCallback(() => setDetailItem(null), []);

  const playLocalFile = useCallback((path: string, title: string) => {
    // Preserve the filesystem path exactly as supplied. mpv receives this raw
    // value through the native player bridge; converting it to a webview asset
    // URL would make it unusable by libmpv.
    if (path.length === 0) return;
    setLocalFilePlayer({ path, title });
  }, []);

  const closeLocalFilePlayer = useCallback(() => setLocalFilePlayer(null), []);

  const search = useCallback((query: string) => {
    const q = query.trim();
    if (q.length === 0) return;
    setPendingSearch(q);
    setRoute("search");
  }, []);

  const consumePendingSearch = useCallback(() => setPendingSearch(null), []);

  const updateSettings = useCallback((next: AppSettings): Promise<SaveResult> => {
    // Optimistically update in-memory (and rebuild services only when their
    // config changes), then persist to the durable Store. Persisting can reject
    // if a keychain write fails closed (desktop); the in-memory value stays
    // usable for the session.
    //
    // The outcome is REPORTED rather than thrown: most callers fire-and-forget
    // (instant-apply appearance controls, the profile menu), so a rejecting
    // promise would surface as an unhandled rejection. Resolving to {ok} lets
    // "Save changes" avoid claiming a save that didn't happen, while leaving
    // every existing caller safe to ignore the result.
    setNetworkMode(next.networkMode);
    setSettings(next);
    return saveSettingsToStore(next, { previous: settingsRef.current }).then(
      () => ({ ok: true as const }),
      (err: unknown) => {
        // eslint-disable-next-line no-console
        console.error("Failed to persist settings:", err);
        return { ok: false as const };
      },
    );
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
      // `recordHistory()` is intentionally convenient for interactive history
      // mutations because it reads the refreshed list back. Playback progress
      // is different: doing that every five seconds deserializes all history
      // rows and changes the provider context for the entire app. The storage
      // upsert already preserves omitted player prefs, so persist directly and
      // refresh once at the playback-session boundary or when History opens.
      const write = getStore()
        .recordHistory({
          mediaId: item.id,
          episodeId: episodeId ?? null,
          progressSeconds,
          durationSeconds,
          completed,
          preview: item,
          preferredAudioId: prefs?.preferredAudioId,
          preferredAudioLang: prefs?.preferredAudioLang,
          preferredSubId: prefs?.preferredSubId,
          playbackSpeed: prefs?.playbackSpeed,
        })
        .catch(() => {
          // Progress persistence is best effort. The next tick and final close
          // report can retry without interrupting playback.
        });
      pendingResumeWritesRef.current.add(write);
      void write.finally(() => pendingResumeWritesRef.current.delete(write));
    },
    [],
  );

  // Effective experience tier. Server Mode is authoritative from the profile
  // session (default Advanced when the session hasn't loaded yet); Local Mode uses
  // the AppSettings flag.
  const serverSession = useServerSession();
  const simpleMode = isServerMode()
    ? (serverSession?.simpleMode ?? false)
    : settings.simpleMode;

  // Every command below is useCallback-stable and getServices reads a ref, so
  // this provider value stays identical after mount. It lets memoized shell
  // controls avoid unrelated AppStore context fan-out without making services
  // stale inside an event handler.
  const actionsValue: AppActions = useMemo(
    () => ({
      getServices: () => servicesRef.current,
      navigate,
      openDetail,
      closeDetail,
      openBrowse,
      closeBrowse,
      search,
      consumePendingSearch,
      updateSettings,
      refreshContinueWatching,
      refreshCachedResolutions,
      toggleWatchlist,
      removeFromWatchlist,
      importToWatchlist,
      reloadProfileData,
      refreshProfiles,
      switchLocalProfile,
      recordResume,
    }),
    [
      navigate,
      openDetail,
      closeDetail,
      openBrowse,
      closeBrowse,
      search,
      consumePendingSearch,
      updateSettings,
      refreshContinueWatching,
      refreshCachedResolutions,
      toggleWatchlist,
      removeFromWatchlist,
      importToWatchlist,
      reloadProfileData,
      refreshProfiles,
      switchLocalProfile,
      recordResume,
    ],
  );

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
      localFilePlayer,
      playLocalFile,
      closeLocalFilePlayer,
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
      refreshContinueWatching,
      cachedResolutions,
      refreshCachedResolutions,
      toggleWatchlist,
      removeFromWatchlist,
      importToWatchlist,
      reloadProfileData,
      activeProfile,
      profiles,
      multiUserEnabled,
      refreshProfiles,
      switchLocalProfile,
      recordResume,
    }),
    [
      route,
      navigate,
      detailItem,
      openDetail,
      closeDetail,
      localFilePlayer,
      playLocalFile,
      closeLocalFilePlayer,
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
      refreshContinueWatching,
      cachedResolutions,
      refreshCachedResolutions,
      toggleWatchlist,
      removeFromWatchlist,
      importToWatchlist,
      reloadProfileData,
      activeProfile,
      profiles,
      multiUserEnabled,
      refreshProfiles,
      switchLocalProfile,
      recordResume,
    ],
  );

  return (
    <AppActionsContext.Provider value={actionsValue}>
      <AppStoreContext.Provider value={value}>
        {children}
      </AppStoreContext.Provider>
    </AppActionsContext.Provider>
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

/** Access stable commands without subscribing to mutable app state. */
export function useAppActions(): AppActions {
  const actions = useContext(AppActionsContext);
  if (actions == null) {
    throw new Error("useAppActions must be used within an <AppStoreProvider>");
  }
  return actions;
}

/** Convenience hook for the effective Simple/Advanced experience tier. */
export function useSimpleMode(): boolean {
  return useAppStore().simpleMode;
}
