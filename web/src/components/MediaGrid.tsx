// MediaGrid — a responsive grid of MediaCards. Used by Search, Watchlist,
// History, and Library. Renders an optional empty state when there are no items.

import type { MediaPreview } from "../models/media";
import { MediaCard } from "./MediaCard";
import "./MediaGrid.css";

interface MediaGridProps {
  items: MediaPreview[];
  onSelect?: (item: MediaPreview) => void;
  empty?: React.ReactNode;
}

export function MediaGrid({ items, onSelect, empty }: MediaGridProps) {
  if (items.length === 0) {
    return empty ? <>{empty}</> : null;
  }
  return (
    <div className="media-grid">
      {items.map((item) => (
        <MediaCard key={item.id} item={item} onSelect={onSelect} />
      ))}
    </div>
  );
}
