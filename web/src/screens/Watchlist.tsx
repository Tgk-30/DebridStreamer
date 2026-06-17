// Watchlist screen — localStorage-backed (storage port pending).
//
// Shows the saved titles as a MediaCard grid that opens Detail; each card can be
// removed from the watchlist. Persistence is localStorage this phase; real
// persistence + Trakt/IMDb sync arrive with the storage port.

import { useAppStore } from "../store/AppStore";
import { MediaGrid } from "../components/MediaGrid";
import { EmptyState } from "../components/EmptyState";
import { Icon } from "../components/Icon";
import "./LibraryScreens.css";

export function Watchlist() {
  const { watchlist, openDetail, removeFromWatchlist } = useAppStore();

  return (
    <div className="lib-screen">
      <h1 className="lib-h1">Watchlist</h1>
      <p className="lib-sub t-secondary">
        Titles you've saved to watch later.
      </p>

      {watchlist.length === 0 ? (
        <EmptyState
          icon="watchlist"
          title="Your watchlist is empty"
          subtitle="Open a title and tap Watchlist to save it here."
          note="Stored locally · sync pending the storage port"
        />
      ) : (
        <div className="lib-grid-wrap">
          {watchlist.map((item) => (
            <div className="lib-removable" key={item.id}>
              <MediaGrid items={[item]} onSelect={openDetail} />
              <button
                type="button"
                className="lib-remove"
                onClick={() => removeFromWatchlist(item.id)}
                aria-label={`Remove ${item.title} from watchlist`}
                title="Remove"
              >
                <Icon name="xmark" size={15} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
