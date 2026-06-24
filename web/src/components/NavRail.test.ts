// Pure-logic tests for NavRail's exported nav-gating helpers (no React render).

import { describe, expect, it } from "vitest";
import {
  isScreenHidden,
  shouldShowProfileSwitch,
  visibleNavItems,
  type ScreenId,
} from "./NavRail";

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
  it("hides nothing in the full (local + advanced) experience", () => {
    for (const id of ALL) {
      expect(isScreenHidden(id, { serverMode: false, simpleMode: false })).toBe(
        false,
      );
    }
  });
  it("hides only 'debrid' in Server Mode (server uses its own provider key)", () => {
    const hidden = ALL.filter((id) =>
      isScreenHidden(id, { serverMode: true, simpleMode: false }),
    );
    expect(hidden).toEqual(["debrid"]);
  });
  it("hides the power-user trio in Simple mode, never Settings", () => {
    const hidden = ALL.filter((id) =>
      isScreenHidden(id, { serverMode: false, simpleMode: true }),
    );
    expect(hidden.sort()).toEqual(["assistant", "calendar", "debrid"]);
    expect(isScreenHidden("settings", { serverMode: false, simpleMode: true })).toBe(
      false,
    );
  });
  it("unions both hidden sets when both modes are on", () => {
    const hidden = ALL.filter((id) =>
      isScreenHidden(id, { serverMode: true, simpleMode: true }),
    );
    expect(hidden.sort()).toEqual(["assistant", "calendar", "debrid"]);
  });
});

describe("shouldShowProfileSwitch", () => {
  it("requires server mode + a handler + more than one profile", () => {
    expect(
      shouldShowProfileSwitch({ serverMode: true, hasHandler: true, profileCount: 2 }),
    ).toBe(true);
  });
  it("is false if any condition fails", () => {
    expect(
      shouldShowProfileSwitch({ serverMode: false, hasHandler: true, profileCount: 2 }),
    ).toBe(false);
    expect(
      shouldShowProfileSwitch({ serverMode: true, hasHandler: false, profileCount: 2 }),
    ).toBe(false);
    expect(
      shouldShowProfileSwitch({ serverMode: true, hasHandler: true, profileCount: 1 }),
    ).toBe(false);
    expect(
      shouldShowProfileSwitch({ serverMode: true, hasHandler: true, profileCount: 0 }),
    ).toBe(false);
  });
});

describe("visibleNavItems", () => {
  const items = ALL.map((id) => ({
    id,
    icon: "discover" as const,
    label: id,
    group: "Primary" as const,
  }));

  it("returns all items when nothing is hidden", () => {
    expect(
      visibleNavItems(items, { serverMode: false, simpleMode: false }).map((i) => i.id),
    ).toEqual(ALL);
  });
  it("drops the Simple-mode-hidden items, preserving order", () => {
    const ids = visibleNavItems(items, { serverMode: false, simpleMode: true }).map(
      (i) => i.id,
    );
    expect(ids).not.toContain("assistant");
    expect(ids).not.toContain("debrid");
    expect(ids).not.toContain("calendar");
    expect(ids).toContain("discover");
    expect(ids).toContain("settings");
  });
});
