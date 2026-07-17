// Spinner / Suspense fallback - a lightweight glass loading indicator.
//
// Used as the <Suspense fallback> while a code-split (React.lazy) screen or
// overlay chunk downloads. `variant="overlay"` fills an overlay surface (Detail /
// Browse), `variant="inline"` (default) centers within the content area.

import "./Spinner.css";

interface SpinnerProps {
  /** Optional label shown under the ring. */
  label?: string;
  variant?: "inline" | "overlay";
}

export function Spinner({ label, variant = "inline" }: SpinnerProps) {
  return (
    <div className={`spinner-wrap spinner-${variant}`} role="status" aria-live="polite">
      <span className="spinner-ring" aria-hidden />
      {label && <span className="spinner-label t-secondary">{label}</span>}
      <span className="sr-only">{label ?? "Loading"}</span>
    </div>
  );
}
