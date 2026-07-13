import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { MotionConfig } from "motion/react";
import { FirstRunHost } from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { ServerModeGate } from "./components/ServerModeGate";
import { AppStoreProvider } from "./store/AppStore";
import { installSuspendOnHidden } from "./lib/suspendOnHidden";
import { initInstallPromptCapture } from "./lib/installPrompt";
import { installExternalLinkHandler } from "./lib/externalLinks";

const failureLog: string[] = [];
const MAX_FAILURE_LOG = 50;

function reportBackgroundFailure(kind: "error" | "unhandledrejection", value: unknown): void {
  const message = value instanceof Error ? value.message : String(value);
  failureLog.push(`${new Date().toISOString()} ${kind}: ${message}`);
  if (failureLog.length > MAX_FAILURE_LOG) failureLog.splice(0, failureLog.length - MAX_FAILURE_LOG);
  // Keep the last-resort failure visible in production diagnostics without
  // interrupting the current task. React ErrorBoundary cannot observe async
  // promise rejections.
  console.error(`[DebridStreamer ${kind}]`, value);
}

window.addEventListener("unhandledrejection", (event) => {
  reportBackgroundFailure("unhandledrejection", event.reason);
});
window.addEventListener("error", (event) => {
  reportBackgroundFailure("error", event.error ?? event.message);
});

// Park all CSS animations whenever the window is hidden/minimized/covered.
installSuspendOnHidden();

// Capture beforeinstallprompt before React mounts - Chromium can fire it
// before the first component effect runs.
initInstallPromptCapture();

// Route external http(s) links through the OS browser under Tauri (a plain
// <a target="_blank"> is otherwise swallowed by the desktop webview).
installExternalLinkHandler();

// Apply the persisted collapsed-nav state BEFORE first paint so a collapsed rail
// doesn't render expanded and snap shut once React mounts. NavRail keeps it in
// sync afterward via its own layout effect.
try {
  if (localStorage.getItem("ds_nav_collapsed") === "true") {
    document.documentElement.dataset.navCollapsed = "true";
  }
} catch {
  /* no localStorage (SSR/private mode) - NavRail's effect still applies it */
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {/* Honor OS "Reduce Motion" across the JS/motion layer too (the CSS layer is
        handled by the prefers-reduced-motion media query in theme.css). */}
    <MotionConfig reducedMotion="user">
      {/* Top-level safety net: any uncaught render crash (store, providers, or a
          screen) shows a reload card instead of a blank white screen. */}
      <ErrorBoundary label="root">
        <ServerModeGate>
          <AppStoreProvider>
            <FirstRunHost />
          </AppStoreProvider>
        </ServerModeGate>
      </ErrorBoundary>
    </MotionConfig>
  </StrictMode>,
);

if ("serviceWorker" in navigator && !import.meta.env.DEV) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {
      // Installability should never block the app itself.
    });
  });
}
