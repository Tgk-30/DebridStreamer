import { useEffect, useRef } from "react";

/**
 * Keep the display awake only while media is actually playing. Wake Lock
 * sentinels are automatically released when a document is hidden, so a visible
 * return must acquire a fresh sentinel rather than assuming the old one holds.
 */
export function useWakeLock(active: boolean): void {
  const sentinelRef = useRef<WakeLockSentinel | null>(null);
  const activeRef = useRef(active);
  activeRef.current = active;

  useEffect(() => {
    if (!("wakeLock" in navigator) || typeof navigator.wakeLock?.request !== "function") {
      return;
    }

    let cancelled = false;
    let requestInFlight = false;
    const isDocumentHidden = () => document.visibilityState === "hidden";

    const release = () => {
      const sentinel = sentinelRef.current;
      sentinelRef.current = null;
      if (sentinel != null && !sentinel.released) {
        void sentinel.release().catch(() => {});
      }
    };

    const acquire = async () => {
      if (
        cancelled ||
        !activeRef.current ||
        isDocumentHidden() ||
        requestInFlight ||
        (sentinelRef.current != null && !sentinelRef.current.released)
      ) {
        return;
      }
      requestInFlight = true;
      try {
        const sentinel = await navigator.wakeLock.request("screen");
        if (cancelled || !activeRef.current || isDocumentHidden()) {
          void sentinel.release().catch(() => {});
          return;
        }
        sentinelRef.current = sentinel;
        sentinel.addEventListener("release", () => {
          if (sentinelRef.current === sentinel) sentinelRef.current = null;
        });
      } catch {
        // Permission, battery-saver, and unsupported-context failures are all
        // safe no-ops: playback must never depend on a wake lock.
      } finally {
        requestInFlight = false;
      }
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible" && activeRef.current) {
        void acquire();
      }
    };

    document.addEventListener("visibilitychange", onVisibilityChange);
    if (active) void acquire();
    else release();

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisibilityChange);
      release();
    };
  }, [active]);
}
