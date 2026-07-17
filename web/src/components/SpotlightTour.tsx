// A point-and-highlight product tour. Each step targets a real on-screen element
// (by a stable `[data-tour="id"]` anchor), dims the rest of the UI with a cutout
// "spotlight" around it, and floats a tooltip beside it with Back / Next / Skip.
// Purely presentational + self-contained: it measures targets live (re-measuring
// on scroll/resize) and centers itself gracefully if a target isn't on screen.

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import "./SpotlightTour.css";

export interface TourStep {
  /** CSS selector for the element to spotlight (e.g. `[data-screen="search"]`).
   *  The tour centers its tooltip if the selector matches nothing on screen. */
  target: string;
  title: string;
  body: string;
  /** Preferred tooltip side relative to the target; auto-flips to stay on screen. */
  placement?: "top" | "bottom" | "left" | "right";
}

interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

const PAD = 8; // spotlight padding around the target
const GAP = 14; // tooltip distance from the target
const TOOLTIP_W = 320;

function targetEl(selector: string): HTMLElement | null {
  try {
    return document.querySelector<HTMLElement>(selector);
  } catch {
    return null; // malformed selector → treat as no-target (centered tooltip)
  }
}

function measure(selector: string): Rect | null {
  const el = targetEl(selector);
  if (el == null) return null;
  const r = el.getBoundingClientRect();
  if (r.width === 0 && r.height === 0) return null;
  return { top: r.top, left: r.left, width: r.width, height: r.height };
}

export function SpotlightTour({
  steps,
  onDone,
}: {
  steps: TourStep[];
  onDone: () => void;
}) {
  const [i, setI] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);
  const [vp, setVp] = useState(() => ({ w: window.innerWidth, h: window.innerHeight }));
  const step = steps[i];
  const isLast = i === steps.length - 1;

  // Measure synchronously after each DOM commit (the nav targets are already in
  // the tree), then re-measure on scroll/resize and once more after the
  // smooth-scroll settles. useLayoutEffect avoids a flash of the centered
  // fallback before the spotlight lands.
  useLayoutEffect(() => {
    if (step == null) return;
    const el = targetEl(step.target);
    el?.scrollIntoView?.({ block: "center", inline: "nearest", behavior: "smooth" });
    const sync = () => {
      setRect(measure(step.target));
      setVp({ w: window.innerWidth, h: window.innerHeight });
    };
    sync();
    const t = window.setTimeout(sync, 340);
    window.addEventListener("resize", sync);
    window.addEventListener("scroll", sync, true);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener("resize", sync);
      window.removeEventListener("scroll", sync, true);
    };
  }, [step]);

  const next = useCallback(() => {
    if (isLast) onDone();
    else setI((n) => Math.min(n + 1, steps.length - 1));
  }, [isLast, onDone, steps.length]);
  const back = useCallback(() => setI((n) => Math.max(n - 1, 0)), []);

  // Keyboard: → next, ← back, Esc skip. (Enter is NOT hijacked, so it activates
  // whichever tour button - Back/Next/Skip - the user has focused.)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onDone();
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        next();
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        back();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [next, back, onDone]);

  // Tooltip position: place beside the target on the side with the most room,
  // clamped to the viewport. Centered when there's no target.
  const tip = useMemo(() => {
    // Fit the tooltip on tiny viewports (never wider than the screen minus gutters).
    const w = Math.min(TOOLTIP_W, vp.w - 32);
    if (rect == null) {
      return { left: vp.w / 2 - w / 2, top: vp.h / 2 - 90, width: w, arrow: "none" as const };
    }
    // Which sides actually have room. `placement` is a PREFERENCE - used only if
    // that side fits, else we flip to the first side that does.
    const fits = {
      right: vp.w - (rect.left + rect.width) >= w + GAP + 8,
      left: rect.left >= w + GAP + 8,
      bottom: vp.h - (rect.top + rect.height) >= 200,
      top: rect.top >= 200,
    };
    const order: Array<"right" | "left" | "bottom" | "top"> =
      step?.placement != null
        ? [step.placement, "right", "left", "bottom", "top"].filter(
            (s, idx, a) => a.indexOf(s) === idx,
          ) as Array<"right" | "left" | "bottom" | "top">
        : ["right", "left", "bottom", "top"];
    const side = order.find((s) => fits[s]) ?? "bottom";
    let left: number;
    let top: number;
    if (side === "right") {
      left = rect.left + rect.width + GAP;
      top = rect.top + rect.height / 2 - 70;
    } else if (side === "left") {
      left = rect.left - w - GAP;
      top = rect.top + rect.height / 2 - 70;
    } else if (side === "top") {
      left = rect.left + rect.width / 2 - w / 2;
      top = rect.top - GAP - 168;
    } else {
      left = rect.left + rect.width / 2 - w / 2;
      top = rect.top + rect.height + GAP;
    }
    left = Math.max(16, Math.min(left, vp.w - w - 16));
    top = Math.max(16, Math.min(top, vp.h - 200));
    return { left, top, width: w, arrow: side };
  }, [rect, vp, step]);

  // Focus the tooltip so keyboard nav works immediately.
  const tipRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    tipRef.current?.focus();
  }, [i]);

  if (step == null) return null;

  return (
    <div className="tour" role="dialog" aria-modal="true" aria-label="App tour">
      {/* Dim + cutout. A transparent hole box casts a huge shadow over the rest. */}
      {rect != null ? (
        <div
          className="tour-cutout"
          style={{
            top: rect.top - PAD,
            left: rect.left - PAD,
            width: rect.width + PAD * 2,
            height: rect.height + PAD * 2,
          }}
        />
      ) : (
        <div className="tour-scrim" onClick={onDone} />
      )}

      <div
        ref={tipRef}
        className={`tour-tip tour-arrow-${tip.arrow}`}
        style={{ left: tip.left, top: tip.top, width: tip.width }}
        tabIndex={-1}
        onKeyDown={(e) => {
          // Trap Tab within the tooltip so focus can't wander to the (inert,
          // dimmed) app behind the modal tour.
          if (e.key !== "Tab") return;
          const f = tipRef.current?.querySelectorAll<HTMLElement>("button");
          if (f == null || f.length === 0) return;
          const first = f[0];
          const last = f[f.length - 1];
          const active = document.activeElement;
          if (e.shiftKey && (active === first || active === tipRef.current)) {
            e.preventDefault();
            last.focus();
          } else if (!e.shiftKey && active === last) {
            e.preventDefault();
            first.focus();
          }
        }}
      >
        <div className="tour-step-count">
          Step {i + 1} of {steps.length}
        </div>
        <h3 className="tour-title">{step.title}</h3>
        <p className="tour-body">{step.body}</p>
        <div className="tour-actions">
          <button type="button" className="tour-skip" onClick={onDone}>
            Skip tour
          </button>
          <div className="tour-nav">
            {i > 0 && (
              <button type="button" className="tour-back" onClick={back}>
                Back
              </button>
            )}
            <button type="button" className="tour-next" onClick={next}>
              {isLast ? "Done" : "Next"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
