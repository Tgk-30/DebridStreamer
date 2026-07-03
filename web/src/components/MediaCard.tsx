// Premium poster card: a 2:3 poster that lifts + scales on hover (spring) and
// reveals a cinematic info layer (title, year·rating, quick Play/Info) sliding up
// from a gradient scrim — the "expand-on-hover" feel of Netflix/Apple TV+, done
// in place (no neighbor-overlap clipping). Poster fades in on load with a shimmer
// placeholder. Motion via `motion`.

import { memo, useCallback, useState } from "react";
import { motion } from "motion/react";
import { MediaPreview as MediaPreviewNS } from "../models/media";
import type { MediaPreview } from "../models/media";
import { Icon } from "./Icon";
import "./MediaCard.css";

interface MediaCardProps {
  item: MediaPreview;
  onSelect?: (item: MediaPreview) => void;
  /** Quick-play affordance (optional) — falls back to onSelect. */
  onPlay?: (item: MediaPreview) => void;
  /** Green "Ready to play" badge (a cached resolution exists). */
  ready?: boolean;
  /** Resume progress as a fraction 0..1 — renders a bottom "Continue Watching"
   * progress bar on the poster. Omit (or 0) to hide it. */
  progress?: number;
  /** Small glass chip in the poster corner (e.g. "S2 E5" on a series' Continue
   * Watching card). Rendered only when present. */
  cornerLabel?: string;
}

// Animation objects are hoisted to module scope so they're referentially stable
// across every card render — motion never re-reconciles them, and they don't add
// per-render allocation on grids of 100+ cards.
const SPRING = { type: "spring", stiffness: 380, damping: 30, mass: 0.7 } as const;
const WHILE_TAP = { scale: 0.98 } as const;
const CARD_VARIANTS = {
  rest: { y: 0, scale: 1 },
  hover: { y: -10, scale: 1.05 },
} as const;
const IMG_TRANSITION = { duration: 0.5, ease: [0.16, 1, 0.3, 1] } as const;
const REVEAL_VARIANTS = { rest: { opacity: 0 }, hover: { opacity: 1 } } as const;
const REVEAL_TRANSITION = { duration: 0.25, ease: "easeOut" } as const;
const REVEAL_INNER_VARIANTS = {
  rest: { y: 10, opacity: 0 },
  hover: { y: 0, opacity: 1 },
} as const;
const REVEAL_INNER_TRANSITION = { duration: 0.3, ease: [0.16, 1, 0.3, 1] } as const;

// memo: a grid re-render (filter/scroll/parent state) shouldn't re-run 100+ cards
// whose props are unchanged.
export const MediaCard = memo(function MediaCard({
  item,
  onSelect,
  onPlay,
  ready = false,
  progress,
  cornerLabel,
}: MediaCardProps) {
  const poster = MediaPreviewNS.posterURL(item);
  const rating = MediaPreviewNS.ratingString(item);
  const [loaded, setLoaded] = useState(false);

  // Stable handlers so the memo above isn't defeated by a fresh closure each render.
  const handleSelect = useCallback(() => onSelect?.(item), [onSelect, item]);
  const handlePlay = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      (onPlay ?? onSelect)?.(item);
    },
    [onPlay, onSelect, item],
  );

  return (
    <motion.button
      type="button"
      className="media-card"
      onClick={handleSelect}
      title={item.title}
      aria-label={item.title}
      initial={false}
      whileHover="hover"
      whileFocus="hover"
      whileTap={WHILE_TAP}
      animate="rest"
      variants={CARD_VARIANTS}
      transition={SPRING}
    >
      <div className="media-card-poster">
        {poster ? (
          <motion.img
            ref={(el) => {
              // Already-cached posters can be `complete` before React attaches
              // onLoad (which it never replays for a cached image), leaving the
              // poster stuck at opacity 0 under a permanent shimmer. Reconcile
              // synchronously on mount/commit.
              if (el?.complete && el.naturalWidth > 0) setLoaded(true);
            }}
            src={poster}
            alt={item.title}
            loading="lazy"
            draggable={false}
            initial={{ opacity: 0, scale: 1.04 }}
            animate={loaded ? { opacity: 1, scale: 1 } : { opacity: 0 }}
            transition={IMG_TRANSITION}
            onLoad={() => setLoaded(true)}
            onError={() => setLoaded(true)}
          />
        ) : (
          <div className="media-card-placeholder">
            <Icon name="discover" size={28} />
          </div>
        )}
        {!loaded && poster && <div className="media-card-shimmer" aria-hidden />}

        {ready && (
          <span className="media-card-ready" title="Ready to play">
            <Icon name="play" size={10} />
            Ready
          </span>
        )}

        {cornerLabel != null && (
          <span className="media-card-corner-label">{cornerLabel}</span>
        )}

        {/* Cinematic reveal layer — fades/slides in on hover. */}
        <motion.div
          className="media-card-reveal"
          variants={REVEAL_VARIANTS}
          transition={REVEAL_TRANSITION}
        >
          <motion.div
            className="media-card-reveal-inner"
            variants={REVEAL_INNER_VARIANTS}
            transition={REVEAL_INNER_TRANSITION}
          >
            <div className="media-card-reveal-title">{item.title}</div>
            <div className="media-card-reveal-meta">
              {item.year != null && <span>{item.year}</span>}
              {rating !== "" && (
                <span className="media-card-reveal-rating">
                  <Icon name="star" size={10} className="t-warning" />
                  {rating}
                </span>
              )}
            </div>
            {/* Decorative hover affordances. The whole card is already a
                keyboard-accessible button (opens Detail); these duplicate that
                action visually for mouse users, so they're aria-hidden rather
                than exposed as separate (and un-nestable) interactive controls. */}
            <div className="media-card-reveal-actions" aria-hidden="true">
              <span className="media-card-play" onClick={handlePlay}>
                <Icon name="play" size={13} />
              </span>
              <span className="media-card-more">
                <Icon name="info" size={13} />
              </span>
            </div>
          </motion.div>
        </motion.div>

        {progress != null && progress > 0 && (
          <div className="media-card-progress" aria-hidden>
            <div
              className="media-card-progress-fill"
              style={{ width: `${Math.min(Math.max(progress, 0), 1) * 100}%` }}
            />
          </div>
        )}
      </div>

      <div className="media-card-title">{item.title}</div>
      <div className="media-card-meta">
        <span className="media-card-year">{item.year ?? ""}</span>
        {rating !== "" && (
          <span className="media-card-rating">
            <Icon name="star" size={11} className="t-warning" />
            {rating}
          </span>
        )}
      </div>
    </motion.button>
  );
});
