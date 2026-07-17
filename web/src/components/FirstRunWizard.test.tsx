// @vitest-environment jsdom
//
// Component coverage for the Local-Mode persona first-run wizard. Verifies the
// choose step renders all four personas, each persona routes correctly (device =
// forced catalog→streaming key steps, advanced = finish + navigate to settings,
// connect/host = sub steps), skip requires a confirm step, the connect-step
// fetch/validation/submit flow, and the host-step desktop-vs-web copy.

import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// --- mocks for every external dependency the component imports ---------------

const updateSettings = vi.fn();
const navigate = vi.fn();
const settings = {
  simpleMode: false,
  theme: "dark",
  tmdbKey: "",
  omdbKey: "",
  debridTokens: [] as { service: string; apiToken: string }[],
  aiProvider: "anthropic" as string,
  aiApiKey: "",
  ollamaEndpoint: "http://localhost:11434",
};

vi.mock("../store/AppStore", () => ({
  useAppStore: () => ({ settings, updateSettings, navigate }),
}));

const markOnboardingComplete = vi.fn().mockResolvedValue(undefined);
vi.mock("../lib/firstRun", () => ({
  markOnboardingComplete: () => markOnboardingComplete(),
}));

const saveServerURL = vi.fn();
vi.mock("../lib/serverMode", () => ({
  saveServerURL: (url: string | null) => saveServerURL(url),
}));

const isTauriMock = vi.fn(() => false);
vi.mock("../lib/tauri", () => ({
  isTauri: () => isTauriMock(),
}));

vi.mock("../lib/onboardingValidation", () => ({
  testTmdbKey: vi.fn(),
  testOmdbKey: vi.fn(),
  testDebridToken: vi.fn(),
}));
vi.mock("../lib/passwordHash", () => ({
  hashPassword: () => Promise.resolve("pbkdf2:v1:test"),
}));
vi.mock("../storage/ProfileRegistry", () => ({
  ensureDefaultProfile: () => Promise.resolve({ id: "default" }),
  updateProfileRecord: () => Promise.resolve(),
  setMultiUserEnabled: () => Promise.resolve(),
}));

import { testDebridToken, testOmdbKey, testTmdbKey } from "../lib/onboardingValidation";
import { FirstRunWizard } from "./FirstRunWizard";

const testTmdbKeyMock = vi.mocked(testTmdbKey);
const testOmdbKeyMock = vi.mocked(testOmdbKey);
const testDebridTokenMock = vi.mocked(testDebridToken);

/** After the streaming step completes, the optional AI step appears - dismiss
 *  it so the wizard finishes (finishDevice runs on skip). */
async function skipAi(user: ReturnType<typeof userEvent.setup>) {
  await screen.findByRole("heading", { name: "Add AI recommendations" });
  await user.click(screen.getByRole("button", { name: /Skip - add AI later/ }));
  await screen.findByRole("heading", { name: "Set up profiles" });
  await user.click(screen.getByRole("button", { name: "Continue" }));
}

async function finishProfiles(user: ReturnType<typeof userEvent.setup>) {
  await screen.findByRole("heading", { name: "Set up profiles" });
  await user.click(screen.getByRole("button", { name: "Continue" }));
}

/** Click through choose → catalog with a validated key, landing on streaming. */
async function reachStreamingStep(user: ReturnType<typeof userEvent.setup>) {
  testTmdbKeyMock.mockResolvedValue("ok");
  await user.click(screen.getByText("Just watch on this device"));
  await user.type(screen.getByLabelText("TMDB API key"), "tmdb-key-1");
  await user.click(screen.getByRole("button", { name: "Test keys & continue" }));
  await screen.findByRole("heading", { name: "Connect your debrid service" });
}

