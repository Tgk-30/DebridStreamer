// Port of Sources/DebridStreamer/Views/Catalog/HeroSpotlight.swift.
//
// A full-bleed 16:9-ish (380px tall) cinematic spotlight: featured item's
// w1280 backdrop with a bottom-to-top dark scrim, a "Featured" chip + year +
// star rating, the title, an optional 2-line overview, and Play / Details
// actions. Sits on the .hero glass elevation tier with an accent tint.

import { MediaPreview as MediaPreviewNS } from "../models/media";
import type { MediaPreview } from "../models/media";
import { Icon } from "./Icon";
import "./HeroSpotlight.css";

interface HeroSpotlightProps {
  item: MediaPreview;
  /** MediaPreview carries no overview; the page supplies one when it can. */
  overview?: string | null;
  onPlay?: (item: MediaPreview) => void;
  onDetails?: (item: MediaPreview) => void;
}

export function HeroSpotlight({
  item,
  overview,
  onPlay,
  onDetails,
}: HeroSpotlightProps) {
  const backdrop = MediaPreviewNS.backdropURL(item);
  const rating = MediaPreviewNS.ratingString(item);

  return (
    <div className="hero glass-hero">
      {backdrop ? (
        <img className="hero-backdrop" src={backdrop} alt="" draggable={false} />
      ) : (
        <div className="hero-backdrop hero-gradient" />
      )}
      <div className="hero-scrim" />

      <div className="hero-content">
        <div className="hero-badges">
          <span className="chip hero-featured">
            <Icon name="sparkles" size={12} />
            Featured
          </span>
          {item.year != null && <span className="hero-year">{item.year}</span>}
          {rating !== "" && (
            <span className="hero-rating">
              <Icon name="star" size={12} className="t-warning" />
              {rating}
            </span>
          )}
        </div>

        <h1 className="hero-title">{item.title}</h1>

        {overview && <p className="hero-overview">{overview}</p>}

        <div className="hero-actions">
          <button
            type="button"
            className="btn btn-prominent"
            onClick={() => onPlay?.(item)}
          >
            <Icon name="play" size={15} />
            Play
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => onDetails?.(item)}
          >
            <Icon name="info" size={15} />
            Details
          </button>
        </div>
      </div>
    </div>
  );
}
