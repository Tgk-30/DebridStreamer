// Cinematic billboard hero: auto-rotates through a few featured titles with a
// crossfade + slow Ken Burns zoom on the backdrop, a layered scrim for legibility,
// large title, badges, Play/Details, and bar indicators. Pauses on hover. Falls
// back to a single item. Motion via `motion` + AnimatePresence.

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { MediaPreview as MediaPreviewNS } from "../models/media";
import type { MediaPreview } from "../models/media";
import { Icon } from "./Icon";
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
  const active = list[Math.min(index, list.length - 1)];

  useEffect(() => {
    if (list.length <= 1 || paused) return;
    const t = setInterval(() => setIndex((i) => (i + 1) % list.length), intervalMs);
    return () => clearInterval(t);
  }, [list.length, paused, intervalMs]);

  if (!active) return null;
  const backdrop = MediaPreviewNS.backdropURL(active);
  const rating = MediaPreviewNS.ratingString(active);

  return (
    <div
      className="hero"
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
            <img className="hero-backdrop" src={backdrop} alt="" draggable={false} />
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