describe("FirstRunWizard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isTauriMock.mockReturnValue(false);
    settings.tmdbKey = "";
    settings.omdbKey = "";
    settings.debridTokens = [];
  });

  it("renders the choose step with all four personas and a skip button", () => {
    render(<FirstRunWizard onDone={() => {}} />);
    expect(
      screen.getByText("How do you want to use DebridStreamer?"),
    ).toBeInTheDocument();
    expect(screen.getByText("Just watch on this device")).toBeInTheDocument();
    expect(screen.getByText("Connect to a server")).toBeInTheDocument();
    expect(screen.getByText("Host for my family")).toBeInTheDocument();
    expect(screen.getByText("Advanced setup")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Skip for now" })).toBeInTheDocument();
  });

  it("Skip requires a confirm step; Go back returns, Skip anyway completes", async () => {
    const user = userEvent.setup();
    const onDone = vi.fn();
    render(<FirstRunWizard onDone={onDone} />);
    await user.click(screen.getByRole("button", { name: "Skip for now" }));
    // Not skipped yet - an honest warning stands in the way.
    expect(screen.getByText("Skip setup?")).toBeInTheDocument();
    expect(screen.getByText(/nothing will play/)).toBeInTheDocument();
    expect(onDone).not.toHaveBeenCalled();
    expect(markOnboardingComplete).not.toHaveBeenCalled();
    // Go back returns to the persona chooser.
    await user.click(screen.getByRole("button", { name: "Go back" }));
    expect(
      screen.getByText("How do you want to use DebridStreamer?"),
    ).toBeInTheDocument();
    // Skip anyway completes without touching settings.
    await user.click(screen.getByRole("button", { name: "Skip for now" }));
    await user.click(screen.getByRole("button", { name: "Skip anyway" }));
    await screen.findByRole("heading", { name: "Set up profiles" });
    await user.click(screen.getByRole("button", { name: "Continue" }));
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
    expect(markOnboardingComplete).toHaveBeenCalledTimes(1);
    expect(updateSettings).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });

  it("'device' persona opens the catalog key step instead of finishing", async () => {
    const user = userEvent.setup();
    const onDone = vi.fn();
    render(<FirstRunWizard onDone={onDone} />);
    await user.click(screen.getByText("Just watch on this device"));
    expect(
      screen.getByRole("heading", { name: "Connect your catalog" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("TMDB API key")).toBeInTheDocument();
    // Nothing is finalized by merely choosing the persona.
    expect(updateSettings).not.toHaveBeenCalled();
    expect(markOnboardingComplete).not.toHaveBeenCalled();
    expect(onDone).not.toHaveBeenCalled();
  });

  it("catalog step rejects an empty key locally without validating", async () => {
    const user = userEvent.setup();
    render(<FirstRunWizard onDone={() => {}} />);
    await user.click(screen.getByText("Just watch on this device"));
    await user.click(screen.getByRole("button", { name: "Test keys & continue" }));
    expect(
      screen.getByText(
        "Add a catalog key to continue - TMDB (free) powers browsing, artwork & banners; OMDb adds richer ratings. Either one unlocks the app.",
      ),
    ).toBeInTheDocument();
    expect(testTmdbKeyMock).not.toHaveBeenCalled();
  });

  it("catalog step shows the rejected-key error on unauthorized", async () => {
    const user = userEvent.setup();
    testTmdbKeyMock.mockResolvedValue("unauthorized");
    render(<FirstRunWizard onDone={() => {}} />);
    await user.click(screen.getByText("Just watch on this device"));
    await user.type(screen.getByLabelText("TMDB API key"), "bad-key");
    await user.click(screen.getByRole("button", { name: "Test keys & continue" }));
    expect(
      await screen.findByText(
        "TMDB rejected that key - double-check it (use the v3 API key).",
      ),
    ).toBeInTheDocument();
    // Still on the catalog step, button usable again.
    expect(
      screen.getByRole("button", { name: "Test keys & continue" }),
    ).toBeEnabled();
  });

  it("catalog step advances to streaming when the key validates", async () => {
    const user = userEvent.setup();
    render(<FirstRunWizard onDone={() => {}} />);
    await reachStreamingStep(user);
    expect(testTmdbKeyMock).toHaveBeenCalledWith("tmdb-key-1");
  });

  it("catalog escape advances without validating", async () => {
    const user = userEvent.setup();
    render(<FirstRunWizard onDone={() => {}} />);
    await user.click(screen.getByText("Just watch on this device"));
    await user.click(
      screen.getByRole("button", { name: /Continue with the built-in catalog/ }),
    );
    expect(
      screen.getByRole("heading", { name: "Connect your debrid service" }),
    ).toBeInTheDocument();
    expect(testTmdbKeyMock).not.toHaveBeenCalled();
  });

  it("streaming step saves key + verified token in a single settings update", async () => {
    const user = userEvent.setup();
    const onDone = vi.fn();
    testDebridTokenMock.mockResolvedValue(true);
    render(<FirstRunWizard onDone={onDone} />);
    await reachStreamingStep(user);
    await user.type(screen.getByLabelText("API token"), "rd-token-1");
    await user.click(screen.getByRole("button", { name: "Test token & finish" }));
    await skipAi(user);
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
    expect(testDebridTokenMock).toHaveBeenCalledWith({
      service: "real_debrid",
      apiToken: "rd-token-1",
    });
    expect(updateSettings).toHaveBeenCalledTimes(1);
    expect(updateSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        simpleMode: true,
        tmdbKey: "tmdb-key-1",
        debridTokens: [{ service: "real_debrid", apiToken: "rd-token-1" }],
      }),
    );
    expect(markOnboardingComplete).toHaveBeenCalledTimes(1);
  });

  it("streaming step replaces an existing token for the same service", async () => {
    const user = userEvent.setup();
    settings.debridTokens = [
      { service: "real_debrid", apiToken: "old-token" },
      { service: "torbox", apiToken: "tb-token" },
    ];
    testDebridTokenMock.mockResolvedValue(true);
    render(<FirstRunWizard onDone={() => {}} />);
    await reachStreamingStep(user);
    const tokenInput = screen.getByLabelText("API token");
    await user.clear(tokenInput);
    await user.type(tokenInput, "new-token");
    await user.click(screen.getByRole("button", { name: "Test token & finish" }));
    await skipAi(user);
    await waitFor(() => expect(updateSettings).toHaveBeenCalledTimes(1));
    expect(updateSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        debridTokens: [
          { service: "real_debrid", apiToken: "new-token" },
          { service: "torbox", apiToken: "tb-token" },
        ],
      }),
    );
  });

  it("streaming 'Add later' escape never clobbers existing tokens or key", async () => {
    const user = userEvent.setup();
    settings.tmdbKey = "existing-key";
    settings.debridTokens = [{ service: "premiumize", apiToken: "pm-token" }];
    const onDone = vi.fn();
    render(<FirstRunWizard onDone={onDone} />);
    // Take the no-key escape through catalog too - worst case for clobbering.
    await user.click(screen.getByText("Just watch on this device"));
    await user.click(
      screen.getByRole("button", { name: /Continue with the built-in catalog/ }),
    );
    await user.click(screen.getByRole("button", { name: /Add later/ }));
    await skipAi(user);
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
    expect(testDebridTokenMock).not.toHaveBeenCalled();
    expect(updateSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        tmdbKey: "existing-key",
        debridTokens: [{ service: "premiumize", apiToken: "pm-token" }],
      }),
    );
  });

  it("editing the token or switching service hides save-without-testing until retested", async () => {
    const user = userEvent.setup();
    settings.debridTokens = [{ service: "torbox", apiToken: "tb-token" }];
    testDebridTokenMock.mockResolvedValue(false);
    render(<FirstRunWizard onDone={() => {}} />);
    await reachStreamingStep(user);
    await user.click(screen.getByRole("button", { name: "Test token & finish" }));
    expect(
      await screen.findByRole("button", { name: /Save without testing/ }),
    ).toBeInTheDocument();
    // Switching provider invalidates the failed check - the hatch must hide - 
    // and swaps the token field to that service's stored token (or empty).
    await user.selectOptions(screen.getByLabelText("Provider"), "real_debrid");
    expect(
      screen.queryByRole("button", { name: /Save without testing/ }),
    ).not.toBeInTheDocument();
    expect(screen.getByLabelText("API token")).toHaveValue("");
    await user.selectOptions(screen.getByLabelText("Provider"), "torbox");
    expect(screen.getByLabelText("API token")).toHaveValue("tb-token");
    // Same for editing the token itself after a failed check.
    await user.click(screen.getByRole("button", { name: "Test token & finish" }));
    expect(
      await screen.findByRole("button", { name: /Save without testing/ }),
    ).toBeInTheDocument();
    await user.type(screen.getByLabelText("API token"), "x");
    expect(
      screen.queryByRole("button", { name: /Save without testing/ }),
    ).not.toBeInTheDocument();
  });

  it("validated TMDB key persists when the user picks Add later for debrid", async () => {
    const user = userEvent.setup();
    const onDone = vi.fn();
    render(<FirstRunWizard onDone={onDone} />);
    await reachStreamingStep(user);
    await user.click(screen.getByRole("button", { name: /Add later/ }));
    await skipAi(user);
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
    expect(updateSettings).toHaveBeenCalledWith(
      expect.objectContaining({ tmdbKey: "tmdb-key-1", debridTokens: [] }),
    );
  });

  it("streaming step hedges on a failed check and offers save-without-testing", async () => {
    const user = userEvent.setup();
    const onDone = vi.fn();
    testDebridTokenMock.mockResolvedValue(false);
    render(<FirstRunWizard onDone={onDone} />);
    await reachStreamingStep(user);
    await user.type(screen.getByLabelText("API token"), "maybe-token");
    await user.click(screen.getByRole("button", { name: "Test token & finish" }));
    expect(
      await screen.findByText(
        "Couldn't verify that token - it may be mistyped, or your browser may be blocked from reaching the provider.",
      ),
    ).toBeInTheDocument();
    expect(onDone).not.toHaveBeenCalled();
    // The escape hatch appears only after a failed check.
    await user.click(screen.getByRole("button", { name: /Save without testing/ }));
    await skipAi(user);
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
    expect(updateSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        debridTokens: [{ service: "real_debrid", apiToken: "maybe-token" }],
      }),
    );
  });

  it("'advanced' persona finishes in full mode and navigates to settings", async () => {
    const user = userEvent.setup();
    const onDone = vi.fn();
    render(<FirstRunWizard onDone={onDone} />);
    await user.click(screen.getByText("Advanced setup"));
    await screen.findByRole("heading", { name: "Set up profiles" });
    await user.click(screen.getByRole("button", { name: "Continue" }));
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
    expect(updateSettings).toHaveBeenCalledWith(
      expect.objectContaining({ simpleMode: false }),
    );
    expect(navigate).toHaveBeenCalledWith("settings");
  });

  it("'connect' persona shows the connect step and Back returns to choose", async () => {
    const user = userEvent.setup();
    render(<FirstRunWizard onDone={() => {}} />);
    await user.click(screen.getByText("Connect to a server"));
    expect(
      screen.getByRole("heading", { name: "Connect to a server" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Server address")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(
      screen.getByText("How do you want to use DebridStreamer?"),
    ).toBeInTheDocument();
  });

  it("connect step validates an empty address before fetching", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(<FirstRunWizard onDone={() => {}} />);
    await user.click(screen.getByText("Connect to a server"));
    await user.click(screen.getByRole("button", { name: "Connect" }));
    expect(screen.getByText("Enter your server address.")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("connect step normalizes a bare host, hits /api/health, saves and reloads on success", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal("fetch", fetchMock);
    const reload = vi.fn();
    vi.stubGlobal("location", { ...window.location, reload, origin: "http://x" });

    render(<FirstRunWizard onDone={() => {}} />);
    await user.click(screen.getByText("Connect to a server"));
    await user.type(
      screen.getByLabelText("Server address"),
      "stream.example.com",
    );
    await user.click(screen.getByRole("button", { name: "Connect" }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "https://stream.example.com/api/health",
        { credentials: "include" },
      ),
    );
    expect(markOnboardingComplete).toHaveBeenCalledTimes(1);
    expect(saveServerURL).toHaveBeenCalledWith("https://stream.example.com");
    expect(reload).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });

  it("connect step surfaces an error when the server responds non-ok", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 503 });
    vi.stubGlobal("fetch", fetchMock);

    render(<FirstRunWizard onDone={() => {}} />);
    await user.click(screen.getByText("Connect to a server"));
    await user.type(screen.getByLabelText("Server address"), "https://stream.example.com");
    await user.click(screen.getByRole("button", { name: "Connect" }));

    expect(
      await screen.findByText(/Couldn't reach that server \(Server responded 503\.\)/),
    ).toBeInTheDocument();
    // On failure it must NOT save or reload.
    expect(saveServerURL).not.toHaveBeenCalled();
    // Connect button re-enabled after failure.
    expect(screen.getByRole("button", { name: "Connect" })).toBeEnabled();
    vi.unstubAllGlobals();
  });

  it("connect step surfaces the fallback error message when fetch throws a non-Error", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockRejectedValue("network failed");
    vi.stubGlobal("fetch", fetchMock);

    render(<FirstRunWizard onDone={() => {}} />);
    await user.click(screen.getByText("Connect to a server"));
    await user.type(screen.getByLabelText("Server address"), "stream.example.com");
    await user.click(screen.getByRole("button", { name: "Connect" }));

    expect(await screen.findByText("Couldn't reach that server.")).toBeInTheDocument();
    expect(saveServerURL).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("'host' persona shows the web copy when not running under Tauri", async () => {
    const user = userEvent.setup();
    isTauriMock.mockReturnValue(false);
    render(<FirstRunWizard onDone={() => {}} />);
    await user.click(screen.getByRole("button", { name: /Host for my family/i }));
    expect(
      screen.getByRole("heading", { name: "Host for your household" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Hosting runs in the desktop app/)).toBeInTheDocument();
  });

  it("'host' persona shows the desktop copy under Tauri", async () => {
    const user = userEvent.setup();
    isTauriMock.mockReturnValue(true);
    render(<FirstRunWizard onDone={() => {}} />);
    await user.click(screen.getByRole("button", { name: /Host for my family/i }));
    expect(
      screen.getByText(/This computer can serve DebridStreamer/),
    ).toBeInTheDocument();
  });

  it("'host' persona enters host mode without finishing onboarding", async () => {
    const user = userEvent.setup();
    const onDone = vi.fn();
    render(<FirstRunWizard onDone={onDone} />);
    await user.click(screen.getByRole("button", { name: /Host for my family/i }));

    expect(screen.getByRole("button", { name: "Open Settings" })).toBeInTheDocument();
    expect(markOnboardingComplete).not.toHaveBeenCalled();
    expect(onDone).not.toHaveBeenCalled();
  });

  it("host step Continue finishes simple + navigates to settings", async () => {
    const user = userEvent.setup();
    const onDone = vi.fn();
    render(<FirstRunWizard onDone={onDone} />);
    await user.click(screen.getByRole("button", { name: /Host for my family/i }));
    await user.click(screen.getByRole("button", { name: "Open Settings" }));
    await screen.findByRole("heading", { name: "Set up profiles" });
    await user.click(screen.getByRole("button", { name: "Continue" }));
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
    expect(updateSettings).toHaveBeenCalledWith(
      expect.objectContaining({ simpleMode: true }),
    );
    expect(navigate).toHaveBeenCalledWith("settings");
  });

  it("host step Back returns to the choose screen", async () => {
    const user = userEvent.setup();
    render(<FirstRunWizard onDone={() => {}} />);
    await user.click(screen.getByRole("button", { name: /Host for my family/i }));
    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(
      screen.getByText("How do you want to use DebridStreamer?"),
    ).toBeInTheDocument();
  });
});

describe("FirstRunWizard - forced key gate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isTauriMock.mockReturnValue(false);
    settings.tmdbKey = "";
    settings.omdbKey = "";
    settings.debridTokens = [];
  });

  it("hides Skip on the chooser and states why setup is required", () => {
    render(<FirstRunWizard forced onDone={() => {}} />);
    expect(
      screen.queryByRole("button", { name: "Skip for now" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText(/needs its keys before it can search or stream/),
    ).toBeInTheDocument();
  });

  it("hides the keyless catalog escape but shows TMDB + optional OMDb fields", async () => {
    const user = userEvent.setup();
    render(<FirstRunWizard forced onDone={() => {}} />);
    await user.click(screen.getByText("Just watch on this device"));
    expect(
      screen.queryByRole("button", { name: /Continue with the built-in catalog/ }),
    ).not.toBeInTheDocument();
    // Both catalog fields are present at once - OMDb is optional, not a toggle.
    expect(screen.getByLabelText("TMDB API key")).toBeInTheDocument();
    expect(screen.getByLabelText(/OMDb API key/)).toBeInTheDocument();
    expect(screen.getByText("Optional")).toBeInTheDocument();
  });

  it("hides Add later on the streaming step", async () => {
    const user = userEvent.setup();
    testTmdbKeyMock.mockResolvedValue("ok");
    render(<FirstRunWizard forced onDone={() => {}} />);
    await user.click(screen.getByText("Just watch on this device"));
    await user.type(screen.getByLabelText("TMDB API key"), "tmdb-key-1");
    await user.click(screen.getByRole("button", { name: "Test keys & continue" }));
    await screen.findByRole("heading", { name: "Connect your debrid service" });
    expect(
      screen.queryByRole("button", { name: /Add later/ }),
    ).not.toBeInTheDocument();
    // The CORS-honest save-without-testing path must survive forced mode.
    testDebridTokenMock.mockResolvedValue(false);
    await user.type(screen.getByLabelText("API token"), "rd-token");
    await user.click(screen.getByRole("button", { name: "Test token & finish" }));
    expect(
      await screen.findByRole("button", { name: /Save without testing/ }),
    ).toBeInTheDocument();
  });

  it("accepts an OMDb-only catalog key (no TMDB) and saves it", async () => {
    const user = userEvent.setup();
    const onDone = vi.fn();
    testOmdbKeyMock.mockResolvedValue("ok");
    testDebridTokenMock.mockResolvedValue(true);
    render(<FirstRunWizard forced onDone={onDone} />);
    await user.click(screen.getByText("Just watch on this device"));
    // Fill only the optional OMDb field, leaving TMDB empty.
    await user.type(screen.getByLabelText(/OMDb API key/), "omdb-key-1");
    await user.click(screen.getByRole("button", { name: "Test keys & continue" }));
    await screen.findByRole("heading", { name: "Connect your debrid service" });
    expect(testOmdbKeyMock).toHaveBeenCalledWith("omdb-key-1");
    expect(testTmdbKeyMock).not.toHaveBeenCalled();
    await user.type(screen.getByLabelText("API token"), "rd-token-1");
    await user.click(screen.getByRole("button", { name: "Test token & finish" }));
    await skipAi(user);
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
    // OMDb saved, and the blank TMDB field is left as-is (not fabricated).
    expect(updateSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        omdbKey: "omdb-key-1",
        tmdbKey: "",
        debridTokens: [{ service: "real_debrid", apiToken: "rd-token-1" }],
      }),
    );
  });

  it("validates and saves BOTH keys when both are provided", async () => {
    const user = userEvent.setup();
    const onDone = vi.fn();
    testTmdbKeyMock.mockResolvedValue("ok");
    testOmdbKeyMock.mockResolvedValue("ok");
    testDebridTokenMock.mockResolvedValue(true);
    render(<FirstRunWizard forced onDone={onDone} />);
    await user.click(screen.getByText("Just watch on this device"));
    await user.type(screen.getByLabelText("TMDB API key"), "tmdb-key-1");
    await user.type(screen.getByLabelText(/OMDb API key/), "omdb-key-1");
    await user.click(screen.getByRole("button", { name: "Test keys & continue" }));
    await screen.findByRole("heading", { name: "Connect your debrid service" });
    expect(testTmdbKeyMock).toHaveBeenCalledWith("tmdb-key-1");
    expect(testOmdbKeyMock).toHaveBeenCalledWith("omdb-key-1");
    await user.type(screen.getByLabelText("API token"), "rd-token-1");
    await user.click(screen.getByRole("button", { name: "Test token & finish" }));
    await skipAi(user);
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
    expect(updateSettings).toHaveBeenCalledWith(
      expect.objectContaining({ tmdbKey: "tmdb-key-1", omdbKey: "omdb-key-1" }),
    );
  });

  it("a bad OMDb key blocks continuing even when TMDB is valid", async () => {
    const user = userEvent.setup();
    const onDone = vi.fn();
    testTmdbKeyMock.mockResolvedValue("ok");
    testOmdbKeyMock.mockResolvedValue("unauthorized");
    render(<FirstRunWizard forced onDone={onDone} />);
    await user.click(screen.getByText("Just watch on this device"));
    await user.type(screen.getByLabelText("TMDB API key"), "tmdb-key-1");
    await user.type(screen.getByLabelText(/OMDb API key/), "bad-omdb");
    await user.click(screen.getByRole("button", { name: "Test keys & continue" }));
    expect(await screen.findByText(/OMDb rejected that key/)).toBeInTheDocument();
    // Still on the catalog step; nothing saved.
    expect(
      screen.getByRole("heading", { name: "Connect your catalog" }),
    ).toBeInTheDocument();
    expect(onDone).not.toHaveBeenCalled();
    expect(updateSettings).not.toHaveBeenCalled();
  });
});

