// RatingReveal - collapses the always-visible RatingControl behind an explicit
// "Rate" button on the Detail screen. Closed, it shows "Rate" (unrated) or the
// current score ("Your rating: 8/10", still clickable to change); clicking it
// reveals the existing RatingControl inline and moves focus into it so the
// keyboard quick-rating (number keys / arrows) keeps working on reveal.
//
// A thin wrapper: it does not change RatingControl's internals or storage format.

import { useRef, useState } from "react";
import { RatingControl } from "./RatingControl";
import { Icon } from "./Icon";

export function RatingReveal({
  scale,
  value,
  onRate,
  onClear,
}: {
  scale: "ten" | "hundred";
  value: number | null;
  onRate: (value: number) => void;
  onClear?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const max = scale === "hundred" ? 100 : 10;

  function reveal() {
    setOpen(true);
    // Move focus into the control so keyboard quick-rating works immediately on
    // reveal. Deferred a frame so the RatingControl has mounted first.
    requestAnimationFrame(() => {
      wrapRef.current
        ?.querySelector<HTMLElement>(
          '[role="radio"][tabindex="0"], input[type="range"]',
        )
        ?.focus();
    });
  }

  if (open) {
    return (
      <div className="detail-rate" ref={wrapRef}>
        <RatingControl
          scale={scale}
          value={value}
          onRate={onRate}
          onClear={onClear}
        />
      </div>
    );
  }

  return (
    <div className="detail-rate">
      <button
        type="button"
        className="chip detail-rate-btn"
        onClick={reveal}
        aria-expanded={false}
      >
        <Icon name="star" size={14} className="t-warning" />
        {value != null ? `Your rating: ${value}/${max}` : "Rate"}
      </button>
    </div>
  );
}
