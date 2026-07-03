// @vitest-environment jsdom
//
// Behavioral tests for the App shell (src/App.tsx). App is the router/layout:
// it picks which screen renders per `route`, mounts the NavRail, gates the
// Browse/Detail/ProfilePicker/WelcomeGuide overlays, decides whether the
// floating GlobalSearch shows, and redirects off hidden screens. We mock every
// screen + heavy child to stubs so we only exercise App's own logic.

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { cleanup, render, screen, fireEvent, waitFor } from "@testing-library/react";

// --- Store mock ---------------------------------------------------------
// App reads a slice of useAppStore; we drive it via a mutable object so each
// test can set route / detailItem / browseContext / simpleMode etc.

const navigate = vi.fn();
const openDetail = vi.fn();
const search = vi.fn();

type StoreSlice = {
  route: string;
  navigate: typeof navigate;
  detailItem: unknown;
  browseContext: unknown;
  openDetail: typeof openDetail;
  search: typeof search;
  settings: {
    autoUpdateChecks: boolean;
    autoInstallUpdates: boolean;
    tmdbKey: string;
    omdbKey: string;
  };
  simpleMode: boolean;
  hydrated: boolean;
  services: {
    debrid: { hasServices: boolean } | null;
    indexers: { activeIndexers: unknown[] } | null;
  };
};

let store: StoreSlice;

vi.mock("./store/AppStore", () => ({
  useAppStore: () => store,
}));

// --- serverMode / preload helpers ---------------------------------------

let serverModeValue = false;
vi.mock("./lib/serverMode", () => ({
  isServerMode: () => serverModeValue,
}));

let smartPreloadEnabled = false;
const whenIdle = vi.fn();
vi.mock("./lib/smartPreload", () => ({
  isSmartPreloadEnabled: () => smartPreloadEnabled,
  whenIdle: (fn: () => void) => whenIdle(fn),
}));

// useTheme is a thin DOM side-effect; stub to a no-op so jsdom stays clean.
vi.mock("./theme/useTheme", () => ({ useTheme: () => {} }));

// CSS imports are inert in jsdom; stub to keep things fast/safe.
vi.mock("./theme/theme.css", () => ({}));
vi.mock("./App.css", () => ({}));

// --- Screen stubs -------------------------------------------------------
// Each screen renders a unique marker so we can assert which one App routed to.
// Discover gets the openDetail handler so we can verify it's wired through.

vi.mock("./screens/Discover", () => ({
  Discover: ({ onSelect }: { onSelect: (i: unknown) => void }) => (
    <button data-testid="screen-discover" onClick={() => onSelect({ id: "x" })}>
      discover
    </button>
  ),
}));
vi.mock("./screens/Search", () => ({
  Search: () => <div data-testid="screen-search">search</div>,
}));
vi.mock("./screens/Library", () => ({
  Library: () => <div data-testid="screen-library">library</div>,
}));
vi.mock("./screens/Watchlist", () => ({
  Watchlist: () => <div data-testid="screen-watchlist">watchlist</div>,
}));
vi.mock("./screens/History", () => ({
  History: () => <div data-testid="screen-history">history</div>,
}));
vi.mock("./screens/Assistant", () => ({
  Assistant: () => <div data-testid="screen-assistant">assistant</div>,
}));
vi.mock("./screens/Calendar", () => ({
  Calendar: () => <div data-testid="screen-calendar">calendar</div>,
}));
vi.mock("./screens/DebridLibrary", () => ({
  DebridLibrary: () => <div data-testid="screen-debrid">debrid</div>,
}));
vi.mock("./screens/Settings", () => ({
  Settings: () => <div data-testid="screen-settings">settings</div>,
}));
vi.mock("./screens/Browse", () => ({
  Browse: () => <div data-testid="overlay-browse">browse</div>,
}));
vi.mock("./screens/Detail", () => ({
  Detail: () => <div data-testid="overlay-detail">detail</div>,
}));

// --- Child component stubs ----------------------------------------------
// Keep NavRail real-ish but light: stub it to surface the props App passes.

