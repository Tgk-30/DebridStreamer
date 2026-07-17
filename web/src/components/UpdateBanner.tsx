// UpdateBanner - the in-app auto-update prompt.
//
// Mounted once from App.tsx. On mount it runs the launch-time update check
// (checkForUpdates), which is a no-op in a plain browser (isTauri-gated inside
// updater.ts) - so in the browser this component renders nothing and has no
// effect. Under the desktop Tauri shell, when a newer signed release is
// available it slides a small non-blocking glass toast in from the bottom-right
// ("Update vX.Y available - Install"). Installing downloads + applies the update
// (showing a determinate progress bar, or an indeterminate one when the server
// didn't send a content length) and then relaunches the app. Failures surface a
// dismissible "Update failed" state; the user can dismiss at any point.

import { useEffect, useRef, useState } from "react";
import {
  checkForUpdates,
  markUpdateChecked,
  updateCheckAgeMs,
  WEEKLY_UPDATE_CHECK_MS,
  type PendingUpdate,
} from "../lib/updater";
import { isNetworkAllowed } from "../lib/networkPolicy";
import type { NetworkMode } from "../lib/networkPolicy";
import { Icon } from "./Icon";
import "./UpdateBanner.css";

type Phase = "idle" | "installing" | "error";

// How often the running app re-evaluates whether a weekly check is due. The
// actual network check is gated on WEEKLY_UPDATE_CHECK_MS having elapsed, so
// this poll interval only bounds how promptly a long-running instance notices
// the week has passed - it does not itself hit the network every 6h.
const UPDATE_POLL_MS = 6 * 60 * 60 * 1000;

export function UpdateBanner({
  autoCheck,
  autoInstall,
  networkMode = "standard",
}: {
  autoCheck: boolean;
  autoInstall: boolean;
  networkMode?: NetworkMode;
}) {
  const [update, setUpdate] = useState<PendingUpdate | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  /** 0..1 install fraction, or null for an indeterminate (unknown-size) bar. */
  const [progress, setProgress] = useState<number | null>(0);

  // The version the user dismissed this session - so the weekly re-check doesn't
  // re-surface the SAME version, but a LATER one still gets through. A ref (not
  // state) so the check closure reads the current value without re-running.
  const dismissedVersionRef = useRef<string | null>(null);
  // True while an update is actively surfaced/installing so the weekly poll
  // doesn't re-check over the top of it. Cleared on dismiss so the poll resumes.
  const pendingRef = useRef(false);

  // Check on launch, then re-check weekly for long-running instances. No-op
  // (resolves null) in the browser.
  useEffect(() => {
    if (!autoCheck || networkMode !== "standard" || !isNetworkAllowed("updates")) return;
    let cancelled = false;

    const runCheck = () => {
      markUpdateChecked();
      void checkForUpdates().then((u) => {
        if (cancelled || u == null) return;
        // Don't re-surface a version the user already dismissed this session; a
        // newer version still gets through (and leaves the poll free to re-check).
        if (u.version === dismissedVersionRef.current) return;
        pendingRef.current = true;
        setUpdate(u);
        if (autoInstall) {
          setPhase("installing");
          setProgress(0);
          void u.install((fraction) => setProgress(fraction)).catch(() => {
            setPhase("error");
          });
        }
      });
    };

    runCheck(); // launch check

    // Weekly cadence: poll periodically but only actually hit the network when
    // the window is visible, nothing is already pending, and a week has elapsed
    // since the last check. Robust to timer drift/suspend - the elapsed-time
    // gate is the real control, not the interval.
    const poll = setInterval(() => {
      if (
        !document.hidden &&
        !pendingRef.current &&
        updateCheckAgeMs() >= WEEKLY_UPDATE_CHECK_MS
      ) {
        runCheck();
      }
    }, UPDATE_POLL_MS);

    return () => {
      cancelled = true;
      clearInterval(poll);
    };
  }, [autoCheck, autoInstall, networkMode]);

  if (update == null) return null;

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
            onClick={() => {
              // Remember this version so the weekly poll won't re-surface it, and
              // free the poll to look for a later one.
              dismissedVersionRef.current = update.version;
              pendingRef.current = false;
              setUpdate(null);
            }}
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
