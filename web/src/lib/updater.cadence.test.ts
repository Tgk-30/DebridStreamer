// The weekly update-check cadence helpers (markUpdateChecked / updateCheckAgeMs):
// they persist the last-check time so a long-running app re-checks about once a
// week. A full in-memory localStorage stub gives each test a clean slate.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  markUpdateChecked,
  updateCheckAgeMs,
  WEEKLY_UPDATE_CHECK_MS,
} from "./updater";

beforeEach(() => {
  const store = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("update-check cadence helpers", () => {
  it("reports Infinity age before any check has been recorded", () => {
    expect(updateCheckAgeMs(1000)).toBe(Infinity);
  });

  it("records a check and then reports the elapsed age", () => {
    markUpdateChecked(1000);
    expect(updateCheckAgeMs(1000)).toBe(0);
    expect(updateCheckAgeMs(1000 + 5000)).toBe(5000);
  });

  it("clamps a future-dated last check to 0 (clock skew safe)", () => {
    markUpdateChecked(10_000);
    expect(updateCheckAgeMs(5_000)).toBe(0);
  });

  it("treats a corrupt stored value as never-checked", () => {
    localStorage.setItem("ds_last_update_check", "not-a-number");
    expect(updateCheckAgeMs(1000)).toBe(Infinity);
  });

  it("a week-old check is due (age >= WEEKLY_UPDATE_CHECK_MS)", () => {
    markUpdateChecked(0);
    expect(updateCheckAgeMs(WEEKLY_UPDATE_CHECK_MS)).toBeGreaterThanOrEqual(
      WEEKLY_UPDATE_CHECK_MS,
    );
    // Just under a week is not yet due.
    expect(updateCheckAgeMs(WEEKLY_UPDATE_CHECK_MS - 1)).toBeLessThan(
      WEEKLY_UPDATE_CHECK_MS,
    );
  });
});
