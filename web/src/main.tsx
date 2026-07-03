import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { MotionConfig } from "motion/react";
import { FirstRunHost } from "./App";
import { ServerModeGate } from "./components/ServerModeGate";
import { AppStoreProvider } from "./store/AppStore";
import { installSuspendOnHidden } from "./lib/suspendOnHidden";
import { initInstallPromptCapture } from "./lib/installPrompt";
import { installExternalLinkHandler } from "./lib/externalLinks";

// Park all CSS animations whenever the window is hidden/minimized/covered.
installSuspendOnHidden();

// Capture beforeinstallprompt before React mounts — Chromium can fire it
// before the first component effect runs.
initInstallPromptCapture();

// Route external http(s) links through the OS browser under Tauri (a plain
// <a target="_blank"> is otherwise swallowed by the desktop webview).
installExternalLinkHandler();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {/* Honor OS "Reduce Motion" across the JS/motion layer too (the CSS layer is
        handled by the prefers-reduced-motion media query in theme.css). */}
    <MotionConfig reducedMotion="user">
      <ServerModeGate>
        <AppStoreProvider>
          <FirstRunHost />
        </AppStoreProvider>
      </ServerModeGate>
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
