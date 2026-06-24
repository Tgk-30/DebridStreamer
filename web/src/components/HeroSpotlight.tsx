// Cinematic billboard hero: auto-rotates through a few featured titles with a
// crossfade + slow Ken Burns zoom on the backdrop, a layered scrim for legibility,
// large title, badges, Play/Details, and bar indicators. Pauses on hover. Falls
// back to a single item. Motion via `motion` + AnimatePresence.

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { MediaPreview as MediaPreviewNS } from "../models/media";
import type { MediaPreview } from "../models/media";
import { Icon } from "./Icon";
import { isSmartPreloadEnabled } from "../lib/smartPreload";
import "./HeroSpotlight.css";

interface HeroSpotlightProps {
  /** One or more featured items; rotates when >1. */
  items?: MediaPreview[];
  item?: MediaPreview;
  /** Optional overview for the active item (page supplies when available). */
  overview?: string | null;
  onPlay?: (item: MediaPreview) => void;
  onDetails?: (item: MediaPreview) => void;
  intervalMs?: number;
}

const EASE = [0.16, 1, 0.3, 1] as const;

/**
 * Content-aware accent: sample the backdrop down to a tiny canvas and average
 * the vivid (saturated, mid-luminance) pixels into one dominant RGB. Used to
 * recolor the hero chrome per title (the Apple-TV / Disney+ signature). Returns
 * null when the canvas is tainted (no CORS) or there isn't enough vivid color —
 * the caller then falls back to the global accent.
 */
function extractDominantRGB(img: HTMLImageElement): string | null {
  try {
    const w = 24;
    const h = 14;
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, w, h);
    const { data } = ctx.getImageData(0, 0, w, h);
    let r = 0;
    let g = 0;
    let b = 0;
    let n = 0;
    for (let i = 0; i < data.length; i += 4) {
      const cr = data[i];
      const cg = data[i + 1];
      const cb = data[i + 2];
      const max = Math.max(cr, cg, cb);
      const min = Math.min(cr, cg, cb);
      const sat = max === 0 ? 0 : (max - min) / max;
      const lum = (cr + cg + cb) / 3;
      // Skip near-black, near-white, and washed-out pixels — keep the vivid ones.
      if (lum < 30 || lum > 226 || sat < 0.25) continue;
      r += cr;
      g += cg;
      b += cb;
      n += 1;
    }
    if (n < 6) return null;
    r = Math.round(r / n);
    g = Math.round(g / n);
    b = Math.round(b / n);
    // Lift very dark averages so the glow reads against the dark scrim.
    const lift = Math.max(0, 96 - (r + g + b) / 3);
    return `${Math.min(255, r + lift)}, ${Math.min(255, g + lift)}, ${Math.min(255, b + lift)}`;
  } catch {
    return null; // tainted canvas (no CORS) — fall back to the global accent.
  }
}

