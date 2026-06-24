// A horizontal poster rail: bold title header + a horizontally-scrolling row of
// MediaCards with a trailing-edge fade mask (mirrors DiscoverView.catalogSection
// + railFadeMask). Renders nothing when there are no items.

import type { MediaPreview } from "../models/media";
import { MediaCard } from "./MediaCard";
import "./Rail.css";

interface RailProps {
  title: string;
  items: MediaPreview[];
  onSelect?: (item: MediaPreview) => void;
  /** When provided, render a "See all" affordance in the header that opens the
   * full paginated Browse for this rail's exact category/genre. */
  onSeeAll?: () => void;
  /** Resume progress (0..1) keyed by item id — renders a Continue Watching
   * progress bar on the matching cards. */
  progressById?: Record<string | number, number>;
}

export function Rail({ title, items, onSelect, onSeeAll, progressById }: RailProps) {
  if (items.length === 0) return null;

  return (
    <section className="rail">
      <div className="rail-header">
        <h2 className="rail-title">{title}</h2>
        {onSeeAll && (
          <button type="button" className="rail-see-all" onClick={onSeeAll}>
            See all
            <span className="rail-see-all-arrow" aria-hidden>
              ›
            </span>
          </button>
        )}
      </div>
      <div className="rail-scroll rail-fade">
        <div className="rail-track">
          {items.map((item) => (
            <MediaCard
              key={item.id}
              item={item}
              onSelect={onSelect}
              progress={progressById?.[item.id]}
            />
          ))}
        </div>
      </div>
    </section>
  );
}
