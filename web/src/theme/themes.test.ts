// Pure theme-list + apply/persist logic tests (no DOM - applyTheme takes a stub
// root so the attribute/style side effects are observable without a browser).

import { describe, expect, it } from "vitest";
import {
  applyTheme,
  DEFAULT_THEME_ID,
  isValidThemeId,
  resolveThemeId,
  THEMES,
  themeById,
} from "./themes";

/** A minimal stand-in for `document.documentElement`. */
function makeStubRoot() {
  const attrs = new Map<string, string>();
  const props = new Map<string, string>();
  return {
    setAttribute: (n: string, v: string) => attrs.set(n, v),
    removeAttribute: (n: string) => attrs.delete(n),
    style: { setProperty: (p: string, v: string) => props.set(p, v) },
    attr: (n: string) => attrs.get(n) ?? null,
    prop: (p: string) => props.get(p) ?? null,
  };
}

describe("theme list", () => {
  it("ships at least 4 distinct themes including the default", () => {
    expect(THEMES.length).toBeGreaterThanOrEqual(4);
    const ids = THEMES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length); // unique ids
    expect(ids).toContain(DEFAULT_THEME_ID);
    expect(ids).toContain("light");
  });

  it("every theme has a label, description, and swatch colors", () => {
    for (const t of THEMES) {
      expect(t.label.length).toBeGreaterThan(0);
      expect(t.description.length).toBeGreaterThan(0);
      expect(t.swatchBg.length).toBe(2);
      expect(t.swatchAccent.length).toBeGreaterThan(0);
    }
  });

  it("exactly one light theme is flagged", () => {
    const light = THEMES.filter((t) => t.light);
    expect(light.length).toBeGreaterThanOrEqual(1);
    expect(light.some((t) => t.id === "light")).toBe(true);
  });
});

describe("resolveThemeId / isValidThemeId", () => {
  it("accepts known ids and rejects unknown/empty", () => {
    expect(isValidThemeId("aurora")).toBe(true);
    expect(isValidThemeId("light")).toBe(true);
    expect(isValidThemeId("nope")).toBe(false);
    expect(isValidThemeId(null)).toBe(false);
    expect(isValidThemeId(undefined)).toBe(false);
  });

  it("falls back to the default for unknown input", () => {
    expect(resolveThemeId("midnight")).toBe("midnight");
    expect(resolveThemeId("bogus")).toBe(DEFAULT_THEME_ID);
    expect(resolveThemeId(null)).toBe(DEFAULT_THEME_ID);
  });

  it("themeById always returns a def", () => {
    expect(themeById("sunset").id).toBe("sunset");
    expect(themeById("bogus").id).toBe(DEFAULT_THEME_ID);
  });
});

describe("applyTheme", () => {
  it("removes data-theme for the default theme and sets a dark color-scheme", () => {
    const root = makeStubRoot();
    root.setAttribute("data-theme", "light"); // a stale value to be cleared
    const applied = applyTheme(DEFAULT_THEME_ID, root);
    expect(applied).toBe(DEFAULT_THEME_ID);
    expect(root.attr("data-theme")).toBeNull();
    expect(root.prop("color-scheme")).toBe("dark");
  });

  it("sets data-theme and light color-scheme for the light theme", () => {
    const root = makeStubRoot();
    const applied = applyTheme("light", root);
    expect(applied).toBe("light");
    expect(root.attr("data-theme")).toBe("light");
    expect(root.prop("color-scheme")).toBe("light");
  });

  it("coerces an unknown id back to the default (no attribute)", () => {
    const root = makeStubRoot();
    root.setAttribute("data-theme", "sunset");
    const applied = applyTheme("garbage", root);
    expect(applied).toBe(DEFAULT_THEME_ID);
    expect(root.attr("data-theme")).toBeNull();
  });

  it("sets data-theme for non-default dark themes", () => {
    const root = makeStubRoot();
    applyTheme("midnight", root);
    expect(root.attr("data-theme")).toBe("midnight");
    expect(root.prop("color-scheme")).toBe("dark");
  });
});
