// UpdateBanner — the in-app auto-update prompt.
//
// Mounted once from App.tsx. On mount it runs the launch-time update check
// (checkForUpdates), which is a no-op in a plain browser (isTauri-gated inside
// updater.ts) — so in the browser this component renders nothing and has no
// effect. Under the desktop Tauri shell, when a newer signed release is
// available it slides a small non-blocking glass toast in from the bottom-right
// ("Update vX.Y available — Install"). Installing downloads + applies the update
// (showing a determinate progress bar, or an indeterminate one when the server
// didn't send a content length) and then relaunches the app. Failures surface a
// dismissible "Update failed" state; the user can dismiss at any point.

import { useEffect, useState } from "react";
import { checkForUpdates, type PendingUpdate } from "../lib/updater";
import { Icon } from "./Icon";
import "./UpdateBanner.css";

type Phase = "idle" | "installing" | "error";

export function UpdateBanner() {
  const [update, setUpdate] = useState<PendingUpdate | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  /** 0..1 install fraction, or null for an indeterminate (unknown-size) bar. */
  const [progress, setProgress] = useState<number | null>(0);
  const [dismissed, setDismissed] = useState(false);

  // Run the check once on launch. No-op (resolves null) in the browser.
  useEffect(() => {
    let cancelled = false;
    void checkForUpdates().then((u) => {
      if (!cancelled) setUpdate(u);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (update == null || dismissed) return null;

  async function install() {
    if (update == null) return;
    setPhase("installing");
    setProgress(0);
    try {
      // On success the app relaunches and this never resolves.
      await update.install((fraction) => setProgress(fraction));
    } catch {
      setPhase("error");
    }
  }

  const installing = phase === "installing";
  const errored = phase === "error";
  // A determinate bar when we have a fraction; otherwise an indeterminate sweep.
  const pct =
    progress != null ? Math.round(Math.min(1, Math.max(0, progress)) * 100) : null;

  return (
    <div
      className="update-banner glass-raised glass-lit"
      role="status"
      aria-live="polite"
    >
      <div className="update-banner-icon">
        <Icon name={errored ? "info" : "sparkles"} size={18} className="t-accent" />
      </div>

      <div className="update-banner-body">
        {errored ? (
          <>
            <span className="update-banner-title">Update failed</span>
            <span className="update-banner-sub t-secondary">
              Couldn't install v{update.version}. Try again later.
            </span>
          </>
        ) : installing ? (
          <>
            <span className="update-banner-title">
              {pct != null ? `Installing… ${pct}%` : "Installing…"}
            </span>
            <div
              className={`update-banner-progress${pct == null ? " is-indeterminate" : ""}`}
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={pct ?? undefined}
            >
              <div
                className="update-banner-progress-fill"
                style={pct != null ? { width: `${pct}%` } : undefined}
              />
            </div>
          </>
        ) : (
          <>
            <span className="update-banner-title">
              Update v{update.version} available
            </span>
            <span className="update-banner-sub t-secondary">
              A new version of DebridStreamer is ready to install.
            </span>
          </>
        )}
      </div>

      <div className="update-banner-actions">
        {errored ? (
          <button
            type="button"
            className="btn btn-prominent update-banner-install"
            onClick={() => void install()}
          >
            Retry
          </button>
        ) : (
          !installing && (
            <button
              type="button"
              className="btn btn-prominent update-banner-install"
              onClick={() => void install()}
            >
              Install
            </button>
          )
        )}

        {!installing && (
          <button
            type="button"
            className="update-banner-dismiss"
            onClick={() => setDismissed(true)}
            aria-label="Dismiss update notification"
            title="Dismiss"
          >
            <Icon name="xmark" size={15} />
          </button>
        )}
      </div>
    </div>
  );
}