vi.mock("./components/NavRail", async () => {
  // isScreenHidden is pure + used by App's redirect effect; reuse the real one.
  const actual = await vi.importActual<typeof import("./components/NavRail")>(
    "./components/NavRail",
  );
  return {
    ...actual,
    NavRail: ({
      selected,
      onSelect,
      onSwitchProfile,
    }: {
      selected: string;
      onSelect: (s: string) => void;
      onSwitchProfile: () => void;
    }) => (
      <nav data-testid="nav-rail" data-selected={selected}>
        <button data-testid="nav-go-library" onClick={() => onSelect("library")}>
          go-library
        </button>
        <button data-testid="nav-switch-profile" onClick={onSwitchProfile}>
          switch
        </button>
      </nav>
    ),
  };
});

vi.mock("./components/GlobalSearch", () => ({
  GlobalSearch: ({ onSubmit }: { onSubmit: (q: string) => void }) => (
    <button data-testid="global-search" onClick={() => onSubmit("q")}>
      global-search
    </button>
  ),
}));

vi.mock("./components/Spinner", () => ({
  Spinner: ({ variant }: { variant?: string }) => (
    <div data-testid="spinner" data-variant={variant} />
  ),
}));

vi.mock("./components/ProfilePicker", () => ({
  ProfilePicker: ({ onClose }: { onClose: () => void }) => (
    <button data-testid="profile-picker" onClick={onClose}>
      profile-picker
    </button>
  ),
}));

vi.mock("./components/CommandPalette", () => ({
  CommandPalette: () => <div data-testid="command-palette" />,
}));

vi.mock("./components/WelcomeGuide", () => ({
  WelcomeGuide: ({ onClose }: { onClose: () => void }) => (
    <button data-testid="welcome-guide" onClick={onClose}>
      welcome-guide
    </button>
  ),
}));

vi.mock("./components/UpdateBanner", () => ({
  UpdateBanner: ({
    autoCheck,
    autoInstall,
  }: {
    autoCheck: boolean;
    autoInstall: boolean;
  }) => (
    <div
      data-testid="update-banner"
      data-auto-check={String(autoCheck)}
      data-auto-install={String(autoInstall)}
    />
  ),
}));

// FirstRunHost-only children (imported by App.tsx module). Stub so the module
// graph resolves without pulling their real (heavy) implementations.
vi.mock("./components/FirstRunWizard", () => ({
  FirstRunWizard: ({ onDone }: { onDone: () => void }) => (
    <button data-testid="first-run" onClick={onDone}>
      first-run
    </button>
  ),
}));
vi.mock("./components/ServerSetupWizard", () => ({
  ServerSetupWizard: ({ onDone }: { onDone: () => void }) => (
    <button data-testid="server-setup" onClick={onDone}>
      server-setup
    </button>
  ),
}));
vi.mock("./components/TierOnboarding", () => ({
  TierOnboarding: ({ onDone }: { onDone: () => void }) => (
    <button data-testid="tier-onboarding" onClick={onDone}>
      tier-onboarding
    </button>
  ),
}));

// FirstRunHost-controllable async gates (mutable so each test drives them).
let sessionValue: { role: string } | null = null;
vi.mock("./lib/ServerSessionContext", () => ({
  useServerSession: () => sessionValue,
}));

let firstRunValue = false;
let keyGateValue = false;
vi.mock("./lib/firstRun", () => ({
  isFirstRun: () => Promise.resolve(firstRunValue),
  devBypassesOnboarding: () => false,
  needsKeyOnboarding: () => keyGateValue,
}));

let serverSetupValue = false;
vi.mock("./lib/serverSetup", () => ({
  shouldShowServerSetup: () => Promise.resolve(serverSetupValue),
}));

let adminHealthCredentials = 0;
vi.mock("./lib/serverApi", () => ({
  fetchServerAdminHealth: () =>
    Promise.resolve({ counts: { credentials: adminHealthCredentials } }),
}));

