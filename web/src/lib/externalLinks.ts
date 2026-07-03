// App-wide external-link fix for the Tauri desktop app.
//
// A plain <a href="https://…" target="_blank"> is swallowed by the Tauri
// webview — the click does nothing (it won't navigate the app window, and no
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
      if (!isTauri()) return;
      // Respect modified clicks and non-primary buttons (a no-op in Tauri's
      // single window, but correct to leave alone).
      if (event.defaultPrevented) return;
      if (event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

      const target = event.target as Element | null;
      const anchor = target?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (anchor == null) return;

      const href = anchor.getAttribute("href") ?? "";
      if (!/^https?:\/\//i.test(href)) return; // external links only

      event.preventDefault();
      void openExternalURL(href);
    },
    // Capture phase so we win before any component-level handler navigates.
    true,
  );
}
