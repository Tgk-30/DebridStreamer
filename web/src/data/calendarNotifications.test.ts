// Tests for the small per-profile Calendar watermark KV helper.

import { beforeEach, describe, expect, it, vi } from "vitest";

const values = new Map<string, string>();
const getSetting = vi.fn(async (key: string) => values.get(key) ?? null);
const setSetting = vi.fn(async (key: string, value: string | null) => {
  if (value == null) values.delete(key);
  else values.set(key, value);
});

vi.mock("../storage", () => ({
  getStore: () => ({ getSetting, setSetting }),
}));

import {
  CALENDAR_LAST_SEEN_KEY,
  loadOrInitializeCalendarLastSeenAt,
  saveCalendarLastSeenAt,
} from "./calendarNotifications";

beforeEach(() => {
  values.clear();
  vi.clearAllMocks();
});

describe("Calendar notification watermark", () => {
  it("initializes first run to now so existing episodes are not falsely new", async () => {
    const now = Date.parse("2026-06-19T12:00:00Z");
    await expect(loadOrInitializeCalendarLastSeenAt(now)).resolves.toBe(now);
    expect(setSetting).toHaveBeenCalledWith(CALENDAR_LAST_SEEN_KEY, String(now));
  });

  it("retains a saved visit timestamp and advances it when Calendar is visited", async () => {
    values.set(CALENDAR_LAST_SEEN_KEY, "1234");
    await expect(loadOrInitializeCalendarLastSeenAt(9999)).resolves.toBe(1234);
    expect(setSetting).not.toHaveBeenCalled();

    await saveCalendarLastSeenAt(5678);
    expect(values.get(CALENDAR_LAST_SEEN_KEY)).toBe("5678");
  });
});
