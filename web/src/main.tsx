import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { ServerModeGate } from "./components/ServerModeGate";
import { AppStoreProvider } from "./store/AppStore";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ServerModeGate>
      <AppStoreProvider>
        <App />
      </AppStoreProvider>
    </ServerModeGate>
  </StrictMode>,
);

if ("serviceWorker" in navigator && !import.meta.env.DEV) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {
      // Installability should never block the app itself.
    });
  });
}
