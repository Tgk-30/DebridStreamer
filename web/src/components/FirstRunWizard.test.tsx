// @vitest-environment jsdom
//
// Component coverage for the Local-Mode persona first-run wizard. Verifies the
// choose step renders all four personas, each persona routes correctly (device =
// finish simple, advanced = finish + navigate to settings, connect/host = sub
// steps), skip + back navigation, the connect-step fetch/validation/submit flow,
// and the host-step desktop-vs-web copy.

import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// --- mocks for every external dependency the component imports ---------------

const updateSettings = vi.fn();
const navigate = vi.fn();
const settings = { simpleMode: false, theme: "dark" };

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

import { FirstRunWizard } from "./FirstRunWizard";

describe("FirstRunWizard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isTauriMock.mockReturnValue(false);
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

  it("Skip marks onboarding complete and calls onDone", async () => {
    const user = userEvent.setup();
    const onDone = vi.fn();
    render(<FirstRunWizard onDone={onDone} />);
    await user.click(screen.getByRole("button", { name: "Skip for now" }));
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
    expect(markOnboardingComplete).toHaveBeenCalledTimes(1);
    // Skip does not touch settings.
    expect(updateSettings).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });

  it("'device' persona finishes in simple mode and calls onDone", async () => {
    const user = userEvent.setup();
    const onDone = vi.fn();
    render(<FirstRunWizard onDone={onDone} />);
    await user.click(screen.getByText("Just watch on this device"));
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
    expect(updateSettings).toHaveBeenCalledWith(
      expect.objectContaining({ simpleMode: true }),
    );
    expect(markOnboardingComplete).toHaveBeenCalledTimes(1);
    expect(navigate).not.toHaveBeenCalled();
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
