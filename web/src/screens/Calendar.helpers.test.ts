import { describe, expect, it } from "vitest";
import { calendarMonthDays, relativeAir } from "./Calendar";
import type { CalendarEntry } from "../data/calendar";

// A fixed local "now": afternoon of 2026-07-05.
const NOW = new Date("2026-07-05T14:00:00").getTime();

describe("relativeAir", () => {
  it("returns Today for the same local day", () => {
    expect(relativeAir("2026-07-05", NOW)).toBe("Today");
  });

  it("returns Tomorrow for the next day", () => {
    expect(relativeAir("2026-07-06", NOW)).toBe("Tomorrow");
  });

  it("returns 'In N days' within a week (inclusive of 7)", () => {
    expect(relativeAir("2026-07-08", NOW)).toBe("In 3 days");
    expect(relativeAir("2026-07-12", NOW)).toBe("In 7 days");
  });

  it("returns null beyond a week (the absolute date carries it)", () => {
    expect(relativeAir("2026-07-13", NOW)).toBeNull();
  });

  it("returns null for past air dates", () => {
    expect(relativeAir("2026-07-04", NOW)).toBeNull();
  });

  it("uses the LOCAL midnight boundary, so a late-evening now isn't off by one", () => {
    const evening = new Date("2026-07-05T23:30:00").getTime();
    expect(relativeAir("2026-07-05", evening)).toBe("Today");
    expect(relativeAir("2026-07-06", evening)).toBe("Tomorrow");
  });

  it("returns null for a malformed date", () => {
    expect(relativeAir("not-a-date", NOW)).toBeNull();
  });

  it("returns null for a partial ISO date (would otherwise parse leniently)", () => {
    // new Date("2026-07T00:00:00") parses to Jul 1 - the strict guard rejects it.
    expect(relativeAir("2026-07", NOW)).toBeNull();
    expect(relativeAir("2026", NOW)).toBeNull();
  });
});

describe("calendarMonthDays", () => {
  it("places release entries on their local month day and marks today", () => {
    const entry: CalendarEntry = {
      id: "episode:show:1:1:2026-07-05",
      date: "2026-07-05",
      media: { id: "show", type: "series", title: "Severance" },
      kind: "episode",
      detail: "S02E07 · Cold Harbor",
    };
    const days = calendarMonthDays(
      new Date("2026-07-01T12:00:00"),
      [entry],
      NOW,
    );

    expect(days).toHaveLength(42);
    expect(days.find((day) => day.date === "2026-07-05")).toMatchObject({
      inMonth: true,
      isToday: true,
      entries: [entry],
    });
  });
});
