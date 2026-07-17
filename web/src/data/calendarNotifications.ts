// Lightweight, per-profile watermark for the in-app Calendar indicator.
//
// This deliberately covers only the in-app badge. OS/push notifications and a
// notification center need delivery infrastructure and are follow-up work.

import { getStore } from "../storage";

export const CALENDAR_LAST_SEEN_KEY = "calendar_last_seen_at";

function parseTimestamp(value: string | null): number | null {
  if (value == null) return null;
  const timestamp = Number(value);
  return Number.isFinite(timestamp) && timestamp > 0 ? timestamp : null;
}

/** Read the Calendar visit watermark, recording `now` on first run so an
 * existing release window is never presented as a backlog of new episodes. */
export async function loadOrInitializeCalendarLastSeenAt(
  now: number = Date.now(),
): Promise<number> {
  const store = getStore();
  const existing = parseTimestamp(await store.getSetting(CALENDAR_LAST_SEEN_KEY));
  if (existing != null) return existing;
  await store.setSetting(CALENDAR_LAST_SEEN_KEY, String(now));
  return now;
}

/** Advance the persisted Calendar visit watermark. */
export async function saveCalendarLastSeenAt(seenAt: number): Promise<void> {
  if (!Number.isFinite(seenAt) || seenAt <= 0) return;
  await getStore().setSetting(CALENDAR_LAST_SEEN_KEY, String(seenAt));
}
