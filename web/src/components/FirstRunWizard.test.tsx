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
  debridTokens: [] as { service: string; apiToken: string }[],
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
  testDebridToken: vi.fn(),
}));

import { testDebridToken, testTmdbKey } from "../lib/onboardingValidation";
import { FirstRunWizard } from "./FirstRunWizard";

const testTmdbKeyMock = vi.mocked(testTmdbKey);
const testDebridTokenMock = vi.mocked(testDebridToken);

/** Click through choose → catalog with a validated key, landing on streaming. */
async function reachStreamingStep(user: ReturnType<typeof userEvent.setup>) {
  testTmdbKeyMock.mockResolvedValue("ok");
  await user.click(screen.getByText("Just watch on this device"));
  await user.type(screen.getByLabelText("TMDB API key"), "tmdb-key-1");
  await user.click(screen.getByRole("button", { name: "Test key & continue" }));
  await screen.findByRole("heading", { name: "Connect your debrid service" });
}

describe("FirstRunWizard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isTauriMock.mockReturnValue(false);
    settings.tmdbKey = "";
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
    // Not skipped yet — an honest warning stands in the way.
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
      screen.getByRole("heading", { name: "Power up search & artwork" }),
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
    await user.click(screen.getByRole("button", { name: "Test key & continue" }));
    expect(
      screen.getByText(
        "Enter your TMDB API key, or continue with the built-in catalog.",
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
    await user.click(screen.getByRole("button", { name: "Test key & continue" }));
    expect(
      await screen.findByText(
        "TMDB rejected that key — double-check it (use the v3 API key).",
      ),
    ).toBeInTheDocument();
    // Still on the catalog step, button usable again.
    expect(
      screen.getByRole("button", { name: "Test key & continue" }),
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
    // Take the no-key escape through catalog too — worst case for clobbering.
    await user.click(screen.getByText("Just watch on this device"));
    await user.click(
      screen.getByRole("button", { name: /Continue with the built-in catalog/ }),
    );
    await user.click(screen.getByRole("button", { name: /Add later/ }));
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
    expect(testDebridTokenMock).not.toHaveBeenCalled();
    expect(updateSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        tmdbKey: "existing-key",
        debridTokens: [{ service: "premiumize", apiToken: "pm-token" }],
      }),
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
        "Couldn't verify that token — check it and your connection.",
      ),
    ).toBeInTheDocument();
    expect(onDone).not.toHaveBeenCalled();
    // The escape hatch appears only after a failed check.
    await user.click(screen.getByRole("button", { name: /Save without testing/ }));
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

  it("'host' persona shows the web copy when not running under Tauri", async () => {
    const user = userEvent.setup();
    isTauriMock.mockReturnValue(false);
    render(<FirstRunWizard onDone={() => {}} />);
    await user.click(screen.getByText("Host for my family"));
    expect(
      screen.getByRole("heading", { name: "Host for your household" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Hosting runs in the desktop app/)).toBeInTheDocument();
  });

  it("'host' persona shows the desktop copy under Tauri", async () => {
    const user = userEvent.setup();
    isTauriMock.mockReturnValue(true);
    render(<FirstRunWizard onDone={() => {}} />);
    await user.click(screen.getByText("Host for my family"));
    expect(
      screen.getByText(/This computer can serve DebridStreamer/),
    ).toBeInTheDocument();
  });

  it("host step Continue finishes simple + navigates to settings", async () => {
    const user = userEvent.setup();
    const onDone = vi.fn();
    render(<FirstRunWizard onDone={onDone} />);
    await user.click(screen.getByText("Host for my family"));
    await user.click(screen.getByRole("button", { name: "Open Settings" }));
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
    expect(updateSettings).toHaveBeenCalledWith(
      expect.objectContaining({ simpleMode: true }),
    );
    expect(navigate).toHaveBeenCalledWith("settings");
  });

  it("host step Back returns to the choose screen", async () => {
    const user = userEvent.setup();
    render(<FirstRunWizard onDone={() => {}} />);
    await user.click(screen.getByText("Host for my family"));
    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(
      screen.getByText("How do you want to use DebridStreamer?"),
    ).toBeInTheDocument();
  });
});