import { App, FirstRunHost } from "./App";

// jsdom here exposes localStorage only on an opaque origin (no working
// setItem/clear), so install a tiny in-memory shim App can read/write.
function installLocalStorage() {
  const map = new Map<string, string>();
  const ls = {
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => void map.set(k, String(v)),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
    key: (i: number) => Array.from(map.keys())[i] ?? null,
    get length() {
      return map.size;
    },
  };
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: ls,
  });
}

// --- Fixtures -----------------------------------------------------------

function makeStore(over: Partial<StoreSlice> = {}): StoreSlice {
  return {
    route: "discover",
    navigate,
    detailItem: null,
    browseContext: null,
    openDetail,
    search,
    settings: { autoUpdateChecks: true, autoInstallUpdates: false, tmdbKey: "k", omdbKey: "" },
    simpleMode: false,
    hydrated: true,
    // Configured by default so the "finish setup" nudge stays hidden here.
    services: {
      debrid: { hasServices: true },
      indexers: { activeIndexers: [{}] },
    },
    ...over,
  };
}

beforeEach(() => {
  navigate.mockClear();
  openDetail.mockClear();
  search.mockClear();
  whenIdle.mockClear();
  serverModeValue = false;
  smartPreloadEnabled = false;
  sessionValue = null;
  firstRunValue = false;
  keyGateValue = false;
  serverSetupValue = false;
  adminHealthCredentials = 0;
  store = makeStore();
  installLocalStorage();
  // Default: the welcome-guide seen flag is set so the auto-tour is OFF unless
  // a test clears it. Keeps most tests free of the WelcomeGuide overlay.
  globalThis.localStorage.setItem("ds_welcome_guide_seen", "1");
});

afterEach(() => {
  cleanup();
  globalThis.localStorage.clear();
});

// -----------------------------------------------------------------------

describe("App routing", () => {
  const cases: Array<[string, string]> = [
    ["discover", "screen-discover"],
    ["search", "screen-search"],
    ["library", "screen-library"],
    ["watchlist", "screen-watchlist"],
    ["history", "screen-history"],
    ["assistant", "screen-assistant"],
    ["calendar", "screen-calendar"],
    ["debrid", "screen-debrid"],
    ["settings", "screen-settings"],
  ];

  for (const [route, testid] of cases) {
    it(`renders the ${route} screen for route="${route}"`, async () => {
      store = makeStore({ route });
      render(<App />);
      expect(await screen.findByTestId(testid)).toBeInTheDocument();
    });
  }

  it("passes the active route to the NavRail as `selected`", () => {
    store = makeStore({ route: "library" });
    render(<App />);
    expect(screen.getByTestId("nav-rail")).toHaveAttribute("data-selected", "library");
  });

  it("wires NavRail onSelect to the store's navigate", () => {
    render(<App />);
    fireEvent.click(screen.getByTestId("nav-go-library"));
    expect(navigate).toHaveBeenCalledWith("library");
  });

  it("wires Discover onSelect to openDetail", () => {
    render(<App />);
    fireEvent.click(screen.getByTestId("screen-discover"));
    expect(openDetail).toHaveBeenCalledWith({ id: "x" });
  });
});

describe("Setup nudge", () => {
  it("shows the finish-setup nudge when Local Mode has no debrid", () => {
    store = makeStore({
      services: { debrid: null, indexers: { activeIndexers: [{}] } },
    });
    render(<App />);
    expect(screen.getByText("Let's get you streaming")).toBeInTheDocument();
  });

  it("shows the nudge when there is no active source", () => {
    store = makeStore({
      services: { debrid: { hasServices: true }, indexers: { activeIndexers: [] } },
    });
    render(<App />);
    expect(screen.getByText("Let's get you streaming")).toBeInTheDocument();
  });

  it("hides the nudge once a debrid + source are configured", () => {
    store = makeStore(); // configured by default
    render(<App />);
    expect(screen.queryByText("Let's get you streaming")).toBeNull();
  });

  it("hides the nudge on the Settings screen", () => {
    store = makeStore({
      route: "settings",
      services: { debrid: null, indexers: { activeIndexers: [] } },
    });
    render(<App />);
    expect(screen.queryByText("Let's get you streaming")).toBeNull();
  });
});

