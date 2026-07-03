// The numeric rating controls for Detail — 1–10 pips or a 0–100 slider. The
// thumbs option lives in the hero; this renders when the user's chosen scale
// (Settings → Appearance) is "ten" or "hundred". `value` is the user's current
// saved rating on that scale (null = not rated yet); `onRate` persists a pick.

import { useEffect, useRef, useState } from "react";
import "./RatingControl.css";

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

  return (
    <div
      className="rating-ten"
      role="radiogroup"
      aria-label="Rate out of 10"
      onKeyDown={onKeyDown}
    >
      {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => {
        const checked = value === n;
        // One tab stop: the selected pip, or pip 1 when nothing is chosen yet.
        const tabbable = checked || (value == null && n === 1);
        return (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={checked}
            aria-label={`${n} out of 10`}
            tabIndex={tabbable ? 0 : -1}
            className={"rating-pip" + (value != null && n <= value ? " is-on" : "")}
            onClick={() => onRate(n)}
          >
            {n}
          </button>
        );
      })}
      <span className="rating-readout">{value != null ? `${value}/10` : ""}</span>
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
