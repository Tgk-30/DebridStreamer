// App shell — mirrors Sources/.../Views/ContentView.swift (the Hybrid nav).
//
// Aurora background + restrained glow, a slim glass NavRail on the left, a
// content area that routes between screens via the app store, a floating
// top-right GlobalSearch field (hidden on Settings + Detail), and a Detail
// overlay that mounts over the content area whenever a media item is selected.

import "./theme/theme.css";
import { lazy, Suspense, useEffect, useState } from "react";
import { NavRail, isScreenHidden, type ScreenId } from "./components/NavRail";
import { GlobalSearch } from "./components/GlobalSearch";
import { Spinner } from "./components/Spinner";
import { UpdateBanner } from "./components/UpdateBanner";
import { FirstRunWizard } from "./components/FirstRunWizard";
import { useAppStore } from "./store/AppStore";
import { isServerMode } from "./lib/serverMode";
import { isFirstRun } from "./lib/firstRun";
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

/** Gates a genuine first-run (Local Mode) behind the persona wizard, then the
 *  app. Renders nothing until the async first-run check resolves to avoid a flash
 *  of the app before the wizard. Lives inside AppStoreProvider so both branches
 *  have store access. */
export function FirstRunHost() {
  const [firstRun, setFirstRun] = useState<boolean | null>(null);
  useEffect(() => {
    void isFirstRun().then(setFirstRun);
  }, []);
  if (firstRun == null) return null;
  if (firstRun) return <FirstRunWizard onDone={() => setFirstRun(false)} />;
  return <App />;
}

export function App() {
  const { route, navigate, detailItem, browseContext, openDetail, search, settings, simpleMode } =
    useAppStore();

  // Apply the persisted theme to the document root (instantly on change, and on
  // startup once the Store hydrates the saved choice).
  useTheme(settings);

  // If the current screen is hidden under the active modes (e.g. the user flips
  // to Simple while on Assistant/Debrid, or is in Server Mode), redirect to
  // Discover so they're never stranded on a now-unreachable screen.
  useEffect(() => {
    if (isScreenHidden(route, { serverMode: isServerMode(), simpleMode })) {
      navigate("discover");
    }
  }, [route, simpleMode, navigate]);

  // The global quick-search field is shown on browse screens but not Settings
  // (ContentView.showsGlobalSearch); the dedicated Search screen has its own
  // field, so hide the floating one there too.
  const showsGlobalSearch =
    route !== "settings" &&
    route !== "search" &&
    route !== "calendar" &&
    route !== "debrid" &&
    route !== "assistant" &&
    detailItem == null &&
    browseContext == null;

  return (
    <div className="app">
      <div className="aurora-glow" />

      <NavRail selected={route} onSelect={navigate} />

      <main className="app-content">
        {showsGlobalSearch && <GlobalSearch onSubmit={search} />}

        {/* Route transition: a keyed frame that plays a CSS enter animation on
            each navigation. The `key={route}` remounts this div on every route
            change, which restarts the `routeIn` keyframes (see App.css). We use a
            pure-CSS animation rather than a JS/motion one on purpose: it runs on
            the compositor and completes reliably even if rAF is throttled, and it
            sidesteps the AnimatePresence exit-wait that stalls on these heavy,
            nested-motion screens. Suspense stays inside so a lazy screen shows the
            spinner within the frame. */}
        <div key={route} className="route-frame">
          <Suspense fallback={<Spinner variant="inline" />}>
            {renderScreen(route)}
          </Suspense>
        </div>

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
      <UpdateBanner
        autoCheck={settings.autoUpdateChecks}
        autoInstall={settings.autoInstallUpdates}
      />
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