describe("GlobalSearch visibility", () => {
  it("shows the floating search on discover", () => {
    store = makeStore({ route: "discover" });
    render(<App />);
    expect(screen.getByTestId("global-search")).toBeInTheDocument();
  });

  it.each(["settings", "search", "calendar", "debrid", "assistant"])(
    "hides the floating search on %s",
    (route) => {
      store = makeStore({ route });
      render(<App />);
      expect(screen.queryByTestId("global-search")).not.toBeInTheDocument();
    },
  );

  it("hides the floating search when a detailItem is open", () => {
    store = makeStore({ route: "discover", detailItem: { id: "a" } });
    render(<App />);
    expect(screen.queryByTestId("global-search")).not.toBeInTheDocument();
  });

  it("hides the floating search when a browseContext is open", () => {
    store = makeStore({ route: "discover", browseContext: { kind: "category" } });
    render(<App />);
    expect(screen.queryByTestId("global-search")).not.toBeInTheDocument();
  });

  it("wires GlobalSearch onSubmit to the store's search", () => {
    store = makeStore({ route: "discover" });
    render(<App />);
    fireEvent.click(screen.getByTestId("global-search"));
    expect(search).toHaveBeenCalledWith("q");
  });
});

describe("Browse + Detail overlays", () => {
  it("mounts neither overlay by default", () => {
    render(<App />);
    expect(screen.queryByTestId("overlay-browse")).not.toBeInTheDocument();
    expect(screen.queryByTestId("overlay-detail")).not.toBeInTheDocument();
  });

  it("mounts the Browse overlay when browseContext is set", async () => {
    store = makeStore({ browseContext: { kind: "category" } });
    render(<App />);
    expect(await screen.findByTestId("overlay-browse")).toBeInTheDocument();
    expect(screen.queryByTestId("overlay-detail")).not.toBeInTheDocument();
  });

  it("mounts the Detail overlay when detailItem is set", async () => {
    store = makeStore({ detailItem: { id: "a" } });
    render(<App />);
    expect(await screen.findByTestId("overlay-detail")).toBeInTheDocument();
  });

  it("mounts both overlays together (Detail over Browse)", async () => {
    store = makeStore({
      browseContext: { kind: "category" },
      detailItem: { id: "a" },
    });
    render(<App />);
    expect(await screen.findByTestId("overlay-browse")).toBeInTheDocument();
    expect(await screen.findByTestId("overlay-detail")).toBeInTheDocument();
  });
});

describe("ProfilePicker gating", () => {
  it("does not render the picker until the rail requests it", () => {
    render(<App />);
    expect(screen.queryByTestId("profile-picker")).not.toBeInTheDocument();
  });

  it("opens the picker from the rail and closes it via onClose", () => {
    render(<App />);
    fireEvent.click(screen.getByTestId("nav-switch-profile"));
    expect(screen.getByTestId("profile-picker")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("profile-picker"));
    expect(screen.queryByTestId("profile-picker")).not.toBeInTheDocument();
  });
});

describe("CommandPalette + UpdateBanner globals", () => {
  it("always renders the CommandPalette", () => {
    render(<App />);
    expect(screen.getByTestId("command-palette")).toBeInTheDocument();
  });

  it("forwards update settings to the UpdateBanner", () => {
    store = makeStore({
      settings: { autoUpdateChecks: false, autoInstallUpdates: true, tmdbKey: "k", omdbKey: "" },
    });
    render(<App />);
    const banner = screen.getByTestId("update-banner");
    expect(banner).toHaveAttribute("data-auto-check", "false");
    expect(banner).toHaveAttribute("data-auto-install", "true");
  });
});

