// Library screen — backed by the storage port.
//
// Reads the durable library (the `favorites` list-type entries) and the folder
// list from the Store. A folder strip filters the grid; "All saved" shows every
// favorites entry, and selecting a folder shows that folder's entries. The
// watchlist is also surfaced as a convenient stand-in section. Real folder
// management (create/rename/move) is minimal here — the Store supports it and
// Settings/Detail drive the writes — but the structure is live, not mocked.

import { useEffect, useState } from "react";
import { useAppStore } from "../store/AppStore";
import { MediaGrid } from "../components/MediaGrid";
import { EmptyState } from "../components/EmptyState";
import { getStore } from "../storage";
import type { LibraryEntryRecord, LibraryFolderRecord } from "../storage/models";
import type { MediaPreview } from "../models/media";
import "./LibraryScreens.css";

const ALL = "__all__";

export function Library() {
  const { watchlist, openDetail } = useAppStore();
  const [folders, setFolders] = useState<LibraryFolderRecord[]>([]);
  const [entries, setEntries] = useState<LibraryEntryRecord[]>([]);
  const [selectedFolder, setSelectedFolder] = useState<string>(ALL);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const store = getStore();
        await store.ensureSystemFolders();
        const [folderList, favEntries] = await Promise.all([
          store.listFolders("favorites"),
          store.listLibrary("favorites"),
        ]);
        if (cancelled) return;
        setFolders(folderList);
        setEntries(favEntries);
        setError(null);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const visible: MediaPreview[] =
    selectedFolder === ALL
      ? entries.map((e) => e.preview)
      : entries
          .filter((e) => e.folderId === selectedFolder)
          .map((e) => e.preview);

  // Fall back to surfacing the watchlist when the library proper is empty, so
  // the grid isn't hollow for a fresh user.
  const items = visible.length > 0 ? visible : watchlist;
  const showingWatchlistFallback = visible.length === 0 && watchlist.length > 0;

  return (
    <div className="lib-screen">
      <h1 className="lib-h1">Library</h1>
      <p className="lib-sub t-secondary">
        Your collections and saved titles.
      </p>

      <div className="lib-folders">
        <button
          type="button"
          className={`lib-folder-chip chip${selectedFolder === ALL ? " is-active" : ""}`}
          onClick={() => setSelectedFolder(ALL)}
        >
          All saved
        </button>
        {folders
          .filter((f) => f.folderKind !== "system_root")
          .map((f) => (
            <button
              key={f.id}
              type="button"
              className={`lib-folder-chip chip${selectedFolder === f.id ? " is-active" : ""}`}
              onClick={() => setSelectedFolder(f.id)}
            >
              {f.name}
            </button>
          ))}
      </div>

      {loading ? (
        <p className="t-secondary">Loading your library…</p>
      ) : error ? (
        <EmptyState
          icon="library"
          title="Couldn't load your library"
          subtitle="Something went wrong reading your saved titles from this device. Try reopening the app."
          note={error}
        />
      ) : items.length === 0 ? (
        <EmptyState
          icon="library"
          title="Your library is empty"
          subtitle="Saved titles and collections live here."
          note="Folders persist on device · Trakt/IMDb sync is the next step"
        />
      ) : (
        <>
          {showingWatchlistFallback && (
            <p className="lib-sub t-secondary">
              Showing your watchlist — add favorites to build your library.
            </p>
          )}
          <MediaGrid items={items} onSelect={openDetail} />
        </>
      )}
    </div>
  );
}
