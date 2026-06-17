// App shell — mirrors Sources/.../Views/ContentView.swift (the Hybrid nav).
//
// Aurora background + restrained glow, a slim glass NavRail on the left, a
// content area that routes between screens via the app store, a floating
// top-right GlobalSearch field (hidden on Settings + Detail), and a Detail
// overlay that mounts over the content area whenever a media item is selected.

import "./theme/theme.css";
import { lazy, Suspense } from "react";
import { NavRail, type ScreenId } from "./components/NavRail";
import { GlobalSearch } from "./components/GlobalSearch";
import { Spinner } from "./components/Spinner";
import { UpdateBanner } from "./components/UpdateBanner";
import { useAppStore } from "./store/AppStore";
import { useTheme } from "./theme/useTheme";
import "./App.css";

// First-paint + light screens stay eager (Discover is the landing screen; the
// rest are small structural lists that read already-loaded store state).
import { Discover } from "./screens/Discover";
import { Search } from "./screens/Search";
import { Library } from "./screens/Library";
import { Watchlist } from "./screens/Watchlist";
import { History } from "./screens/History";
import { Assistant } from "./screens/Assistant";

// Heavy / not-on-first-paint screens + overlays are code-split into their own
// chunks (React.lazy), so the initial bundle doesn't carry them. The Detail
// overlay in particular pulls in the VideoPlayer + hls.js (large). The screens
// use named exports, so map them to a `default` for lazy(). Each is rendered
// inside a <Suspense> with a glass Spinner fallback while its chunk downloads.
const Calendar = lazy(() =>
  import("./screens/Calendar").then((m) => ({ default: m.Calendar })),
);
const DebridLibrary = lazy(() =>
  import("./screens/DebridLibrary").then((m) => ({ default: m.DebridLibrary })),
);
const Settings = lazy(() =>
  import("./screens/Settings").then((m) => ({ default: m.Settings })),
);
const Browse = lazy(() =>
  import("./screens/Browse").then((m) => ({ default: m.Browse })),
);
const Detail = lazy(() =>
  import("./screens/Detail").then((m) => ({ default: m.Detail })),
);

export function App() {
  const { route, navigate, detailItem, browseContext, openDetail, search, settings } =
    useAppStore();

  // Apply the persisted theme to the document root (instantly on change, and on
  // startup once the Store hydrates the saved choice).
  useTheme(settings.theme);

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

        <Suspense fallback={<Spinner variant="inline" />}>
          {renderScreen(route)}
        </Suspense>

        {/* Browse overlay — mounts over the current screen ("See all" +
            advanced filters), below the Detail overlay. */}
        {browseContext != null && (
          <Suspense fallback={<Spinner variant="overlay" />}>
            <Browse />
          </Suspense>
        )}

        {/* Detail overlay — mounts over the current screen (and over Browse). */}
        {detailItem != null && (
          <Suspense fallback={<Spinner variant="overlay" />}>
            <Detail />
          </Suspense>
        )}
      </main>

      {/* Desktop auto-update toast. Runs the launch-time check itself and is a
          no-op in a plain browser (isTauri-gated in updater.ts). */}
      <UpdateBanner />
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
