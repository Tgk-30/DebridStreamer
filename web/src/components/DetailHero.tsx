// DetailHero — cinematic top of the Detail screen.
//
// Full-bleed backdrop with a slow Ken Burns drift + layered scrim/vignette, then
// poster + large title, a dotted meta row, genre chips, the overview, and the
// primary actions (Play prominent + Watchlist). Content settles in with motion.

import { useState } from "react";
import { motion } from "motion/react";
import { MediaItem as MediaItemNS } from "../models/media";
import type { MediaItem } from "../models/media";
import { Icon } from "./Icon";
import "./DetailHero.css";

/** The user's current like/dislike taste signal for this title (drives the
 *  thumbs control's active state). */
export type TasteSignal = "liked" | "disliked" | null;

interface DetailHeroProps {
  item: MediaItem;
  inWatchlist: boolean;
  onPlay: () => void;
  onToggleWatchlist: () => void;
  onClose: () => void;
  /** Server Mode only — file a title request for this item. Omitted (and the
   *  button hidden) in Local Mode. */
  onRequest?: () => void;
  /** Drives the Request button label/disabled state: idle → "Request",
   *  requesting → busy, requested → "Requested", already → "Already requested". */
  requestState?: "idle" | "requesting" | "requested" | "already";
  /** Current like/dislike signal for this title (null = no signal yet). */
  tasteSignal?: TasteSignal;
  /** Record (or toggle off) a like/dislike taste signal for this title. */
  onTasteSignal?: (signal: "liked" | "disliked") => void;
}

const EASE = [0.16, 1, 0.3, 1] as const;

export function DetailHero({
  item,
  inWatchlist,
  onPlay,
  onToggleWatchlist,
  onClose,
  onRequest,
  requestState = "idle",
  tasteSignal = null,
  onTasteSignal,
}: DetailHeroProps) {
  const backdrop = MediaItemNS.backdropURL(item);
  const [backdropFailed, setBackdropFailed] = useState(false);
  const poster = MediaItemNS.posterThumbnailURL(item);
  const rating = MediaItemNS.ratingString(item);
  const runtime = MediaItemNS.runtimeString(item);

  const metaBits = [
    item.year != null ? String(item.year) : null,
    runtime || null,
    item.status || null,
  ].filter(Boolean) as string[];

  return (
    <div className="detail-hero">
      <motion.div
        className="detail-hero-backdrop-layer"
        initial={{ scale: 1.12 }}
        animate={{ scale: 1.04 }}
        transition={{ duration: 18, ease: "easeOut" }}
      >
        {backdrop && !backdropFailed ? (
          <img
            className="detail-hero-backdrop"
            src={backdrop}
            alt=""
            draggable={false}
            onError={() => setBackdropFailed(true)}
          />
        ) : (
          // No backdrop, or it failed to load → the on-brand gradient instead of
          // a broken-image frame.
          <div className="detail-hero-backdrop hero-gradient" />
        )}
      </motion.div>
      <div className="detail-hero-scrim" />
      <div className="detail-hero-vignette" />

      <button
        type="button"
        className="detail-hero-close"
        onClick={onClose}
        aria-label="Back"
        title="Back"
      >
        <Icon name="xmark" size={17} />
      </button>

      <motion.div
        className="detail-hero-content"
        initial={{ opacity: 0, y: 22 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease: EASE, delay: 0.05 }}
      >
        {poster && (
          <img
            className="detail-hero-poster"
            src={poster}
            alt={item.title}
            draggable={false}
          />
        )}

        <div className="detail-hero-info">
          <h1 className="detail-hero-title">{item.title}</h1>

          <div className="detail-hero-meta">
            {rating !== "N/A" && (
              <span className="detail-hero-rating">
                <Icon name="star" size={13} className="t-warning" />
                {rating}
              </span>
            )}
            {metaBits.map((bit, i) => (
              <span key={bit + i} className="detail-hero-metabit">
                {(rating !== "N/A" || i > 0) && <span className="detail-hero-dot">·</span>}
                {bit}
              </span>
            ))}
          </div>

          {item.genres.length > 0 && (
            <div className="detail-hero-genres">
              {item.genres.slice(0, 4).map((g) => (
                <span key={g} className="detail-genre-chip">
                  {g}
                </span>
              ))}
            </div>
          )}

          {item.overview && <p className="detail-hero-overview">{item.overview}</p>}

          <div className="detail-hero-actions">
            <button type="button" className="btn btn-prominent detail-play" onClick={onPlay}>
              <Icon name="play" size={16} />
              Play
            </button>
            <button
              type="button"
              className={`btn detail-watch${inWatchlist ? " is-on" : ""}`}
              onClick={onToggleWatchlist}
            >
              <Icon name="watchlist" size={16} filled={inWatchlist} />
              {inWatchlist ? "In watchlist" : "Watchlist"}
            </button>
            {onRequest && (
              <button
                type="button"
                className={`btn detail-request${
                  requestState === "requested" || requestState === "already"
                    ? " is-on"
                    : ""
                }`}
                onClick={onRequest}
                disabled={requestState !== "idle"}
                title={
                  requestState === "already"
                    ? "Already requested"
                    : requestState === "requested"
                      ? "Request sent"
                      : "Ask an admin to add this title"
                }
              >
                <Icon
                  name={
                    requestState === "requested" || requestState === "already"
                      ? "check"
                      : "library"
                  }
                  size={16}
                />
                {requestState === "requesting"
                  ? "Requesting…"
                  : requestState === "requested"
                    ? "Requested"
                    : requestState === "already"
                      ? "Already requested"
                      : "Request"}
              </button>
            )}

            {onTasteSignal && (
              <div
                className="detail-taste"
                role="group"
                aria-label="Rate this title for your taste profile"
              >
                <button
                  type="button"
                  className={`detail-taste-btn${tasteSignal === "liked" ? " is-liked" : ""}`}
                  onClick={() => onTasteSignal("liked")}
                  aria-pressed={tasteSignal === "liked"}
                  aria-label="I like this"
                  title="I like this"
                >
                  <Icon name="thumbs-up" size={16} filled={tasteSignal === "liked"} />
                </button>
                <button
                  type="button"
                  className={`detail-taste-btn${tasteSignal === "disliked" ? " is-disliked" : ""}`}
                  onClick={() => onTasteSignal("disliked")}
                  aria-pressed={tasteSignal === "disliked"}
                  aria-label="Not for me"
                  title="Not for me"
                >
                  <Icon
                    name="thumbs-down"
                    size={16}
                    filled={tasteSignal === "disliked"}
                  />
                </button>
              </div>
            )}
          </div>
        </div>
      </motion.div>
    </div>
  );
}
