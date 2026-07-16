// Watchlist screen - backed by the storage port (Dexie/IndexedDB).
//
// Shows the saved titles as a MediaCard grid that opens Detail; each card can be
// removed from the watchlist. Persistence is the durable Store (works in browser
// + Tauri webview); manual Trakt movie-watchlist pull and push are available
// in Local Mode when the user has connected Trakt in Settings.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAppStore } from "../store/AppStore";
import { MediaCard } from "../components/MediaCard";
import { VirtualMediaGrid } from "../components/MediaGrid";
import { EmptyState } from "../components/EmptyState";
import { Icon } from "../components/Icon";
import { WatchlistImportDialog } from "../components/WatchlistImportDialog";
import { watchProgressMap } from "../storage/models";
import type { WatchlistFolderRecord } from "../storage/models";
import { getStore } from "../storage";
import { isServerMode } from "../lib/serverMode";
import { useWatchedIds } from "../data/useWatchedIds";
import type { MediaItem, MediaPreview } from "../models/media";
import { resolveEntry, type ImportEntry } from "../data/importWatchlist";
import {
  collectTraktWatchlistPushCandidates,
} from "../data/traktWatchlist";
import {
  getValidAccessToken,
  isTraktConnected,
} from "../data/traktConnection";
import { TraktSyncService } from "../services/sync/TraktSyncService";
import type { SyncState, TraktWatchlistItem } from "../services/sync/models";
import type { TMDBService } from "../services/metadata/TMDBService";
import "./LibraryScreens.css";
import "./Watchlist.css";

const ALL = "__all__";

type TraktSummary =
  | {
      kind: "pull";
      added: number;
      skipped: number;
      notFound: number;
    }
  | {
      kind: "push";
      pushed: number;
      skipped: number;
      seriesExcluded: number;
    };

export function shouldShowTraktWatchlistSync(
  connected: boolean,
  serverMode: boolean,
): boolean {
  return connected && !serverMode;
}

function previewFromDetail(item: MediaItem): MediaPreview {
  return {
    id: item.id,
    type: item.type,
    title: item.title,
    year: item.year,
    posterPath: item.posterPath,
    imdbRating: item.imdbRating,
    tmdbId: item.tmdbId,
    backdropPath: item.backdropPath,
  };
}

async function resolveTraktWatchlistItem(
  item: TraktWatchlistItem,
  tmdb: TMDBService,
): Promise<MediaPreview | null> {
  try {
    const tmdbId = await tmdb.findByImdbId(item.imdbID, "movie");
    if (tmdbId != null) {
      return previewFromDetail(await tmdb.getDetail(`tmdb-${tmdbId}`, "movie"));
    }
  } catch {
    // Fall through to a title/year search if IMDb reconciliation was unavailable.
  }

  const entry: ImportEntry = {
    title: item.title,
    year: item.year,
    type: "movie",
  };
  return resolveEntry(entry, async (query, type) => (await tmdb.search(query, type)).items);
}

