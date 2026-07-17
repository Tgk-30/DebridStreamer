// Pure-logic tests for NavRail's exported nav-gating helpers (no React render).

import { describe, expect, it } from "vitest";
import {
  applyNavCustomization,
  isScreenHidden,
  NAV_RAIL_ITEMS,
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

describe("applyNavCustomization", () => {
  const groupOf = (id: ScreenId) =>
    NAV_RAIL_ITEMS.find((i) => i.id === id)!.group;
  const idsOf = (items: readonly { id: ScreenId }[]) => items.map((i) => i.id);

  it("is a no-op when order and hidden are both empty", () => {
    const out = applyNavCustomization(NAV_RAIL_ITEMS, { order: [], hidden: [] });
    expect(idsOf(out)).toEqual(idsOf(NAV_RAIL_ITEMS));
  });

  it("removes hidden items", () => {
    const out = applyNavCustomization(NAV_RAIL_ITEMS, {
      order: [],
      hidden: ["calendar", "history"],
    });
    expect(idsOf(out)).not.toContain("calendar");
    expect(idsOf(out)).not.toContain("history");
    expect(idsOf(out)).toContain("library");
  });

  it("never hides Settings even if asked", () => {
    const out = applyNavCustomization(NAV_RAIL_ITEMS, {
      order: [],
      hidden: ["settings"],
    });
    expect(idsOf(out)).toContain("settings");
  });

  it("reorders items within their group", () => {
    // Ask for history before library (both in the Library group).
    const out = applyNavCustomization(NAV_RAIL_ITEMS, {
      order: ["history", "library"],
      hidden: [],
    });
    const ids = idsOf(out);
    expect(ids.indexOf("history")).toBeLessThan(ids.indexOf("library"));
    // Unranked group-mates keep their relative order after the ranked ones.
    expect(ids.indexOf("library")).toBeLessThan(ids.indexOf("watchlist"));
  });

  it("never moves an item into a different group", () => {
    // discover is Primary; try to rank it after a Library item.
    const out = applyNavCustomization(NAV_RAIL_ITEMS, {
      order: ["library", "discover"],
      hidden: [],
    });
    for (const item of out) {
      expect(item.group).toBe(groupOf(item.id));
    }
    // Every Primary item still precedes every Library item (group order kept).
    const ids = idsOf(out);
    const lastPrimary = Math.max(
      ...out.flatMap((i, idx) => (i.group === "Primary" ? [idx] : [])),
    );
    const firstLibrary = Math.min(
      ...out.flatMap((i, idx) => (i.group === "Library" ? [idx] : [])),
    );
    expect(lastPrimary).toBeLessThan(firstLibrary);
    expect(ids).toContain("discover");
  });

  it("ignores unknown ids in the order list", () => {
    const out = applyNavCustomization(NAV_RAIL_ITEMS, {
      order: ["not-a-screen" as ScreenId, "search"],
      hidden: [],
    });
    expect(idsOf(out)).toEqual(
      expect.arrayContaining(idsOf(NAV_RAIL_ITEMS).filter((id) => id !== "settings" || true)),
    );
    // Length unchanged (nothing hidden), and search still present.
    expect(out).toHaveLength(NAV_RAIL_ITEMS.length);
    expect(idsOf(out)).toContain("search");
  });

  it("composes with the mode filter (hidden + mode-gated both drop out)", () => {
    const customized = applyNavCustomization(NAV_RAIL_ITEMS, {
      order: [],
      hidden: ["watchlist"],
    });
    const visible = visibleNavItems(customized, {
      serverMode: true,
      simpleMode: false,
    });
    const ids = idsOf(visible);
    expect(ids).not.toContain("watchlist"); // user-hidden
    expect(ids).not.toContain("debrid"); // server-mode gated
    expect(ids).toContain("settings");
  });
});
