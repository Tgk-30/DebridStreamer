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
  /** Resume progress (0..1) keyed by item id - renders a Continue Watching
   * progress bar on the matching cards. */
  progressById?: Record<string | number, number>;
  /** Optional corner label per item id (e.g. "S2 E5" on a series card). */
  labelById?: Record<string, string>;
  /** Render the Apple TV "Top 10" treatment: a large ghosted rank numeral to the
   * left of each poster (numbered from 1). Items are capped at 10. */
  ranked?: boolean;
  /** Appearance preference passed from the screen's store boundary. */
  showPosterRatings?: boolean;
}

export function Rail({
  title,
  items,
  onSelect,
  onSeeAll,
  progressById,
  labelById,
  ranked,
  showPosterRatings = false,
}: RailProps) {
  if (items.length === 0) return null;
  // Cap only rails that offer a See-all path - capping a rail without one
  // (Library household, History, Detail "More like this") strands content.
  const shown = ranked ? items.slice(0, 10) : onSeeAll ? items.slice(0, 12) : items;

  return (
    <section className={ranked ? "rail rail-ranked" : "rail"}>
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
          {shown.map((item, i) => (
            <MediaCard
              key={item.id}
              item={item}
              onSelect={onSelect}
              progress={progressById?.[item.id]}
              cornerLabel={labelById?.[item.id]}
              rank={ranked ? i + 1 : undefined}
              showPosterRatings={showPosterRatings}
            />
          ))}
        </div>
      </div>
    </section>
  );
}
