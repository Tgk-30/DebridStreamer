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
import { WatchStatsCard } from "../components/WatchStatsCard";
import { hasResumePoint, watchProgressMap } from "../storage/models";
import { useWatchStats } from "../data/useWatchStats";
import { hasWatchStats } from "../data/watchStats";

export function History() {
  const { history, continueWatching, openDetail, openBrowse, navigate, settings } =
    useAppStore();

  // Opt-in insights card (off by default). Re-aggregates when the history size
  // changes so it stays current after a watch is recorded.
  const stats = useWatchStats(settings.showWatchStats, history.length);

  // Only surface rows with a meaningful resume point in the rail.
  const resumable = continueWatching.filter(hasResumePoint).map((r) => r.preview);
  // Shared progress map (same helper the Watchlist uses) so the rail, the rail's
  // bars, and the full grid below stay in lockstep instead of diverging.
  const resumableProgress = watchProgressMap(continueWatching);

  return (
    <div className="lib-screen">
      <h1 className="lib-h1">History</h1>
      <p className="lib-sub t-secondary">Titles you've recently opened.</p>

      {settings.showWatchStats && stats != null && hasWatchStats(stats) && (
        <WatchStatsCard stats={stats} />
      )}

      {resumable.length > 0 && (
        <Rail
          title="Continue Watching"
          items={resumable}
          progressById={resumableProgress}
          onSelect={openDetail}
        />
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
        <MediaGrid
          items={history}
          onSelect={openDetail}
          progress={resumableProgress}
        />
      )}
    </div>
  );
}
