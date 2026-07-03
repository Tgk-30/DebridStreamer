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
import { ServerSetupWizard } from "./components/ServerSetupWizard";
import { TierOnboarding } from "./components/TierOnboarding";
import { ProfilePicker } from "./components/ProfilePicker";
import { CommandPalette } from "./components/CommandPalette";
import { WelcomeGuide } from "./components/WelcomeGuide";
import { KeyboardShortcuts } from "./components/KeyboardShortcuts";
import { SetupNudge } from "./components/SetupNudge";
import { InstallPrompt, isInstallPromptEligible } from "./components/InstallPrompt";
import { isSmartPreloadEnabled, whenIdle } from "./lib/smartPreload";
import { useAppStore } from "./store/AppStore";
import { useServerSession } from "./lib/ServerSessionContext";
import { isServerMode } from "./lib/serverMode";
import { devBypassesOnboarding, isFirstRun, needsKeyOnboarding } from "./lib/firstRun";
import { secretReadsFailedThisSession } from "./storage/KeychainSecretStore";
import { shouldShowServerSetup } from "./lib/serverSetup";
import { fetchServerAdminHealth } from "./lib/serverApi";
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

/** Gates a genuine first-run behind the right wizard, then the app:
 *   • Local Mode  → the persona FirstRunWizard (isFirstRun).
 *   • Server Mode → the owner-only ServerSetupWizard for a fresh server
 *     (shouldShowServerSetup), driven off the live admin health counts.
 *
 *  Renders nothing until the async checks resolve to avoid a flash of the app
 *  before a wizard. Lives inside AppStoreProvider + ServerSessionProvider so all
 *  branches have store + session access. */
export function FirstRunHost() {
  const { hydrated, settings, services } = useAppStore();
  const session = useServerSession();
  const serverMode = isServerMode();

  // Local-Mode persona wizard gate.
  const [firstRun, setFirstRun] = useState<boolean | null>(null);
  // The FORCED key gate: a Local-Mode launch without a catalog key or a debrid
  // token re-opens the wizard as mandatory, regardless of onboarding history.
  // Latched ONCE per launch (after hydration) so completing the wizard — or
  // deliberately clearing keys in Settings — doesn't re-trap mid-session; the
  // next launch re-evaluates.
  const [keyGate, setKeyGate] = useState<boolean | null>(null);
  useEffect(() => {
    if (!hydrated || keyGate != null) return;
    if (devBypassesOnboarding()) {
      setKeyGate(false);
      return;
    }
    // A locked/broken keychain hydrates secrets as null — the keys may exist
    // but be unreadable. Never force onboarding on top of that.
    if (secretReadsFailedThisSession()) {
      setKeyGate(false);
      return;
    }
    setKeyGate(
      needsKeyOnboarding({
        serverMode,
        // services.tmdb folds in an env-provided key; settings alone would
        // force dev builds that are actually configured.
        hasTmdb: services.tmdb != null,
        omdbKey: settings.omdbKey,
        hasDebrid: services.debrid?.hasServices === true,
      }),
    );
  }, [hydrated, keyGate, serverMode, settings.omdbKey, services]);
  // Server-Mode owner setup gate (null = undecided, false = skip/done/non-owner).
  const [serverSetup, setServerSetup] = useState<boolean | null>(null);
  // Tier-aware welcome (shown once, before the setup wizards, on a fresh start).
  const [welcomed, setWelcomed] = useState<boolean>(() => {
    try {
      return globalThis.localStorage?.getItem("ds_tier_welcomed") === "1";
    } catch {
      return true;
    }
  });
  const markWelcomed = () => {
    try {
      globalThis.localStorage?.setItem("ds_tier_welcomed", "1");
    } catch {
      // ignore (private mode)
    }
    setWelcomed(true);
  };

  useEffect(() => {
    void isFirstRun().then(setFirstRun);
  }, []);

  // Decide the Server-Mode setup gate once a session is known. Non-owners and
  // Local Mode resolve to false immediately; owners need the live credential
  // count from admin health to know whether the server still looks empty.
  useEffect(() => {
    if (!serverMode || session == null) {
      setServerSetup(false);
      return;
    }
    if (session.role !== "owner") {
      setServerSetup(false);
      return;
    }
    let cancelled = false;
    void fetchServerAdminHealth()
      .then((health) =>
        shouldShowServerSetup({
          role: session.role,
          credentialCount: health.counts.credentials,
        }),
      )
      .then((show) => {
        if (!cancelled) setServerSetup(show);
      })
      .catch(() => {
        // If health can't be read, never trap the owner behind setup.
        if (!cancelled) setServerSetup(false);
      });
    return () => {
      cancelled = true;
    };
  }, [serverMode, session]);

  // Wait for BOTH the relevant gate AND Store hydration before deciding. This
  // ensures the wizard's choice (e.g. Advanced → simpleMode false) is applied
  // AFTER hydration's setSettings, so a late hydration can't revert it.
  if (firstRun == null || serverSetup == null || keyGate == null || !hydrated) {
    return null;
  }
  // Tier-tailored welcome first, on a genuine fresh start (then the existing
  // mode-specific setup wizard collects the actual config).
  if (!welcomed && (firstRun || keyGate || serverSetup)) {
    return <TierOnboarding onDone={markWelcomed} />;
  }
  if (firstRun || keyGate) {
    return (
      <FirstRunWizard
        forced={keyGate}
        onDone={() => {
          setFirstRun(false);
          setKeyGate(false);
        }}
      />
    );
  }
  if (serverSetup) return <ServerSetupWizard onDone={() => setServerSetup(false)} />;
  return <App />;
}

