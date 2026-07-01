// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("./Icon", () => ({
  Icon: ({ name }: { name: string }) => <i data-icon={name} />,
}));

import { SetupNudge } from "./SetupNudge";

afterEach(cleanup);

describe("SetupNudge", () => {
  it("shows the finish-setup prompt", () => {
    render(<SetupNudge onOpenSettings={() => {}} onDismiss={() => {}} />);
    expect(screen.getByText("Finish setup to start streaming")).toBeInTheDocument();
  });

  it("routes to Settings and can be dismissed", async () => {
    const user = userEvent.setup();
    const onOpenSettings = vi.fn();
    const onDismiss = vi.fn();
    render(
      <SetupNudge onOpenSettings={onOpenSettings} onDismiss={onDismiss} />,
    );
    await user.click(screen.getByRole("button", { name: "Open Settings" }));
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
    await user.click(
      screen.getByRole("button", { name: "Dismiss setup reminder" }),
    );
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
