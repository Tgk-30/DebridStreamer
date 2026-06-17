// History screen — localStorage-backed (storage port pending).
//
// Shows recently-viewed titles (recorded whenever a Detail opens) as a MediaCard
// grid that re-opens Detail. localStorage this phase; resume points + real watch
// history arrive with the storage port.

import { useAppStore } from "../store/AppStore";
import { MediaGrid } from "../components/MediaGrid";
import { EmptyState } from "../components/EmptyState";
import "./LibraryScreens.css";

export function History() {
  const { history, openDetail } = useAppStore();

  return (
    <div className="lib-screen">
      <h1 className="lib-h1">History</h1>
      <p className="lib-sub t-secondary">Titles you've recently opened.</p>

      {history.length === 0 ? (
        <EmptyState
          icon="history"
          title="Nothing here yet"
          subtitle="Open a title and it'll show up here so you can jump back in."
          note="Stored locally · resume points pending the storage port"
        />
      ) : (
        <MediaGrid items={history} onSelect={openDetail} />
      )}
    </div>
  );
}
