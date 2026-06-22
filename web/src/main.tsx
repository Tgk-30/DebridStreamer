import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { MotionConfig } from "motion/react";
import { FirstRunHost } from "./App";
import { ServerModeGate } from "./components/ServerModeGate";
import { AppStoreProvider } from "./store/AppStore";

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
