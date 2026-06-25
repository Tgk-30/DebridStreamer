// MediaGrid — a responsive grid of MediaCards. Used by Search, Watchlist,
// History, and Library. Renders an optional empty state when there are no items.

import type { MediaPreview } from "../models/media";
import { MediaCard } from "./MediaCard";
import "./MediaGrid.css";

interface MediaGridProps {
  items: MediaPreview[];
  onSelect?: (item: MediaPreview) => void;
  empty?: React.ReactNode;
  /** Optional resume-progress fractions (0..1) keyed by media id — renders a
   * "Continue Watching" bar on matching cards. Omit to show no bars. */
  progress?: Record<string, number>;
}

export function MediaGrid({ items, onSelect, empty, progress }: MediaGridProps) {
  if (items.length === 0) {
    return empty ? <>{empty}</> : null;
  }
  return (
    <div className="media-grid">
      {items.map((item) => (
        <MediaCard
          key={item.id}
          item={item}
          onSelect={onSelect}
          progress={progress?.[item.id]}
        />
      ))}
    </div>
  );
}
