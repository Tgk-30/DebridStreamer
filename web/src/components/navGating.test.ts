import { describe, expect, it } from "vitest";
import { isScreenHidden, visibleNavItems } from "./NavRail";
import type { ScreenId } from "./NavRail";

const ALL: ScreenId[] = [
  "discover",
  "search",
  "library",
  "watchlist",
  "calendar",
  "history",
  "assistant",
  "debrid",
  "settings",
];

describe("isScreenHidden", () => {
  it("Advanced + Local hides nothing", () => {
    for (const id of ALL) {
      expect(isScreenHidden(id, { serverMode: false, simpleMode: false }), id).toBe(false);
    }
  });

  it("Server Mode hides only debrid (Tauri-only); assistant + calendar work", () => {
    // The Assistant routes to /api/ai in Server Mode, so it's no longer a
    // dead-end and stays visible. Debrid Library is Tauri-only → still hidden.
    expect(isScreenHidden("debrid", { serverMode: true, simpleMode: false })).toBe(true);
    expect(isScreenHidden("assistant", { serverMode: true, simpleMode: false })).toBe(false);
    expect(isScreenHidden("calendar", { serverMode: true, simpleMode: false })).toBe(false);
  });

  it("Simple hides assistant/debrid/calendar; keeps essentials + settings", () => {
    for (const id of ["assistant", "debrid", "calendar"] as ScreenId[]) {
      expect(isScreenHidden(id, { serverMode: false, simpleMode: true }), id).toBe(true);
    }
    for (const id of ["discover", "search", "library", "watchlist", "history", "settings"] as ScreenId[]) {
      expect(isScreenHidden(id, { serverMode: false, simpleMode: true }), id).toBe(false);
    }
  });

  it("never hides settings (it hosts the Simple/Advanced toggle)", () => {
    expect(isScreenHidden("settings", { serverMode: true, simpleMode: true })).toBe(false);
  });
});

describe("visibleNavItems", () => {
  it("drops hidden ids", () => {
    const items = [
      { id: "discover" },
      { id: "assistant" },
      { id: "settings" },
    ] as unknown as Parameters<typeof visibleNavItems>[0];
    const out = visibleNavItems(items, { serverMode: false, simpleMode: true }).map((i) => i.id);
    expect(out).toEqual(["discover", "settings"]);
  });
});
