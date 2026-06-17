// App shell — mirrors Sources/.../Views/ContentView.swift (the Hybrid nav).
//
// Aurora background + restrained glow, a slim glass NavRail on the left, a
// content area that routes between screens via the app store, a floating
// top-right GlobalSearch field (hidden on Settings + Detail), and a Detail
// overlay that mounts over the content area whenever a media item is selected.

import "./theme/theme.css";
import { useEffect } from "react";
import { NavRail, type ScreenId } from "./components/NavRail";
import { GlobalSearch } from "./components/GlobalSearch";
import { Discover } from "./screens/Discover";
import { Search } from "./screens/Search";
import { Library } from "./screens/Library";
import { Watchlist } from "./screens/Watchlist";
import { Calendar } from "./screens/Calendar";
import { History } from "./screens/History";
import { Assistant } from "./screens/Assistant";
import { DebridLibrary } from "./screens/DebridLibrary";
import { Settings } from "./screens/Settings";
import { Detail } from "./screens/Detail";
import { Browse } from "./screens/Browse";
import { useAppStore } from "./store/AppStore";
import { checkForUpdates } from "./lib/updater";
import "./App.css";

export function App() {
  const { route, navigate, detailItem, browseContext, openDetail, search } =
    useAppStore();

  // Check for a desktop auto-update once on launch. No-op in the browser.
  useEffect(() => {
    void checkForUpdates();
  }, []);

  // The global quick-search field is shown on browse screens but not Settings
  // (ContentView.showsGlobalSearch); the dedicated Search screen has its own
  // field, so hide the floating one there too.
  const showsGlobalSearch =
    route !== "settings" &&
    route !== "search" &&
    route !== "calendar" &&
    route !== "debrid" &&
    detailItem == null &&
    browseContext == null;

  return (
    <div className="app">
      <div className="aurora-glow" />

      <NavRail selected={route} onSelect={navigate} />

      <main className="app-content">
        {showsGlobalSearch && <GlobalSearch onSubmit={search} />}

        {renderScreen(route)}

        {/* Browse overlay — mounts over the current screen ("See all" +
            advanced filters), below the Detail overlay. */}
        {browseContext != null && <Browse />}

        {/* Detail overlay — mounts over the current screen (and over Browse). */}
        {detailItem != null && <Detail />}
      </main>
    </div>
  );

  function renderScreen(screen: ScreenId) {
    switch (screen) {
      case "discover":
        return <Discover onSelect={openDetail} />;
      case "search":
        return <Search />;
      case "library":
        return <Library />;
      case "watchlist":
        return <Watchlist />;
      case "calendar":
        return <Calendar />;
      case "history":
        return <History />;
      case "assistant":
        return <Assistant />;
      case "debrid":
        return <DebridLibrary />;
      case "settings":
        return <Settings />;
    }
  }
}
