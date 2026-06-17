// Library screen — structural this phase.
//
// The native Library is folder/collection-organised and backed by GRDB; that
// storage layer isn't ported yet, so this is a structural shell: a header, a
// (currently empty) folder strip, and a clear empty state noting what's blocked.
// As a useful stand-in it surfaces the locally-saved watchlist so the grid isn't
// hollow. Real folders/collections arrive with the storage port.

import { useAppStore } from "../store/AppStore";
import { MediaGrid } from "../components/MediaGrid";
import { EmptyState } from "../components/EmptyState";
import "./LibraryScreens.css";

export function Library() {
  const { watchlist, openDetail } = useAppStore();

  return (
    <div className="lib-screen">
      <h1 className="lib-h1">Library</h1>
      <p className="lib-sub t-secondary">
        Your collections and saved titles.
      </p>

      <div className="lib-folders">
        <div className="lib-folder-chip chip">All saved</div>
        <div className="lib-folder-chip chip lib-folder-disabled">
          Folders (storage port)
        </div>
      </div>

      {watchlist.length === 0 ? (
        <EmptyState
          icon="library"
          title="Your library is empty"
          subtitle="Saved titles and synced collections will live here."
          note="Folders + Trakt/IMDb sync pending the storage port"
        />
      ) : (
        <MediaGrid items={watchlist} onSelect={openDetail} />
      )}
    </div>
  );
}
