// App-wide external-link fix for the Tauri desktop app.
//
// A plain <a href="https://…" target="_blank"> is swallowed by the Tauri
// webview - the click does nothing (it won't navigate the app window, and no
// OS browser opens). That silently broke every signup / "Get a key" / docs
// link across onboarding and Settings. Rather than convert each anchor, a
// single delegated click listener routes any external http(s) link through the
// opener plugin when running under Tauri. In a normal browser it does nothing
// and the native link works as usual.
//
// Internal navigation in this SPA is state-driven (no http hrefs), so
// intercepting every http(s) anchor is safe: they are all genuinely external.

import { isTauri, openExternalURL } from "./tauri";

let installed = false;

export function installExternalLinkHandler(): void {
  if (installed || typeof document === "undefined") return;
  installed = true;

  document.addEventListener(
    "click",
    (event) => {
      // Only relevant in the desktop webview; a real browser opens links itself.
      if (!isTauri()) return;
      // Let an explicit component handler win if it already acted.
      if (event.defaultPrevented) return;

      const target = event.target as Element | null;
      const anchor = target?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (anchor == null) return;

      const href = anchor.getAttribute("href") ?? "";
      if (!/^https?:\/\//i.test(href)) return; // external links only

      // NB: no modifier/button gating here. In a browser those open a new
      // tab/window natively, but the desktop webview has no such concept - a
      // Cmd/Ctrl/middle-click would just fall through to the swallowed
      // target="_blank" and do nothing. Route every external click to the OS
      // browser instead.
      event.preventDefault();
      void openExternalURL(href);
    },
    // Capture phase so we win before any component-level handler navigates.
    true,
  );
}