describe("FirstRunWizard - forced advanced/host route through keys", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isTauriMock.mockReturnValue(false);
    settings.tmdbKey = "";
    settings.omdbKey = "";
    settings.debridTokens = [];
  });

  async function completeKeySteps(user: ReturnType<typeof userEvent.setup>) {
    testTmdbKeyMock.mockResolvedValue("ok");
    testDebridTokenMock.mockResolvedValue(true);
    await user.type(screen.getByLabelText("TMDB API key"), "tmdb-key-1");
    await user.click(screen.getByRole("button", { name: "Test keys & continue" }));
    await screen.findByRole("heading", { name: "Connect your debrid service" });
    await user.type(screen.getByLabelText("API token"), "rd-token-1");
    await user.click(screen.getByRole("button", { name: "Test token & finish" }));
    await skipAi(user);
  }

  it("forced Advanced collects keys first, then lands in full-mode Settings", async () => {
    const user = userEvent.setup();
    const onDone = vi.fn();
    render(<FirstRunWizard forced onDone={onDone} />);
    await user.click(screen.getByText("Advanced setup"));
    // No keyless finish: the catalog step opens instead of settings.
    expect(
      screen.getByRole("heading", { name: "Connect your catalog" }),
    ).toBeInTheDocument();
    expect(markOnboardingComplete).not.toHaveBeenCalled();
    await completeKeySteps(user);
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
    expect(updateSettings).toHaveBeenCalledWith(
      expect.objectContaining({ simpleMode: false, tmdbKey: "tmdb-key-1" }),
    );
    expect(navigate).toHaveBeenCalledWith("settings");
  });

  it("forced Host explains hosting, then collects keys before Settings", async () => {
    const user = userEvent.setup();
    const onDone = vi.fn();
    render(<FirstRunWizard forced onDone={onDone} />);
    await user.click(screen.getByText("Host for my family"));
    await user.click(screen.getByRole("button", { name: "Open Settings" }));
    // Still inside the wizard - keys come first.
    expect(
      screen.getByRole("heading", { name: "Connect your catalog" }),
    ).toBeInTheDocument();
    expect(markOnboardingComplete).not.toHaveBeenCalled();
    await completeKeySteps(user);
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
    expect(updateSettings).toHaveBeenCalledWith(
      expect.objectContaining({ simpleMode: true, tmdbKey: "tmdb-key-1" }),
    );
    expect(navigate).toHaveBeenCalledWith("settings");
  });
});