export function Watchlist() {
  // Folders are a Local-Mode feature: every folder write on RemoteStore throws
  // ("not available in Server Mode yet") and listWatchlistFolders returns [].
  // Offering the controls there only ever produced a developer-facing error and
  // discarded whatever the user typed.
  const serverMode = isServerMode();
  const {
    watchlist,
    openDetail,
    removeFromWatchlist,
    cachedResolutions,
    continueWatching,
    openBrowse,
    navigate,
    services,
    settings,
    importToWatchlist,
  } = useAppStore();
  const [importing, setImporting] = useState(false);
  const [folders, setFolders] = useState<WatchlistFolderRecord[]>([]);
  const [folderIds, setFolderIds] = useState<Record<string, string | null>>({});
  const [selectedFolder, setSelectedFolder] = useState(ALL);
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [renaming, setRenaming] = useState(false);
  const [renameName, setRenameName] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [organizationError, setOrganizationError] = useState<string | null>(null);
  const [traktConnected, setTraktConnected] = useState(false);
  const [traktSyncState, setTraktSyncState] = useState<SyncState>("idle");
  const [traktProgress, setTraktProgress] = useState<{ done: number; total: number } | null>(null);
  const [traktSummary, setTraktSummary] = useState<TraktSummary | null>(null);
  const [traktError, setTraktError] = useState<string | null>(null);
  const traktService = useMemo(() => new TraktSyncService(), []);

  useEffect(() => {
    let active = true;
    if (serverMode) {
      setTraktConnected(false);
      return () => {
        active = false;
      };
    }
    void isTraktConnected()
      .then((connected) => {
        if (active) setTraktConnected(connected);
      })
      .catch(() => {
        if (active) setTraktConnected(false);
      });
    return () => {
      active = false;
    };
  }, [serverMode]);

  const reloadOrganization = useCallback(async () => {
    const store = getStore();
    const [folderRows, watchlistRows] = await Promise.all([
      store.listWatchlistFolders(),
      store.listWatchlist(),
    ]);
    setFolders(folderRows);
    setFolderIds(
      Object.fromEntries(watchlistRows.map((row) => [row.mediaId, row.folderId ?? null])),
    );
    setSelectedFolder((current) =>
      current === ALL || folderRows.some((folder) => folder.id === current) ? current : ALL,
    );
  }, []);

  useEffect(() => {
    void reloadOrganization().catch((err) => {
      setOrganizationError(err instanceof Error ? err.message : String(err));
    });
  }, [reloadOrganization, watchlist]);

  async function runOrganizationWrite(work: () => Promise<void>) {
    setBusy(true);
    try {
      await work();
      await reloadOrganization();
      setOrganizationError(null);
    } catch (err) {
      setOrganizationError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function createFolder() {
    const name = newFolderName.trim();
    if (name.length === 0) return;
    await runOrganizationWrite(async () => {
      const folder = await getStore().createWatchlistFolder(name);
      setSelectedFolder(folder.id);
    });
    setNewFolderName("");
    setCreating(false);
  }

  const selectedFolderRecord = folders.find((folder) => folder.id === selectedFolder);

  async function renameFolder() {
    if (selectedFolderRecord == null || renameName.trim().length === 0) return;
    await runOrganizationWrite(() =>
      getStore().renameWatchlistFolder(selectedFolderRecord.id, renameName.trim()),
    );
    setRenaming(false);
  }

  async function deleteFolder() {
    if (selectedFolderRecord == null) return;
    await runOrganizationWrite(() => getStore().deleteWatchlistFolder(selectedFolderRecord.id));
    setSelectedFolder(ALL);
    setConfirmDelete(false);
  }

  async function accessToken(): Promise<string | null> {
    const clientId = settings.traktClientId.trim();
    const clientSecret = settings.traktClientSecret.trim();
    if (clientId.length === 0 || clientSecret.length === 0) {
      throw new Error("Add your Trakt Client ID and Secret in Settings before syncing.");
    }
    const token = await getValidAccessToken(traktService, clientId, clientSecret);
    if (token == null) {
      setTraktConnected(false);
      throw new Error("Trakt is not connected. Open Settings to connect Trakt.");
    }
    return token;
  }

  async function pullFromTrakt() {
    if (services.tmdb == null) {
      setTraktSyncState("failed");
      setTraktError("Add a TMDB API key in Settings to match Trakt movies.");
      return;
    }
    setTraktSyncState("running");
    setTraktError(null);
    setTraktSummary(null);
    setTraktProgress(null);
    try {
      const token = await accessToken();
      if (token == null) return;
      const remoteItems = await traktService.fetchWatchlist(
        settings.traktClientId.trim(),
        token,
      );
      const resolved: MediaPreview[] = [];
      let notFound = 0;
      setTraktProgress({ done: 0, total: remoteItems.length });
      for (let index = 0; index < remoteItems.length; index += 1) {
        let match: MediaPreview | null = null;
        try {
          match = await resolveTraktWatchlistItem(remoteItems[index]!, services.tmdb);
        } catch {
          match = null;
        }
        if (match != null) resolved.push(match);
        else notFound += 1;
        setTraktProgress({ done: index + 1, total: remoteItems.length });
      }
      const { added, skipped } = await importToWatchlist(resolved);
      setTraktSummary({ kind: "pull", added, skipped, notFound });
      setTraktSyncState("success");
      void reloadOrganization().catch((organizationError) => {
        setOrganizationError(
          organizationError instanceof Error
            ? organizationError.message
            : String(organizationError),
        );
      });
    } catch (error) {
      setTraktSyncState("failed");
      setTraktError(error instanceof Error ? error.message : String(error));
    } finally {
      setTraktProgress(null);
    }
  }

  async function pushToTrakt() {
    if (services.tmdb == null) {
      setTraktSyncState("failed");
      setTraktError("Add a TMDB API key in Settings to reconcile movie IDs.");
      return;
    }
    setTraktSyncState("running");
    setTraktError(null);
    setTraktSummary(null);
    setTraktProgress(null);
    try {
      const token = await accessToken();
      if (token == null) return;
      const candidates = await collectTraktWatchlistPushCandidates(watchlist, services.tmdb);
      await traktService.pushWatchlist(
        settings.traktClientId.trim(),
        token,
        candidates.imdbIDs,
      );
      setTraktSummary({
        kind: "push",
        pushed: candidates.imdbIDs.length,
        skipped: candidates.skipped,
        seriesExcluded: candidates.seriesExcluded,
      });
      setTraktSyncState("success");
    } catch (error) {
      setTraktSyncState("failed");
      setTraktError(error instanceof Error ? error.message : String(error));
    }
  }

  const visibleWatchlist = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    return watchlist.filter((item) => {
      if (selectedFolder !== ALL && folderIds[item.id] !== selectedFolder) return false;
      return normalized.length === 0 || item.title.toLocaleLowerCase().includes(normalized);
    });
  }, [folderIds, query, selectedFolder, watchlist]);

  const readyCount = watchlist.filter(
    (i) => cachedResolutions[i.id] != null,
  ).length;
  // Show a resume bar on any watchlisted title that's already in progress.
  const progress = watchProgressMap(continueWatching);
  // A single batched history lookup drives the "watched" check badge (finished
  // titles aren't in the resume list, so this reads them from full history).
  const watchedIds = useWatchedIds(continueWatching);

  return (
    <div className="lib-screen">
      <div className="lib-head-row">
        <div>
          <h1 className="lib-h1">Watchlist</h1>
          <p className="lib-sub t-secondary">
            Titles you've saved to watch later.
            {readyCount > 0 && ` ${readyCount} ready to play instantly.`}
          </p>
        </div>
        <div className="watchlist-head-actions">
          {shouldShowTraktWatchlistSync(traktConnected, serverMode) && (
            <div className="watchlist-sync-actions" aria-label="Trakt movie watchlist sync">
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => void pullFromTrakt()}
                disabled={traktSyncState === "running"}
              >
                {traktSyncState === "running" && traktProgress != null
                  ? `Pulling ${traktProgress.done}/${traktProgress.total}…`
                  : "Pull from Trakt"}
              </button>
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => void pushToTrakt()}
                disabled={traktSyncState === "running"}
              >
                {traktSyncState === "running" && traktProgress == null
                  ? "Syncing…"
                  : "Push to Trakt"}
              </button>
            </div>
          )}
          {watchlist.length > 0 && (
            <button
              type="button"
              className="btn lib-import-btn"
              onClick={() => setImporting(true)}
            >
              <Icon name="upload" size={15} />
              Import
            </button>
          )}
        </div>
      </div>

      {shouldShowTraktWatchlistSync(traktConnected, serverMode) && (
        <p className="watchlist-sync-note t-secondary">
          Trakt syncs the movie watchlist only. Series are excluded.
        </p>
      )}
      {traktSummary != null && (
        <p className="watchlist-sync-status" aria-live="polite">
          {traktSummary.kind === "pull"
            ? `Pulled from Trakt: added ${traktSummary.added}, skipped ${traktSummary.skipped} already saved${traktSummary.notFound > 0 ? `, ${traktSummary.notFound} could not be matched` : ""}.`
            : `Pushed ${traktSummary.pushed}, skipped ${traktSummary.skipped} (no IMDb id), ${traktSummary.seriesExcluded} series excluded.`}
        </p>
      )}
      {traktError != null && (
        <p className="watchlist-sync-error" role="alert">
          {traktError}
        </p>
      )}

      {importing && (
        <WatchlistImportDialog
          onClose={() => setImporting(false)}
          onImported={() => void reloadOrganization()}
          watchlist={watchlist}
        />
      )}

      {watchlist.length === 0 ? (
        <EmptyState
          icon="watchlist"
          title="Your watchlist is empty"
          subtitle="Open any title and tap Watchlist to keep it ready for later."
          note="Stored on this device"
          ambient="cinema"
          actions={
            <>
              <button
                type="button"
                className="btn btn-prominent"
                onClick={() =>
                  openBrowse({ kind: "category", type: "movie", category: "trending" })
                }
              >
                Browse trending
              </button>
              <button type="button" className="btn" onClick={() => navigate("search")}>
                Search catalog
              </button>
              <button type="button" className="btn" onClick={() => setImporting(true)}>
                <Icon name="upload" size={15} />
                Import list
              </button>
            </>
          }
        />
      ) : (
        <>
          {!serverMode && (
          <div className="watchlist-folder-bar" aria-label="Watchlist folders">
            <button
              type="button"
              className={`chip lib-folder-chip${selectedFolder === ALL ? " is-active" : ""}`}
              onClick={() => setSelectedFolder(ALL)}
              aria-pressed={selectedFolder === ALL}
            >
              All
            </button>
            {folders.map((folder) => (
              <button
                type="button"
                key={folder.id}
                className={`chip lib-folder-chip${selectedFolder === folder.id ? " is-active" : ""}`}
                onClick={() => setSelectedFolder(folder.id)}
                aria-pressed={selectedFolder === folder.id}
              >
                {folder.name}
              </button>
            ))}
            {creating ? (
              <span className="lib-folder-new">
                <input
                  className="lib-folder-input"
                  value={newFolderName}
                  onChange={(event) => setNewFolderName(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") void createFolder();
                    if (event.key === "Escape") setCreating(false);
                  }}
                  aria-label="New watchlist folder name"
                  autoFocus
                />
                <button type="button" className="btn btn-sm" disabled={busy} onClick={() => void createFolder()}>
                  Save
                </button>
                <button type="button" className="btn btn-sm" onClick={() => setCreating(false)}>
                  Cancel
                </button>
              </span>
            ) : (
              <button type="button" className="chip lib-folder-chip lib-folder-add" onClick={() => setCreating(true)}>
                + New folder
              </button>
            )}
          </div>
          )}

          <div className="watchlist-tools">
            <label className="watchlist-search">
              <Icon name="search" size={15} className="t-secondary" />
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={selectedFolderRecord == null ? "Search watchlist" : `Search ${selectedFolderRecord.name}`}
                aria-label="Search watchlist"
              />
            </label>
            {selectedFolderRecord != null && !renaming && !confirmDelete && (
              <>
                <button type="button" className="btn btn-sm" onClick={() => {
                  setRenameName(selectedFolderRecord.name);
                  setRenaming(true);
                }}>
                  Rename folder
                </button>
                <button type="button" className="btn btn-sm btn-danger-ghost" onClick={() => setConfirmDelete(true)}>
                  Delete folder
                </button>
              </>
            )}
            {renaming && selectedFolderRecord != null && (
              <span className="lib-folder-new">
                <input
                  className="lib-folder-input"
                  value={renameName}
                  onChange={(event) => setRenameName(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") void renameFolder();
                    if (event.key === "Escape") setRenaming(false);
                  }}
                  aria-label="Rename watchlist folder"
                  autoFocus
                />
                <button type="button" className="btn btn-sm" disabled={busy} onClick={() => void renameFolder()}>
                  Save
                </button>
                <button type="button" className="btn btn-sm" onClick={() => setRenaming(false)}>
                  Cancel
                </button>
              </span>
            )}
            {confirmDelete && selectedFolderRecord != null && (
              <span className="watchlist-delete-confirm">
                Move titles to All?
                <button type="button" className="btn btn-sm btn-danger" disabled={busy} onClick={() => void deleteFolder()}>
                  Delete
                </button>
                <button type="button" className="btn btn-sm" onClick={() => setConfirmDelete(false)}>
                  Cancel
                </button>
              </span>
            )}
          </div>

          {organizationError != null && <p className="watchlist-organization-error">{organizationError}</p>}

          {visibleWatchlist.length === 0 ? (
            <p className="watchlist-filter-empty t-secondary">
              No titles match this folder and search.
            </p>
          ) : (
            <VirtualMediaGrid
              items={visibleWatchlist}
              className="lib-grid-wrap watchlist-grid-wrap"
              renderItem={(item) => (
                <div className="lib-removable watchlist-removable">
                  <MediaCard
                    item={item}
                    onSelect={openDetail}
                    ready={cachedResolutions[item.id] != null}
                    progress={progress[item.id]}
                    watched={watchedIds.has(item.id)}
                  />
                  <button
                    type="button"
                    className="lib-remove"
                    onClick={() => removeFromWatchlist(item.id)}
                    aria-label={`Remove ${item.title} from watchlist`}
                    title="Remove"
                  >
                    <Icon name="xmark" size={15} />
                  </button>
                  {!serverMode && (
                  <label className="watchlist-card-folder">
                    <span className="sr-only">Move {item.title} to folder</span>
                    <select
                      value={folderIds[item.id] ?? ""}
                      disabled={busy}
                      onChange={(event) => void runOrganizationWrite(() =>
                        getStore().assignWatchlistFolder(item.id, event.target.value || null),
                      )}
                      aria-label={`Move ${item.title} to folder`}
                    >
                      <option value="">All</option>
                      {folders.map((folder) => <option key={folder.id} value={folder.id}>{folder.name}</option>)}
                    </select>
                  </label>
                  )}
                </div>
              )}
            />
          )}
        </>
      )}
    </div>
  );
}
