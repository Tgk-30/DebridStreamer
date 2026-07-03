// TrailerModal — a full-screen glass overlay that embeds a YouTube trailer.
//
// Uses youtube-nocookie.com (privacy-preserving, no tracking cookie until play)
// in a 16:9 responsive iframe. The desktop app's CSP allowlists that frame host.
// Escape / backdrop-click / the close button all dismiss; focus is moved into
// the dialog on open and restored to the trigger on close (useModalA11y).

import { useModalA11y } from "./useModalA11y";
import { Icon } from "./Icon";
import "./TrailerModal.css";

interface TrailerModalProps {
  /** YouTube video id. */
  videoKey: string;
  title: string;
  onClose: () => void;
}

export function TrailerModal({ videoKey, title, onClose }: TrailerModalProps) {
  const ref = useModalA11y<HTMLDivElement>(onClose);
  // enablejsapi off, modestbranding, rel=0 keeps it clean; autoplay on open.
  const src = `https://www.youtube-nocookie.com/embed/${encodeURIComponent(
    videoKey,
  )}?autoplay=1&rel=0&modestbranding=1`;

  return (
    <div
      className="trailer-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={ref}
        tabIndex={-1}
        className="trailer-dialog glass-raised glass-lit"
        role="dialog"
        aria-modal="true"
        aria-label={`Trailer: ${title}`}
      >
        <div className="trailer-head">
          <span className="trailer-title">{title} — Trailer</span>
          <button
            type="button"
            className="trailer-close"
            onClick={onClose}
            aria-label="Close trailer"
          >
            <Icon name="xmark" size={16} />
          </button>
        </div>
        <div className="trailer-frame">
          <iframe
            src={src}
            title={`${title} trailer`}
            allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
            allowFullScreen
            referrerPolicy="strict-origin-when-cross-origin"
          />
        </div>
      </div>
    </div>
  );
}
