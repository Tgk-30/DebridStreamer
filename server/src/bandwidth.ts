/**
 * Household bandwidth quotas are deliberately advisory.  The status is used
 * only for profile and usage payloads, never to admit or reject playback.
 */
export type BandwidthCapStatus = "ok" | "approaching" | "over";

/** A rolling-month cap starts warning at 80% and is over at 100%. */
export function bandwidthCapStatus(
  usageBytes: number,
  capBytes: number | null,
): BandwidthCapStatus {
  if (capBytes == null || !Number.isFinite(capBytes) || capBytes <= 0) return "ok";
  const usage = Number.isFinite(usageBytes) ? Math.max(0, usageBytes) : 0;
  if (usage >= capBytes) return "over";
  if (usage >= capBytes * 0.8) return "approaching";
  return "ok";
}
