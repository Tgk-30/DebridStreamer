// Watchlist screen - backed by the storage port (Dexie/IndexedDB).
//
// Shows the saved titles as a MediaCard grid that opens Detail; each card can be
// removed from the watchlist. Persistence is the durable Store (works in browser
// + Tauri webview); Trakt/IMDb sync is the documented follow-up.

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
import "./LibraryScreens.css";
import "./Watchlist.css";

const ALL = "__all__";

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