describe("WelcomeGuide auto-tour", () => {
  it("auto-opens when the seen flag is absent", () => {
    globalThis.localStorage.removeItem("ds_welcome_guide_seen");
    render(<App />);
    expect(screen.getByTestId("welcome-guide")).toBeInTheDocument();
  });

  it("stays closed when the seen flag is set", () => {
    render(<App />); // beforeEach set the flag
    expect(screen.queryByTestId("welcome-guide")).not.toBeInTheDocument();
  });

  it("closing the guide persists the seen flag and unmounts it", () => {
    globalThis.localStorage.removeItem("ds_welcome_guide_seen");
    render(<App />);
    fireEvent.click(screen.getByTestId("welcome-guide"));
    expect(screen.queryByTestId("welcome-guide")).not.toBeInTheDocument();
    expect(globalThis.localStorage.getItem("ds_welcome_guide_seen")).toBe("1");
  });

  it("re-opens on the ds:open-welcome-guide window event", () => {
    render(<App />); // closed (flag set)
    expect(screen.queryByTestId("welcome-guide")).not.toBeInTheDocument();
    fireEvent(window, new Event("ds:open-welcome-guide"));
    expect(screen.getByTestId("welcome-guide")).toBeInTheDocument();
  });
});

describe("hidden-screen redirect effect", () => {
  it("redirects to discover when on a Simple-mode-hidden screen", async () => {
    store = makeStore({ route: "assistant", simpleMode: true });
    render(<App />);
    await waitFor(() => expect(navigate).toHaveBeenCalledWith("discover"));
  });

  it("redirects to discover when on a Server-mode-hidden screen (debrid)", async () => {
    serverModeValue = true;
    store = makeStore({ route: "debrid", simpleMode: false });
    render(<App />);
    await waitFor(() => expect(navigate).toHaveBeenCalledWith("discover"));
  });

  it("does not redirect when the current screen is visible", () => {
    store = makeStore({ route: "library", simpleMode: false });
    render(<App />);
    expect(navigate).not.toHaveBeenCalled();
  });
});

describe("smart preload effect", () => {
  it("skips idle preloading when disabled", () => {
    smartPreloadEnabled = false;
    render(<App />);
    expect(whenIdle).not.toHaveBeenCalled();
  });

  it("schedules idle preloading when enabled", () => {
    smartPreloadEnabled = true;
    render(<App />);
    expect(whenIdle).toHaveBeenCalledTimes(1);
  });
});

// -----------------------------------------------------------------------
// FirstRunHost — the async wizard gate that decides between TierOnboarding,
// FirstRunWizard, ServerSetupWizard, and the App itself. It returns null until
// BOTH the relevant async gate AND store hydration resolve, so most assertions
// use findBy* / waitFor to let the effects settle.
// -----------------------------------------------------------------------

