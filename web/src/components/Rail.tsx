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
}

export function Rail({ title, items, onSelect }: RailProps) {
  if (items.length === 0) return null;

  return (
    <section className="rail">
      <h2 className="rail-title">{title}</h2>
      <div className="rail-scroll rail-fade">
        <div className="rail-track">
          {items.map((item) => (
            <MediaCard key={item.id} item={item} onSelect={onSelect} />
          ))}
        </div>
      </div>
    </section>
  );
}
