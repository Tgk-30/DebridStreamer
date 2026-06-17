// DetailHero — the top of the Detail screen.
//
// Full-bleed backdrop + scrim, then poster + title, a meta row (year · rating ·
// runtime · status), genre chips, the overview, and the primary actions: Play
// (jumps to the stream picker / starts playback) plus a Watchlist toggle. Built
// on the same hero glass tier as the Discover spotlight.

import { MediaItem as MediaItemNS } from "../models/media";
import type { MediaItem } from "../models/media";
import { Icon } from "./Icon";
import "./DetailHero.css";

interface DetailHeroProps {
  item: MediaItem;
  inWatchlist: boolean;
  onPlay: () => void;
  onToggleWatchlist: () => void;
  onClose: () => void;
}

export function DetailHero({
  item,
  inWatchlist,
  onPlay,
  onToggleWatchlist,
  onClose,
}: DetailHeroProps) {
  const backdrop = MediaItemNS.backdropURL(item);
  const poster = MediaItemNS.posterThumbnailURL(item);
  const rating = MediaItemNS.ratingString(item);
  const runtime = MediaItemNS.runtimeString(item);

  return (
    <div className="detail-hero glass-hero">
      {backdrop ? (
        <img className="detail-hero-backdrop" src={backdrop} alt="" draggable={false} />
      ) : (
        <div className="detail-hero-backdrop hero-gradient" />
      )}
      <div className="detail-hero-scrim" />

      <button
        type="button"
        className="detail-hero-close"
        onClick={onClose}
        aria-label="Back"
        title="Back"
      >
        <Icon name="xmark" size={18} />
      </button>

      <div className="detail-hero-content">
        {poster && (
          <img
            className="detail-hero-poster"
            src={poster}
            alt={item.title}
            draggable={false}
          />
        )}

        <div className="detail-hero-info">
          <h1 className="detail-hero-title">{item.title}</h1>

          <div className="detail-hero-meta">
            {item.year != null && <span>{item.year}</span>}
            {rating !== "N/A" && (
              <span className="detail-hero-rating">
                <Icon name="star" size={13} className="t-warning" />
                {rating}
              </span>
            )}
            {runtime && <span>{runtime}</span>}
            {item.status && <span>{item.status}</span>}
          </div>

          {item.genres.length > 0 && (
            <div className="detail-hero-genres">
              {item.genres.slice(0, 4).map((g) => (
                <span key={g} className="detail-genre-chip">
                  {g}
                </span>
              ))}
            </div>
          )}

          {item.overview && (
            <p className="detail-hero-overview">{item.overview}</p>
          )}

          <div className="detail-hero-actions">
            <button type="button" className="btn btn-prominent" onClick={onPlay}>
              <Icon name="play" size={15} />
              Play
            </button>
            <button
              type="button"
              className={`btn${inWatchlist ? " is-on" : ""}`}
              onClick={onToggleWatchlist}
            >
              <Icon name="watchlist" size={15} filled={inWatchlist} />
              {inWatchlist ? "In watchlist" : "Watchlist"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