describe("FirstRunHost gating", () => {
  it("renders nothing until the store has hydrated", async () => {
    store = makeStore({ hydrated: false });
    const { container } = render(<FirstRunHost />);
    // firstRun resolves to false, but hydrated=false keeps it null-rendering.
    await waitFor(() => {
      // nothing meaningful mounted (no app, no wizard markers).
      expect(screen.queryByTestId("nav-rail")).not.toBeInTheDocument();
      expect(screen.queryByTestId("first-run")).not.toBeInTheDocument();
    });
    expect(container).toBeEmptyDOMElement();
  });

  it("renders the App once hydrated with no first-run and no server setup", async () => {
    // welcomed flag set so TierOnboarding never shows; not first-run.
    globalThis.localStorage.setItem("ds_tier_welcomed", "1");
    render(<FirstRunHost />);
    expect(await screen.findByTestId("nav-rail")).toBeInTheDocument();
  });

  it("shows TierOnboarding first on a genuine local first-run, then the FirstRunWizard", async () => {
    firstRunValue = true;
    globalThis.localStorage.removeItem("ds_tier_welcomed");
    render(<FirstRunHost />);

    // Tier welcome precedes the persona wizard on a fresh start.
    const tier = await screen.findByTestId("tier-onboarding");
    expect(tier).toBeInTheDocument();
    expect(screen.queryByTestId("first-run")).not.toBeInTheDocument();

    // Acknowledging the welcome persists the flag and reveals the FirstRunWizard.
    fireEvent.click(tier);
    expect(await screen.findByTestId("first-run")).toBeInTheDocument();
    expect(globalThis.localStorage.getItem("ds_tier_welcomed")).toBe("1");
  });

  it("skips TierOnboarding when already welcomed and goes straight to the FirstRunWizard", async () => {
    firstRunValue = true;
    globalThis.localStorage.setItem("ds_tier_welcomed", "1");
    render(<FirstRunHost />);
    expect(await screen.findByTestId("first-run")).toBeInTheDocument();
    expect(screen.queryByTestId("tier-onboarding")).not.toBeInTheDocument();
  });

  it("completing the FirstRunWizard reveals the App", async () => {
    firstRunValue = true;
    globalThis.localStorage.setItem("ds_tier_welcomed", "1");
    render(<FirstRunHost />);
    fireEvent.click(await screen.findByTestId("first-run"));
    expect(await screen.findByTestId("nav-rail")).toBeInTheDocument();
  });

  it("forces the wizard when keys are missing even after onboarding completed", async () => {
    firstRunValue = false; // onboarding_completed is set…
    keyGateValue = true; // …but the launch found no catalog key / debrid token
    globalThis.localStorage.setItem("ds_tier_welcomed", "1");
    render(<FirstRunHost />);
    expect(await screen.findByTestId("first-run")).toBeInTheDocument();
  });

  it("key-gated wizard completion reveals the App for this session", async () => {
    firstRunValue = false;
    keyGateValue = true;
    globalThis.localStorage.setItem("ds_tier_welcomed", "1");
    render(<FirstRunHost />);
    fireEvent.click(await screen.findByTestId("first-run"));
    expect(await screen.findByTestId("nav-rail")).toBeInTheDocument();
  });

  it("shows the ServerSetupWizard for a fresh server when the owner has no credentials", async () => {
    serverModeValue = true;
    sessionValue = { role: "owner" };
    serverSetupValue = true; // shouldShowServerSetup → true
    adminHealthCredentials = 0;
    globalThis.localStorage.setItem("ds_tier_welcomed", "1");
    render(<FirstRunHost />);
    expect(await screen.findByTestId("server-setup")).toBeInTheDocument();
  });

  it("completing the ServerSetupWizard reveals the App", async () => {
    serverModeValue = true;
    sessionValue = { role: "owner" };
    serverSetupValue = true;
    globalThis.localStorage.setItem("ds_tier_welcomed", "1");
    render(<FirstRunHost />);
    fireEvent.click(await screen.findByTestId("server-setup"));
    expect(await screen.findByTestId("nav-rail")).toBeInTheDocument();
  });

  it("skips server setup for a non-owner session (resolves straight to App)", async () => {
    serverModeValue = true;
    sessionValue = { role: "member" };
    serverSetupValue = true; // would show, but non-owner short-circuits to false
    globalThis.localStorage.setItem("ds_tier_welcomed", "1");
    render(<FirstRunHost />);
    expect(await screen.findByTestId("nav-rail")).toBeInTheDocument();
    expect(screen.queryByTestId("server-setup")).not.toBeInTheDocument();
  });

  it("falls back to the tier-welcome safely when localStorage throws", async () => {
    // Private-mode style: getItem throws → welcomed defaults to true, so no
    // TierOnboarding even on a first-run; the FirstRunWizard shows directly.
    firstRunValue = true;
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: {
        getItem: () => {
          throw new Error("blocked");
        },
        setItem: () => {
          throw new Error("blocked");
        },
        removeItem: () => {},
        clear: () => {},
        key: () => null,
        length: 0,
      },
    });
    render(<FirstRunHost />);
    expect(await screen.findByTestId("first-run")).toBeInTheDocument();
    expect(screen.queryByTestId("tier-onboarding")).not.toBeInTheDocument();
  });
});
