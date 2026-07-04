// The numeric rating controls for Detail — 1–10 pips or a 0–100 slider. The
// thumbs option lives in the hero; this renders when the user's chosen scale
// (Settings → Appearance) is "ten" or "hundred". `value` is the user's current
// saved rating on that scale (null = not rated yet); `onRate` persists a pick.

import { useEffect, useRef, useState } from "react";
import "./RatingControl.css";

// A single five-pointed star path, filled via `currentColor`.
const STAR_PATH =
  "M12 2l2.9 6.26 6.6.62-4.9 4.42 1.42 6.68L12 17.9 5.98 20l1.42-6.68L2.5 8.88l6.6-.62L12 2z";

export function RatingControl({
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
  return (
    <section className="rating-control" aria-label="Your rating">
      <div className="rating-control-head">
        <span className="rating-control-label">Your rating</span>
        {value != null && onClear != null && (
          <button type="button" className="rating-clear" onClick={onClear}>
            Clear
          </button>
        )}
      </div>
      {scale === "ten" ? (
        <TenScale value={value} onRate={onRate} />
      ) : (
        <HundredScale value={value} onRate={onRate} />
      )}
    </section>
  );
}

function TenScale({
  value,
  onRate,
}: {
  value: number | null;
  onRate: (value: number) => void;
}) {
  // A single-choice rating → radiogroup semantics: exactly one pip is "checked",
  // and arrow/Home/End keys move the choice (roving tabindex keeps one stop).
  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    const cur = value ?? 0;
    let next = cur;
    switch (e.key) {
      case "ArrowRight":
      case "ArrowUp":
        next = Math.min(10, cur + 1 || 1);
        break;
      case "ArrowLeft":
      case "ArrowDown":
        next = Math.max(1, (cur || 1) - 1);
        break;
      case "Home":
        next = 1;
        break;
      case "End":
        next = 10;
        break;
      default:
        return;
    }
    e.preventDefault();
    if (next !== cur) onRate(next);
  }

  // Hovering previews the score you'd give; leaving reverts to the saved value.
  const [hover, setHover] = useState<number | null>(null);
  const shown = hover ?? value ?? 0;

  return (
    <div
      className="rating-stars"
      role="radiogroup"
      aria-label="Rate out of 10"
      onKeyDown={onKeyDown}
      onMouseLeave={() => setHover(null)}
    >
      {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => {
        const checked = value === n;
        // One tab stop: the selected star, or star 1 when nothing is chosen yet.
        const tabbable = checked || (value == null && n === 1);
        const filled = n <= shown;
        const previewing = hover != null && n <= hover;
        return (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={checked}
            aria-label={`${n} out of 10`}
            tabIndex={tabbable ? 0 : -1}
            className={
              "rating-star" +
              (filled ? " is-on" : "") +
              (previewing ? " is-preview" : "")
            }
            onClick={() => onRate(n)}
            onMouseEnter={() => setHover(n)}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d={STAR_PATH} />
            </svg>
          </button>
        );
      })}
      <span className="rating-readout" aria-hidden="true">
        {shown > 0 ? `${shown}/10` : ""}
      </span>
    </div>
  );
}

function HundredScale({
  value,
  onRate,
}: {
  value: number | null;
  onRate: (value: number) => void;
}) {
  // Track the drag locally; commit to storage only on release so a drag doesn't
  // write a taste event per pixel. `dirty` guards against committing an unchanged
  // value (e.g. a Tab keyup or a release with no move) or re-persisting on blur.
  const [draft, setDraft] = useState(value ?? 50);
  const dirty = useRef(false);
  // Resync when the saved value changes OR clears — falling back to 50 so an
  // unrated title never shows (or commits) the previous title's slider position.
  useEffect(() => {
    setDraft(value ?? 50);
    dirty.current = false;
  }, [value]);
  const commit = () => {
    if (!dirty.current) return;
    dirty.current = false;
    onRate(draft);
  };

  return (
    <div className="rating-hundred">
      <input
        type="range"
        min={0}
        max={100}
        value={draft}
        onChange={(e) => {
          dirty.current = true;
          setDraft(Number(e.target.value));
        }}
        onPointerUp={commit}
        onKeyUp={commit}
        onBlur={commit}
        aria-label="Rate out of 100"
        aria-valuetext={`${draft} out of 100`}
        style={{ ["--fill" as string]: `${draft}%` }}
      />
      <span className="rating-readout rating-readout-lg">{draft}/100</span>
    </div>
  );
}