describe("FirstRunWizard - optional AI step", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isTauriMock.mockReturnValue(false);
    settings.tmdbKey = "";
    settings.omdbKey = "";
    settings.debridTokens = [];
    settings.aiProvider = "anthropic";
    settings.aiApiKey = "";
    settings.ollamaEndpoint = "http://localhost:11434";
  });

  async function reachAiStep(user: ReturnType<typeof userEvent.setup>) {
    testTmdbKeyMock.mockResolvedValue("ok");
    testDebridTokenMock.mockResolvedValue(true);
    await user.click(screen.getByText("Just watch on this device"));
    await user.type(screen.getByLabelText("TMDB API key"), "tmdb-key-1");
    await user.click(screen.getByRole("button", { name: "Test keys & continue" }));
    await user.type(screen.getByLabelText("API token"), "rd-token-1");
    await user.click(screen.getByRole("button", { name: "Test token & finish" }));
    await screen.findByRole("heading", { name: "Add AI recommendations" });
  }

  it("is optional - Skip finishes without writing AI settings", async () => {
    const user = userEvent.setup();
    const onDone = vi.fn();
    render(<FirstRunWizard onDone={onDone} />);
    await reachAiStep(user);
    await user.click(screen.getByRole("button", { name: /Skip - add AI later/ }));
    await finishProfiles(user);
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
    // AI key left untouched (empty), and Save & finish was disabled while empty.
    expect(updateSettings).toHaveBeenCalledWith(
      expect.objectContaining({ aiApiKey: "" }),
    );
  });

  it("saves a cloud provider key on Save & finish", async () => {
    const user = userEvent.setup();
    const onDone = vi.fn();
    render(<FirstRunWizard onDone={onDone} />);
    await reachAiStep(user);
    await user.type(screen.getByLabelText("API key"), "sk-ant-123");
    await user.click(screen.getByRole("button", { name: "Save & finish" }));
    await finishProfiles(user);
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
    expect(updateSettings).toHaveBeenCalledWith(
      expect.objectContaining({ aiProvider: "anthropic", aiApiKey: "sk-ant-123" }),
    );
  });

  it("switches to a local endpoint field for Ollama and saves it", async () => {
    const user = userEvent.setup();
    const onDone = vi.fn();
    render(<FirstRunWizard onDone={onDone} />);
    await reachAiStep(user);
    await user.selectOptions(screen.getByLabelText("Provider"), "ollama");
    // The API key field is replaced by the endpoint field.
    expect(screen.queryByLabelText("API key")).not.toBeInTheDocument();
    const endpoint = screen.getByLabelText("Ollama endpoint");
    await user.clear(endpoint);
    await user.type(endpoint, "http://localhost:1234");
    await user.click(screen.getByRole("button", { name: "Save & finish" }));
    await finishProfiles(user);
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
    expect(updateSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        aiProvider: "ollama",
        ollamaEndpoint: "http://localhost:1234",
      }),
    );
  });
});