export function App() {
  const { route, navigate, detailItem, browseContext, openDetail, search, settings, simpleMode, services } =
    useAppStore();

  // "Who's watching" picker visibility (Server Mode only; opened from the rail).
  const [profilePickerOpen, setProfilePickerOpen] = useState(false);

  // First-run feature tour. App only mounts past the setup wizards, so this is
  // the moment to greet a new user. Shown once (localStorage flag); existing
  // users see it once too, which doubles as a "what's new" for the latest
  // features. Re-openable from Settings / ⌘K via the window event below.
  const [welcomeGuideOpen, setWelcomeGuideOpen] = useState(false);
  useEffect(() => {
    try {
      if (globalThis.localStorage?.getItem("ds_welcome_guide_seen") !== "1") {
        setWelcomeGuideOpen(true);
      }
    } catch {
      // private mode — just skip the auto-tour
    }
    const reopen = () => setWelcomeGuideOpen(true);
    window.addEventListener("ds:open-welcome-guide", reopen);
    return () => window.removeEventListener("ds:open-welcome-guide", reopen);
  }, []);
  const closeWelcomeGuide = () => {
    setWelcomeGuideOpen(false);
    try {
      globalThis.localStorage?.setItem("ds_welcome_guide_seen", "1");
    } catch {
      // ignore (private mode)
    }
  };

  // On-demand guided setup: the SAME persona wizard a genuine first run shows,
  // re-runnable at any time. This is the clear onboarding path for installs
  // whose one-shot first-run flags were consumed long ago (webview storage
  // survives updates) but that were never actually configured. Opened from the
  // setup card below or via ⌘K ("Run guided setup") through `ds:open-first-run`.
  const [firstRunOpen, setFirstRunOpen] = useState(false);
  useEffect(() => {
    const openWizard = () => setFirstRunOpen(true);
    window.addEventListener("ds:open-first-run", openWizard);
    return () => window.removeEventListener("ds:open-first-run", openWizard);
  }, []);

  // App-wide keyboard-shortcuts reference, opened from ⌘K (no persistence — it's
  // a reference, not a one-time greeting).
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  useEffect(() => {
    const open = () => setShortcutsOpen(true);
    window.addEventListener("ds:open-shortcuts", open);
    return () => window.removeEventListener("ds:open-shortcuts", open);
  }, []);

  // Re-openable build-profile welcome (the first-run TierOnboarding), so a user
  // can revisit the "getting started" guidance from Settings after dismissing it.
  const [tierWelcomeOpen, setTierWelcomeOpen] = useState(false);
  useEffect(() => {
    const open = () => setTierWelcomeOpen(true);
    window.addEventListener("ds:open-tier-welcome", open);
    return () => window.removeEventListener("ds:open-tier-welcome", open);
  }, []);

  // Contextual "finish setup" nudge (Local Mode only): a dismissible bar shown
  // while the app can't stream yet — no debrid service, or no active source. It
  // auto-hides once setup is complete; dismissal is remembered so it never nags.
  const [nudgeDismissed, setNudgeDismissed] = useState(() => {
    try {
      return globalThis.localStorage?.getItem("ds_setup_nudge_dismissed") === "1";
    } catch {
      return false;
    }
  });
  const dismissNudge = () => {
    setNudgeDismissed(true);
    try {
      globalThis.localStorage?.setItem("ds_setup_nudge_dismissed", "1");
    } catch {
      // ignore (private mode)
    }
  };
  const needsSetup =
    !isServerMode() &&
    (!services.debrid?.hasServices ||
      (services.indexers?.activeIndexers?.length ?? 0) === 0);
  const showSetupNudge =
    needsSetup &&
    !nudgeDismissed &&
    route !== "settings" &&
    detailItem == null &&
    !welcomeGuideOpen &&
    !tierWelcomeOpen &&
    !firstRunOpen &&
    !shortcutsOpen;

  // Mobile-browser "add to home screen" card. Eligibility is static for the
  // session (platform + display-mode don't change mid-run); dismissal persists.
  const [installEligible] = useState(() => isInstallPromptEligible());
  const [installDismissed, setInstallDismissed] = useState(() => {
    try {
      return globalThis.localStorage?.getItem("ds_pwa_install_dismissed") === "1";
    } catch {
      return false;
    }
  });
  const dismissInstall = () => {
    setInstallDismissed(true);
    try {
      globalThis.localStorage?.setItem("ds_pwa_install_dismissed", "1");
    } catch {
      // ignore (private mode)
    }
  };
  // The setup nudge outranks it — one bottom card at a time.
  const showInstallPrompt =
    installEligible &&
    !installDismissed &&
    !showSetupNudge &&
    route !== "settings" &&
    detailItem == null &&
    !welcomeGuideOpen &&
    !tierWelcomeOpen &&
    !firstRunOpen &&
    !shortcutsOpen;

  // Smart preloading (invisible): while idle, warm the lazy Detail + Browse code
  // chunks so opening a title or "See all" is instant instead of waiting on a
  // chunk fetch. Off → metered users skip the background bytes.
  useEffect(() => {
    if (!isSmartPreloadEnabled()) return;
    whenIdle(() => {
      void import("./screens/Detail");
      void import("./screens/Browse");
    });
  }, []);

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
    // data-setup-nudge reserves scroll room under the fixed get-started card
    // (App.css) so the last content row is never stranded behind it.
    <div className="app" data-setup-nudge={showSetupNudge || showInstallPrompt || undefined}>
      <div className="aurora-glow" />

      <NavRail
        selected={route}
        onSelect={navigate}
        onSwitchProfile={() => setProfilePickerOpen(true)}
      />

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

      {/* "Who's watching" picker overlay (Server Mode only) — mounts above
          everything when opened from the rail's profile switcher. */}
      {profilePickerOpen && (
        <ProfilePicker onClose={() => setProfilePickerOpen(false)} />
      )}

      {/* ⌘K quick switcher — self-contained; hidden until invoked. */}
      <CommandPalette />

      {/* First-run feature tour (and re-openable from Settings / ⌘K). */}
      {welcomeGuideOpen && (
        <WelcomeGuide
          onClose={closeWelcomeGuide}
          onOpenSettings={() => navigate("settings")}
        />
      )}

      {shortcutsOpen && (
        <KeyboardShortcuts onClose={() => setShortcutsOpen(false)} />
      )}

      {tierWelcomeOpen && (
        <TierOnboarding onDone={() => setTierWelcomeOpen(false)} />
      )}

      {/* Re-run of the first-run persona wizard (full-screen; closes on done or
          skip — the wizard persists its own onboarding_completed flag). */}
      {firstRunOpen && <FirstRunWizard onDone={() => setFirstRunOpen(false)} />}

      {showSetupNudge && (
        <SetupNudge
          onStartWizard={() => setFirstRunOpen(true)}
          onShowTour={() => setWelcomeGuideOpen(true)}
          onDismiss={dismissNudge}
        />
      )}

      {showInstallPrompt && <InstallPrompt onDismiss={dismissInstall} />}

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
