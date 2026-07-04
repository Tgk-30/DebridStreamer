// useTheme — applies the persisted theme id to the document root.
//
// The chosen theme lives in the settings Store (loaded into AppStore). This hook
// reflects it onto `<html data-theme="…">` whenever it changes, so the
// CSS-variable retune in theme.css takes effect instantly on selection AND on
// app startup (after the Store hydrates the saved choice). The pure apply logic
// is `applyTheme` in themes.ts (unit-tested); this is the thin React glue.

import { useEffect } from "react";
import type { AppSettings } from "../data/settings";
import { accentById, applyTheme } from "./themes";

/** Reflect `themeId` onto the document root. No-op outside a DOM (SSR/tests). */
export function useTheme(settings: AppSettings): void {
  useEffect(() => {
    if (typeof document === "undefined") return;
    const root = document.documentElement;
    applyTheme(settings.theme, root);

    root.dataset.density = settings.appearanceDensity;
    root.dataset.textSize = settings.appearanceTextSize;
    root.dataset.motion = settings.appearanceMotion;
    root.dataset.radius = settings.appearanceRadius;
    root.dataset.chrome = settings.appearanceChrome;
    root.dataset.backdrop = settings.appearanceBackdrop;
    root.dataset.heroScale = settings.appearanceHeroScale;
    root.dataset.panelContrast = settings.appearancePanelContrast;
    root.dataset.navLabels = settings.appearanceNavLabels;
    root.dataset.navPosition = settings.appearanceNavPosition;
    root.dataset.navTint = settings.appearanceNavTint;
    root.dataset.posterSize = settings.appearancePosterSize;

    const accent = accentById(settings.appearanceAccent);
    if (accent.id === "theme") {
      root.style.removeProperty("--accent");
      root.style.removeProperty("--accent-rgb");
    } else {
      root.style.setProperty("--accent", accent.color);
      root.style.setProperty("--accent-rgb", accent.rgb);
    }

    const blur = Math.round(settings.appearanceBlur);
    root.style.setProperty("--glass-blur-rest", `${Math.max(4, blur - 4)}px`);
    root.style.setProperty("--glass-blur-raised", `${blur}px`);
    root.style.setProperty("--glass-blur-hero", `${Math.min(36, blur + 10)}px`);

    // Subtitle appearance (consumed by the player's ::cue rules).
    root.style.setProperty("--sub-font-scale", String(settings.subtitleFontScale));
    root.style.setProperty("--sub-color", settings.subtitleTextColor);
    root.style.setProperty("--sub-bg", String(settings.subtitleBgOpacity));
  }, [settings]);
}