export function HeroSpotlight({
  items,
  item,
  overview,
  onPlay,
  onDetails,
  intervalMs = 7000,
}: HeroSpotlightProps) {
  const list = (items && items.length > 0 ? items : item ? [item] : []).slice(0, 6);
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const heroRef = useRef<HTMLDivElement>(null);
  const active = list[Math.min(index, list.length - 1)];
  const backdrop = active ? MediaPreviewNS.backdropURL(active) : null;

  useEffect(() => {
    if (list.length <= 1 || paused) return;
    const t = setInterval(() => setIndex((i) => (i + 1) % list.length), intervalMs);
    return () => clearInterval(t);
  }, [list.length, paused, intervalMs]);

  // Invisible polish: preload the next backdrop so the crossfade never flashes a
  // half-loaded image. Gated by the smart-preload preference. The Image is held
  // and detached on cleanup so an in-flight preload doesn't keep loading (and
  // pinning memory) after the hero unmounts or advances.
  useEffect(() => {
    if (list.length <= 1 || !isSmartPreloadEnabled()) return;
    const url = MediaPreviewNS.backdropURL(list[(index + 1) % list.length]);
    if (!url) return;
    const img = new Image();
    img.src = url;
    return () => {
      img.src = "";
    };
  }, [index, list]);

  // Per-title accent: recolor the hero chrome from the backdrop's dominant color.
  // Uses a separate CORS probe image so the *displayed* backdrop is never at risk
  // (if CORS/extraction fails, the global accent stays).
  useEffect(() => {
    const el = heroRef.current;
    if (el) el.style.removeProperty("--title-accent-rgb");
    if (!backdrop || el == null) return;
    let cancelled = false;
    const probe = new Image();
    probe.crossOrigin = "anonymous";
    probe.onload = () => {
      if (cancelled) return;
      const rgb = extractDominantRGB(probe);
      if (rgb && heroRef.current) heroRef.current.style.setProperty("--title-accent-rgb", rgb);
    };
    probe.src = backdrop;
    return () => {
      cancelled = true;
    };
  }, [backdrop]);

  if (!active) return null;
  const rating = MediaPreviewNS.ratingString(active);

  return (
    <div
      className="hero"
      ref={heroRef}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      {/* Backdrop crossfade + Ken Burns */}
      <AnimatePresence mode="popLayout">
        <motion.div
          key={active.id}
          className="hero-backdrop-layer"
          initial={{ opacity: 0, scale: 1.08 }}
          animate={{ opacity: 1, scale: 1.0 }}
          exit={{ opacity: 0 }}
          transition={{ opacity: { duration: 0.9, ease: "easeInOut" }, scale: { duration: intervalMs / 1000 + 1, ease: "linear" } }}
        >
          {backdrop ? (
            <img
              className="hero-backdrop"
              src={backdrop}
              alt=""
              draggable={false}
              decoding="async"
              /* `fetchpriority` (lowercase) is the LCP resource hint React 18
                 forwards to the DOM without warning; the camelCase `fetchPriority`
                 prop is React 19-only and logs an unknown-prop warning under 18. */
              {...({ fetchpriority: "high" } as Record<string, string>)}
            />
          ) : (
            <div className="hero-backdrop hero-gradient" />
          )}
        </motion.div>
      </AnimatePresence>

      <div className="hero-scrim" />
      <div className="hero-vignette" />

      <AnimatePresence mode="wait">
        <motion.div
          key={active.id}
          className="hero-content"
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.55, ease: EASE }}
        >
          <div className="hero-badges">
            <span className="chip hero-featured">
              Featured
            </span>
            {active.year != null && (
              <>
                <span className="hero-meta-separator" aria-hidden="true" />
                <span className="hero-year">{active.year}</span>
              </>
            )}
            {rating !== "" && (
              <>
                <span className="hero-meta-separator" aria-hidden="true" />
                <span className="hero-rating">
                  <Icon name="star" size={12} className="t-warning" />
                  {rating}
                </span>
              </>
            )}
          </div>

          <h1 className="hero-title">{active.title}</h1>
          {overview && <p className="hero-overview">{overview}</p>}

          <div className="hero-actions">
            <button type="button" className="btn btn-prominent hero-play" onClick={() => onPlay?.(active)}>
              <Icon name="play" size={16} />
              Play
            </button>
            <button type="button" className="btn hero-info" onClick={() => onDetails?.(active)}>
              <Icon name="info" size={16} />
              More info
            </button>
          </div>
        </motion.div>
      </AnimatePresence>

      {list.length > 1 && (
        <div className="hero-dots">
          <span className="hero-dots-label">
            {index + 1}/{list.length}
          </span>
          {list.map((it, i) => (
            <button
              key={it.id}
              type="button"
              className={"hero-dot" + (i === index ? " is-active" : "")}
              aria-label={`Featured ${i + 1}`}
              onClick={() => setIndex(i)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
