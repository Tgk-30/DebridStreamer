// SetupNudge — the "get started" card shown (Local Mode only) while the app
// isn't ready to stream yet: no debrid service, or no active source. The
// primary action re-runs the guided first-run wizard — the clear onboarding
// path even when the original first-run flags were consumed long ago (webview
// storage survives app updates) — and the secondary opens the welcome tour.
// The card vanishes on its own once setup is complete; dismissal is remembered
// so it never nags.

import { Icon } from "./Icon";
import "./SetupNudge.css";

export function SetupNudge({
  onStartWizard,
  onShowTour,
  onDismiss,
}: {
  onStartWizard: () => void;
  onShowTour: () => void;
  onDismiss: () => void;
}) {
  return (
    <div className="setup-nudge glass-hero glass-lit" role="status">
      <span className="setup-nudge-icon" aria-hidden>
        <Icon name="play" size={16} />
      </span>
      <div className="setup-nudge-text">
        <strong>Let&apos;s get you streaming</strong>
        <span className="t-secondary">
          A two-minute guided setup: pick how you&apos;ll use the app, then add
          the two things streaming needs — a debrid service and a source.
        </span>
      </div>
      <div className="setup-nudge-actions">
        <button
          type="button"
          className="btn btn-prominent setup-nudge-cta"
          onClick={onStartWizard}
        >
          Start guided setup
        </button>
        <button type="button" className="btn" onClick={onShowTour}>
          Show me around
        </button>
      </div>
      <button
        type="button"
        className="setup-nudge-dismiss"
        onClick={onDismiss}
        aria-label="Dismiss setup reminder"
      >
        <Icon name="xmark" size={16} />
      </button>
    </div>
  );
}
