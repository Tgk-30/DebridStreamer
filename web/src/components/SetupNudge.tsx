// SetupNudge — a small, dismissible bottom bar shown (Local Mode only) while the
// app isn't ready to stream yet: no debrid service, or no active source. It's the
// gentle "what's next" after onboarding — one tap to Settings — and it vanishes
// on its own once setup is complete. Dismissal is remembered so it never nags.

import { Icon } from "./Icon";
import "./SetupNudge.css";

export function SetupNudge({
  onOpenSettings,
  onDismiss,
}: {
  onOpenSettings: () => void;
  onDismiss: () => void;
}) {
  return (
    <div className="setup-nudge glass-hero glass-lit" role="status">
      <span className="setup-nudge-icon" aria-hidden>
        <Icon name="play" size={16} />
      </span>
      <div className="setup-nudge-text">
        <strong>Finish setup to start streaming</strong>
        <span className="t-secondary">
          Add a debrid service and a source — then search and play.
        </span>
      </div>
      <button
        type="button"
        className="btn btn-prominent setup-nudge-cta"
        onClick={onOpenSettings}
      >
        Open Settings
      </button>
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
