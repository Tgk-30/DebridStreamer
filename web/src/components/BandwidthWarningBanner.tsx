// Rolling household bandwidth caps are intentionally advisory. This banner is
// a persistent in-app warning until dismissed, never a playback gate.

import { useState } from "react";
import { useServerProfiles, useServerSession } from "../lib/ServerSessionContext";
import { isServerMode } from "../lib/serverMode";
import "./BandwidthWarningBanner.css";

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 10 || unit === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[unit]}`;
}

export function BandwidthWarningBanner() {
  const session = useServerSession();
  const profiles = useServerProfiles();
  const active = profiles.find((profile) => profile.id === session?.profileId);
  const status = active?.bandwidthStatus;
  const cap = active?.bandwidthCapBytes;
  const usage = active?.bandwidthUsageBytes ?? 0;
  const warningKey =
    active != null && cap != null && (status === "approaching" || status === "over")
      ? `${active.id}:${cap}:${usage}:${status}`
      : null;
  const [dismissedKey, setDismissedKey] = useState<string | null>(null);

  // Members get the household guidance. Owners/admins manage caps in the
  // profile picker instead, and restricted/local modes are never offered it.
  if (
    !isServerMode() ||
    session?.role !== "member" ||
    warningKey == null ||
    dismissedKey === warningKey
  ) {
    return null;
  }

  return (
    <aside className={`bandwidth-warning is-${status}`} role="status" aria-live="polite">
      <div>
        <strong>{status === "over" ? "Monthly cap exceeded" : "Monthly cap nearly reached"}</strong>
        <p>
          {status === "over"
            ? "You are over your monthly cap - playback still works; your household owner can adjust it."
            : `You have used ${formatBytes(usage)} of your ${formatBytes(cap ?? 0)} monthly cap. Playback still works.`}
        </p>
      </div>
      <button
        type="button"
        className="bandwidth-warning-dismiss"
        aria-label="Dismiss bandwidth warning"
        onClick={() => setDismissedKey(warningKey)}
      >
        Dismiss
      </button>
    </aside>
  );
}
