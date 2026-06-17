// Port of Sources/DebridStreamer/Views/Catalog/MediaCard.swift.
//
// A 158×237 poster (2:3), a 2-line title that always reserves both lines so the
// year/rating row keeps a constant baseline across a rail, then year + star
// rating. Glass card with a hover lift (scale 1.03 + accent glow). Uses the
// read-only MediaPreview.posterURL / ratingString helpers from models/media.

import { MediaPreview as MediaPreviewNS } from "../models/media";
import type { MediaPreview } from "../models/media";
import { Icon } from "./Icon";
import "./MediaCard.css";

interface MediaCardProps {
  item: MediaPreview;
  onSelect?: (item: MediaPreview) => void;
  /** When true, overlay a green "Ready to play" badge (a cached resolution
   * exists for this title — see the watchlist auto-resolve feature). */
  ready?: boolean;
}

export function MediaCard({ item, onSelect, ready = false }: MediaCardProps) {
  const poster = MediaPreviewNS.posterURL(item);
  const rating = MediaPreviewNS.ratingString(item);

  return (
    <button
      type="button"
      className="media-card glass-rest glass-lit"
      onClick={() => onSelect?.(item)}
      title={item.title}
    >
      <div className="media-card-poster">
        {poster ? (
          <img src={poster} alt={item.title} loading="lazy" draggable={false} />
        ) : (
          <div className="media-card-placeholder">
            <Icon name="discover" size={28} />
          </div>
        )}
        {ready && (
          <span className="media-card-ready" title="Ready to play">
            <Icon name="play" size={10} />
            Ready
          </span>
        )}
      </div>

      <div className="media-card-title">{item.title}</div>

      <div className="media-card-meta">
        <span className="media-card-year">{item.year ?? ""}</span>
        {rating !== "" && (
          <span className="media-card-rating">
            <Icon name="star" size={11} className="t-warning" />
            {rating}
          </span>
        )}
      </div>
    </button>
  );
}
