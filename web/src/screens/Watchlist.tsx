// Watchlist screen — backed by the storage port (Dexie/IndexedDB).
//
// Shows the saved titles as a MediaCard grid that opens Detail; each card can be
// removed from the watchlist. Persistence is the durable Store (works in browser
// + Tauri webview); Trakt/IMDb sync is the documented follow-up.

import { useAppStore } from "../store/AppStore";
import { MediaCard } from "../components/MediaCard";
import { EmptyState } from "../components/EmptyState";
import { Icon } from "../components/Icon";
import "./LibraryScreens.css";

export function Watchlist() {
  const { watchlist, openDetail, removeFromWatchlist, cachedResolutions } =
    useAppStore();

  const readyCount = watchlist.filter(
    (i) => cachedResolutions[i.id] != null,
  ).length;

  return (
    <div className="lib-screen">
      <h1 className="lib-h1">Watchlist</h1>
      <p className="lib-sub t-secondary">
        Titles you've saved to watch later.
        {readyCount > 0 &&
          ` ${readyCount} ready to play instantly.`}
      </p>

      {watchlist.length === 0 ? (
        <EmptyState
          icon="watchlist"
          title="Your watchlist is empty"
          subtitle="Open a title and tap Watchlist to save it here."
          note="Saved on device · Trakt/IMDb sync is the next step"
        />
      ) : (
        <div className="lib-grid-wrap">
          {watchlist.map((item) => (
            <div className="lib-removable" key={item.id}>
              <MediaCard
                item={item}
                onSelect={openDetail}
                ready={cachedResolutions[item.id] != null}
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
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
