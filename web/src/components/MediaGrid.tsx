// MediaGrid - a responsive grid of MediaCards. Used by Search, Watchlist,
// History, and Library. Renders an optional empty state when there are no items.

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { MediaPreview } from "../models/media";
import { MediaCard } from "./MediaCard";
import "./MediaGrid.css";

interface MediaGridProps {
  items: MediaPreview[];
  onSelect?: (item: MediaPreview) => void;
  empty?: React.ReactNode;
  /** Optional resume-progress fractions (0..1) keyed by media id - renders a
   * "Continue Watching" bar on matching cards. Omit to show no bars. */
  progress?: Record<string, number>;
}

export function MediaGrid({ items, onSelect, empty, progress }: MediaGridProps) {
  if (items.length === 0) {
    return empty ? <>{empty}</> : null;
  }
  return (
    <VirtualMediaGrid
      items={items}
      renderItem={(item) => (
        <MediaCard
          item={item}
          onSelect={onSelect}
          progress={progress?.[item.id]}
        />
      )}
    />
  );
}

/** A media id alone is not a React identity: TMDB movie and TV namespaces
 * overlap. Keep the persisted id unchanged and qualify UI keys by type. */
export function mediaKey(item: Pick<MediaPreview, "id" | "type">): string {
  return `${item.type}-${item.id}`;
}

interface VirtualMediaGridProps<T extends Pick<MediaPreview, "id" | "type">> {
  items: T[];
  renderItem: (item: T) => React.ReactNode;
  className?: string;
  /** A grid row is poster height plus title/meta. It is measured after mount. */
  estimatedRowHeight?: number;
}

/**
 * A small, dependency-free virtual grid. It retains a few nearby rows and uses
 * spacer blocks for the remainder, preventing long browse/library lists from
 * retaining hundreds of MediaCards. It listens in capture phase so it works for
 * both the window and Browse's fixed scroll container.
 */
export function VirtualMediaGrid<T extends Pick<MediaPreview, "id" | "type">>({
  items,
  renderItem,
  className,
  estimatedRowHeight = 330,
}: VirtualMediaGridProps<T>) {
  const shellRef = useRef<HTMLDivElement | null>(null);
  const gridRef = useRef<HTMLDivElement | null>(null);
  const frameRef = useRef<number | null>(null);
  const itemsLengthRef = useRef(items.length);
  const rowHeightRef = useRef(estimatedRowHeight);
  const [columns, setColumns] = useState(1);
  const [rowHeight, setRowHeight] = useState(estimatedRowHeight);
  const [rowGap, setRowGap] = useState(0);
  const [windowRows, setWindowRows] = useState({ start: 0, end: 6 });
  itemsLengthRef.current = items.length;

  const measureGeometry = useCallback(() => {
    frameRef.current = null;
    const grid = gridRef.current;
    const shell = shellRef.current;
    if (grid == null || shell == null) return;

    const styles = getComputedStyle(grid);
    const template = styles.gridTemplateColumns.trim();
    // Computed style expands repeat(auto-fill, ...) into used track sizes.
    const nextColumns = Math.max(1, template.split(/\s+/).filter(Boolean).length);
    setColumns((current) => (current === nextColumns ? current : nextColumns));

    const gap = Number.parseFloat(styles.rowGap) || 0;
    setRowGap((current) => (current === gap ? current : gap));
    const visibleRows = Math.max(1, Math.ceil(grid.children.length / nextColumns));
    const nextRowHeight =
      (grid.getBoundingClientRect().height - gap * (visibleRows - 1)) / visibleRows;
    let measuredRowHeight = rowHeightRef.current;
    if (Number.isFinite(nextRowHeight) && nextRowHeight > 0) {
      measuredRowHeight = nextRowHeight;
      rowHeightRef.current = nextRowHeight;
      setRowHeight((current) =>
        Math.abs(current - nextRowHeight) < 1 ? current : nextRowHeight,
      );
    }

    const pitch = measuredRowHeight + gap;
    const rect = shell.getBoundingClientRect();
    const viewportTop = Math.max(0, -rect.top);
    const viewportBottom = Math.min(rect.height, window.innerHeight - rect.top);
    const start = Math.max(0, Math.floor(viewportTop / pitch) - 3);
    const end = Math.min(
      Math.ceil(itemsLengthRef.current / nextColumns),
      Math.max(start + 1, Math.ceil(Math.max(viewportBottom, 0) / pitch) + 3),
    );
    setWindowRows((current) =>
      current.start === start && current.end === end ? current : { start, end },
    );
  }, []);

  const scheduleGeometry = useCallback(() => {
    if (frameRef.current != null) return;
    frameRef.current = window.requestAnimationFrame(measureGeometry);
  }, [measureGeometry]);

  useLayoutEffect(() => {
    measureGeometry();
  }, [items.length, measureGeometry]);

  useEffect(() => {
    const observer =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(scheduleGeometry);
    if (observer != null && gridRef.current != null) observer.observe(gridRef.current);
    if (observer != null && shellRef.current != null) observer.observe(shellRef.current);
    window.addEventListener("resize", scheduleGeometry);
    document.addEventListener("scroll", scheduleGeometry, true);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", scheduleGeometry);
      document.removeEventListener("scroll", scheduleGeometry, true);
      if (frameRef.current != null) window.cancelAnimationFrame(frameRef.current);
    };
  }, [scheduleGeometry]);

  const totalRows = Math.ceil(items.length / columns);
  const start = Math.min(windowRows.start, totalRows);
  const end = Math.max(start, Math.min(windowRows.end, totalRows));
  const startIndex = start * columns;
  const endIndex = end * columns;
  const pitch = rowHeight + rowGap;

  return (
    <div className="media-grid-virtual" ref={shellRef}>
      <div aria-hidden="true" style={{ height: start * pitch }} />
      <div className={`media-grid${className ? ` ${className}` : ""}`} ref={gridRef}>
        {items.slice(startIndex, endIndex).map((item) => (
          <div className="media-grid-item" key={mediaKey(item)}>
            {renderItem(item)}
          </div>
        ))}
      </div>
      <div aria-hidden="true" style={{ height: Math.max(0, (totalRows - end) * pitch) }} />
    </div>
  );
}
