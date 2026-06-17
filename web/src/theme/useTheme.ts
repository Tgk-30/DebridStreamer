// useTheme — applies the persisted theme id to the document root.
//
// The chosen theme lives in the settings Store (loaded into AppStore). This hook
// reflects it onto `<html data-theme="…">` whenever it changes, so the
// CSS-variable retune in theme.css takes effect instantly on selection AND on
// app startup (after the Store hydrates the saved choice). The pure apply logic
// is `applyTheme` in themes.ts (unit-tested); this is the thin React glue.

import { useEffect } from "react";
import { applyTheme } from "./themes";

/** Reflect `themeId` onto the document root. No-op outside a DOM (SSR/tests). */
export function useTheme(themeId: string): void {
  useEffect(() => {
    if (typeof document === "undefined") return;
    applyTheme(themeId, document.documentElement);
  }, [themeId]);
}
