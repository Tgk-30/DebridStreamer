// @vitest-environment jsdom
//
// Render/behavior tests for UpdateBanner: the launch-time check gate
// (autoCheck), the null render when no update is available, the available
// (idle) state, the Install flow (installing -> determinate/indeterminate
// progress -> error), Retry, auto-install, and Dismiss.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { PendingUpdate } from "../lib/updater";

// The single dependency the component imports: lib/updater.checkForUpdates.
const checkForUpdates = vi.fn<() => Promise<PendingUpdate | null>>();

vi.mock("../lib/updater", () => ({
  checkForUpdates: () => checkForUpdates(),
}));

// Icon renders an inline SVG that hard-depends on lucide-react; stub it to a
// data-name span so the component tree is trivial to assert on.
vi.mock("./Icon", () => ({
  Icon: ({ name }: { name: string }) => <span data-icon={name} />,
}));

import { UpdateBanner } from "./UpdateBanner";

/** A PendingUpdate whose install() never resolves on success but can be made to
 * reject, and which records the onProgress callback so tests can drive it. */
function makeUpdate(
  version: string,
  install: PendingUpdate["install"],
): PendingUpdate {
  return { version, currentVersion: "0.0.0", notes: null, install };
}

beforeEach(() => {
  checkForUpdates.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("UpdateBanner", () => {
  it("renders nothing and never checks when autoCheck is false", async () => {
    checkForUpdates.mockResolvedValue(makeUpdate("9.9.9", vi.fn()));
    const { container } = render(
      <UpdateBanner autoCheck={false} autoInstall={false} />,
    );
    // Give any effect a chance to (not) run.
    await Promise.resolve();
    expect(checkForUpdates).not.toHaveBeenCalled();
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing when the check resolves null (no update / browser)", async () => {
    checkForUpdates.mockResolvedValue(null);
    const { container } = render(
      <UpdateBanner autoCheck autoInstall={false} />,
    );
    await waitFor(() => expect(checkForUpdates).toHaveBeenCalledTimes(1));
    expect(container.firstChild).toBeNull();
  });

  it("shows the available (idle) banner with version, Install and Dismiss", async () => {
    checkForUpdates.mockResolvedValue(makeUpdate("1.2.3", vi.fn()));
    render(<UpdateBanner autoCheck autoInstall={false} />);

    await screen.findByText("Update v1.2.3 available");
    expect(
      screen.getByText("A new version of DebridStreamer is ready to install."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Install" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Dismiss update notification" }),
    ).toBeInTheDocument();
    // role=status / aria-live container present.
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("dismissing the idle banner unmounts it", async () => {
    checkForUpdates.mockResolvedValue(makeUpdate("1.0.0", vi.fn()));
    const { container } = render(
      <UpdateBanner autoCheck autoInstall={false} />,
    );
    const user = userEvent.setup();
    await screen.findByText("Update v1.0.0 available");
    await user.click(
      screen.getByRole("button", { name: "Dismiss update notification" }),
    );
    expect(container.firstChild).toBeNull();
  });

  it("dismisses an update banner and suppresses re-render", async () => {
    checkForUpdates.mockResolvedValue(makeUpdate("1.3.0", vi.fn()));
    const { container } = render(
      <UpdateBanner autoCheck autoInstall={false} />,
    );
    const user = userEvent.setup();

    await screen.findByText("Update v1.3.0 available");
    await user.click(
      screen.getByRole("button", { name: "Dismiss update notification" }),
    );

    expect(container.firstChild).toBeNull();
  });

  it("Install drives a determinate progress bar from onProgress fractions", async () => {
    let report: ((f: number | null) => void) | undefined;
    // install() that captures onProgress and stays pending (never resolves).
    const install = vi.fn((onProgress?: (f: number | null) => void) => {
      report = onProgress;
      return new Promise<void>(() => {});
    });
    checkForUpdates.mockResolvedValue(makeUpdate("2.0.0", install));
    render(<UpdateBanner autoCheck autoInstall={false} />);
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "Install" }));
    expect(install).toHaveBeenCalledTimes(1);

    // Initial installing state, progress starts at 0%.
    await screen.findByText("Installing… 0%");
    // Drive a mid fraction -> rounded percent + determinate bar.
    report?.(0.42);
    await screen.findByText("Installing… 42%");

    const bar = screen.getByRole("progressbar");
    expect(bar).toHaveAttribute("aria-valuenow", "42");
    expect(bar.className).not.toContain("is-indeterminate");

    // While installing, the Install and Dismiss buttons are gone.
    expect(screen.queryByRole("button", { name: "Install" })).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Dismiss update notification" }),
    ).toBeNull();
  });

  it("clamps the fraction to 0..1 before formatting the percent", async () => {
    let report: ((f: number | null) => void) | undefined;
    const install = vi.fn((onProgress?: (f: number | null) => void) => {
      report = onProgress;
      return new Promise<void>(() => {});
    });
    checkForUpdates.mockResolvedValue(makeUpdate("2.1.0", install));
    render(<UpdateBanner autoCheck autoInstall={false} />);
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "Install" }));
    report?.(1.8); // over 1 -> clamps to 100%
    await screen.findByText("Installing… 100%");
  });

  it("renders an indeterminate bar when onProgress reports null", async () => {
    let report: ((f: number | null) => void) | undefined;
    const install = vi.fn((onProgress?: (f: number | null) => void) => {
      report = onProgress;
      return new Promise<void>(() => {});
    });
    checkForUpdates.mockResolvedValue(makeUpdate("3.0.0", install));
    render(<UpdateBanner autoCheck autoInstall={false} />);
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "Install" }));
    report?.(null);

    // Title without a percent, and the indeterminate class on the bar.
    await screen.findByText("Installing…");
    const bar = screen.getByRole("progressbar");
    expect(bar.className).toContain("is-indeterminate");
    expect(bar).not.toHaveAttribute("aria-valuenow");
  });

  it("shows the error state and Retry when install rejects", async () => {
    const install = vi.fn(() => Promise.reject(new Error("nope")));
    checkForUpdates.mockResolvedValue(makeUpdate("4.5.6", install));
    render(<UpdateBanner autoCheck autoInstall={false} />);
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "Install" }));

    await screen.findByText("Update failed");
    expect(
      screen.getByText("Couldn't install v4.5.6. Try again later."),
    ).toBeInTheDocument();
    // Error icon is "info".
    expect(document.querySelector('[data-icon="info"]')).not.toBeNull();
    // Retry + Dismiss are both available in the error state.
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Dismiss update notification" }),
    ).toBeInTheDocument();
  });

  it("Retry re-invokes install after an error", async () => {
    const install = vi
      .fn()
      .mockRejectedValueOnce(new Error("first fail"))
      .mockImplementationOnce(() => new Promise<void>(() => {}));
    checkForUpdates.mockResolvedValue(makeUpdate("5.0.0", install));
    render(<UpdateBanner autoCheck autoInstall={false} />);
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "Install" }));
    await screen.findByText("Update failed");

    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(install).toHaveBeenCalledTimes(2);
    // The retry attempt enters the installing state again.
    await screen.findByText("Installing… 0%");
  });

  it("auto-installs immediately when autoInstall is true (no Install click)", async () => {
    const install = vi.fn(() => new Promise<void>(() => {}));
    checkForUpdates.mockResolvedValue(makeUpdate("6.0.0", install));
    render(<UpdateBanner autoCheck autoInstall />);

    // Goes straight to installing without the user pressing anything.
    await screen.findByText("Installing… 0%");
    expect(install).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: "Install" })).toBeNull();
  });

  it("auto-install surfaces the error state when install rejects", async () => {
    const install = vi.fn(() => Promise.reject(new Error("boom")));
    checkForUpdates.mockResolvedValue(makeUpdate("7.0.0", install));
    render(<UpdateBanner autoCheck autoInstall />);

    await screen.findByText("Update failed");
    expect(
      screen.getByText("Couldn't install v7.0.0. Try again later."),
    ).toBeInTheDocument();
  });

  it("ignores late update results after unmount", async () => {
    let resolve: ((value: PendingUpdate | null) => void) | undefined;
    const pending = new Promise<PendingUpdate | null>((r) => {
      resolve = r;
    });
    const install = vi.fn();
    checkForUpdates.mockReturnValue(pending);

    const { unmount } = render(<UpdateBanner autoCheck autoInstall={false} />);
    unmount();

    expect(checkForUpdates).toHaveBeenCalledTimes(1);
    resolve?.(makeUpdate("9.9.9", install));

    await pending;
    expect(install).not.toHaveBeenCalled();
  });
});
