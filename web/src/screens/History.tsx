// History screen — backed by the storage port.
//
// Shows a "Continue Watching" rail (incomplete titles with a real resume
// position, read from watch history) followed by the full recently-watched grid
// (recorded whenever a Detail opens or playback records progress). Selecting a
// card re-opens Detail. Persistence is the durable Store (IndexedDB via Dexie),
// so resume positions survive reloads.

import { useAppStore } from "../store/AppStore";
import { MediaGrid } from "../components/MediaGrid";
import { Rail } from "../components/Rail";
import { EmptyState } from "../components/EmptyState";
import { hasResumePoint } from "../storage/models";

export function History() {
  const { history, continueWatching, openDetail, openBrowse, navigate } =
    useAppStore();

  // Only surface rows with a meaningful resume point in the rail.
  const resumable = continueWatching
    .filter(hasResumePoint)
    .map((r) => r.preview);

  return (
    <div className="lib-screen">
      <h1 className="lib-h1">History</h1>
      <p className="lib-sub t-secondary">Titles you've recently opened.</p>

      {resumable.length > 0 && (
        <Rail title="Continue Watching" items={resumable} onSelect={openDetail} />
      )}

      {history.length === 0 ? (
        <EmptyState
          icon="history"
          title="Nothing here yet"
          subtitle="Open a title and it'll show up here so you can jump back in."
          note="Resume positions stay local"
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
            </>
          }
        />
      ) : (
        <MediaGrid items={history} onSelect={openDetail} />
      )}
    </div>
  );
}
