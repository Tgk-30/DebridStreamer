// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useTheme } from "./useTheme";
import { defaultSettings } from "../data/settings";
import type { AppSettings } from "../data/settings";

function settings(overrides: Partial<AppSettings> = {}): AppSettings {
  return { ...defaultSettings(), ...overrides };
}

beforeEach(() => {
  // Reset the document root so each test starts from a clean slate.
  const root = document.documentElement;
  root.removeAttribute("data-theme");
  for (const key of Object.keys({ ...root.dataset })) {
    delete root.dataset[key];
  }
  root.removeAttribute("style");
});

describe("useTheme", () => {
  it("returns early when document is not available", () => {
    const { rerender } = renderHook((props) => useTheme(props), {
      initialProps: settings({ theme: "aurora" }),
    });
    expect(document.documentElement.hasAttribute("data-theme")).toBe(false);

    vi.stubGlobal("document", undefined);
    expect(() => rerender(settings({ theme: "midnight" }))).not.toThrow();

    vi.unstubAllGlobals();
  });

  it("reflects all appearance fields onto the document root dataset", () => {
    renderHook(() =>
      useTheme(
        settings({
          appearanceDensity: "compact",
          appearanceTextSize: "l",
          appearanceMotion: "reduced",
          appearanceRadius: "round",
          appearanceChrome: "solid",
          appearanceBackdrop: "plain",
          appearanceHeroScale: "cinematic",
          appearancePanelContrast: "high",
          appearanceNavLabels: "labels",
          appearanceNavTint: "airy",
          appearancePosterSize: "large",
        }),
      ),
    );

    const ds = document.documentElement.dataset;
    expect(ds.density).toBe("compact");
    expect(ds.textSize).toBe("l");
    expect(ds.motion).toBe("reduced");
    expect(ds.radius).toBe("round");
    expect(ds.chrome).toBe("solid");
    expect(ds.backdrop).toBe("plain");
    expect(ds.heroScale).toBe("cinematic");
    expect(ds.panelContrast).toBe("high");
    expect(ds.navLabels).toBe("labels");
    expect(ds.navTint).toBe("airy");
    expect(ds.posterSize).toBe("large");
  });

  it("applies the default theme by removing data-theme and setting dark color-scheme", () => {
    renderHook(() => useTheme(settings({ theme: "midnight" })));
    const root = document.documentElement;
    expect(root.hasAttribute("data-theme")).toBe(false);
    expect(root.style.getPropertyValue("color-scheme")).toBe("dark");
  });

  it("sets data-theme + light color-scheme for a non-default light theme", () => {
    renderHook(() => useTheme(settings({ theme: "light" })));
    const root = document.documentElement;
    expect(root.getAttribute("data-theme")).toBe("light");
    expect(root.style.getPropertyValue("color-scheme")).toBe("light");
  });

  it("sets data-theme + dark color-scheme for a non-default dark theme", () => {
    renderHook(() => useTheme(settings({ theme: "aurora" })));
    const root = document.documentElement;
    expect(root.getAttribute("data-theme")).toBe("aurora");
    expect(root.style.getPropertyValue("color-scheme")).toBe("dark");
  });

  it("falls back to the default theme for an unknown theme id", () => {
    renderHook(() => useTheme(settings({ theme: "does-not-exist" })));
    const root = document.documentElement;
    expect(root.hasAttribute("data-theme")).toBe(false);
    expect(root.style.getPropertyValue("color-scheme")).toBe("dark");
  });

  it("re-applies when the theme changes (switching themes)", () => {
    const { rerender } = renderHook(({ s }) => useTheme(s), {
      initialProps: { s: settings({ theme: "light" }) },
    });
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");

    rerender({ s: settings({ theme: "sunset" }) });
    const root = document.documentElement;
    expect(root.getAttribute("data-theme")).toBe("sunset");
    expect(root.style.getPropertyValue("color-scheme")).toBe("dark");
  });

  it("removes data-theme when switching back to the default", () => {
    const { rerender } = renderHook(({ s }) => useTheme(s), {
      initialProps: { s: settings({ theme: "aurora" }) },
    });
    expect(document.documentElement.getAttribute("data-theme")).toBe("aurora");

    rerender({ s: settings({ theme: "midnight" }) });
    expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
  });

  it("removes the --accent custom properties when accent is 'theme'", () => {
    const root = document.documentElement;
    // Pre-seed accent vars so we can observe their removal.
    root.style.setProperty("--accent", "rgb(1, 2, 3)");
    root.style.setProperty("--accent-rgb", "1, 2, 3");

    renderHook(() => useTheme(settings({ appearanceAccent: "theme" })));

    expect(root.style.getPropertyValue("--accent")).toBe("");
    expect(root.style.getPropertyValue("--accent-rgb")).toBe("");
  });

  it("sets the --accent custom properties for a named accent", () => {
    renderHook(() => useTheme(settings({ appearanceAccent: "cyan" })));
    const root = document.documentElement;
    expect(root.style.getPropertyValue("--accent")).toBe("rgb(92, 189, 250)");
    expect(root.style.getPropertyValue("--accent-rgb")).toBe("92, 189, 250");
  });

  it("computes the three glass-blur vars from appearanceBlur (clamped)", () => {
    renderHook(() => useTheme(settings({ appearanceBlur: 20 })));
    const root = document.documentElement;
    // rest = max(4, blur-4); raised = blur; hero = min(36, blur+10)
    expect(root.style.getPropertyValue("--glass-blur-rest")).toBe("16px");
    expect(root.style.getPropertyValue("--glass-blur-raised")).toBe("20px");
    expect(root.style.getPropertyValue("--glass-blur-hero")).toBe("30px");
  });

  it("clamps the glass-blur floor at 4px for tiny blur values", () => {
    renderHook(() => useTheme(settings({ appearanceBlur: 5 })));
    const root = document.documentElement;
    // rest = max(4, 5-4=1) -> 4
    expect(root.style.getPropertyValue("--glass-blur-rest")).toBe("4px");
    expect(root.style.getPropertyValue("--glass-blur-raised")).toBe("5px");
  });

  it("clamps the glass-blur hero ceiling at 36px for large blur values", () => {
    renderHook(() => useTheme(settings({ appearanceBlur: 40 })));
    const root = document.documentElement;
    // hero = min(36, 40+10=50) -> 36
    expect(root.style.getPropertyValue("--glass-blur-hero")).toBe("36px");
    expect(root.style.getPropertyValue("--glass-blur-raised")).toBe("40px");
  });

  it("rounds a fractional appearanceBlur before computing the vars", () => {
    renderHook(() => useTheme(settings({ appearanceBlur: 18.7 })));
    const root = document.documentElement;
    // round(18.7) = 19
    expect(root.style.getPropertyValue("--glass-blur-raised")).toBe("19px");
    expect(root.style.getPropertyValue("--glass-blur-rest")).toBe("15px");
  });

  it("applies the subtitle appearance custom properties", () => {
    renderHook(() =>
      useTheme(
        settings({
          subtitleFontScale: 1.4,
          subtitleTextColor: "#ffcc00",
          subtitleBgOpacity: 0.25,
        }),
      ),
    );
    const root = document.documentElement;
    expect(root.style.getPropertyValue("--sub-font-scale")).toBe("1.4");
    expect(root.style.getPropertyValue("--sub-color")).toBe("#ffcc00");
    expect(root.style.getPropertyValue("--sub-bg")).toBe("0.25");
  });
});
