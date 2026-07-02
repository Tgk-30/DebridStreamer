// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("./Icon", () => ({
  Icon: ({ name }: { name: string }) => <i data-icon={name} />,
}));

import { SetupNudge } from "./SetupNudge";

afterEach(cleanup);

function renderNudge(
  overrides: Partial<Parameters<typeof SetupNudge>[0]> = {},
) {
  const props = {
    onStartWizard: vi.fn(),
    onShowTour: vi.fn(),
    onDismiss: vi.fn(),
    ...overrides,
  };
  render(<SetupNudge {...props} />);
  return props;
}

describe("SetupNudge", () => {
  it("shows the get-started prompt", () => {
    renderNudge();
    expect(screen.getByText("Let's get you streaming")).toBeInTheDocument();
  });

  it("starts the guided setup wizard", async () => {
    const user = userEvent.setup();
    const { onStartWizard } = renderNudge();
    await user.click(
      screen.getByRole("button", { name: "Start guided setup" }),
    );
    expect(onStartWizard).toHaveBeenCalledTimes(1);
  });

  it("opens the welcome tour", async () => {
    const user = userEvent.setup();
    const { onShowTour } = renderNudge();
    await user.click(screen.getByRole("button", { name: "Show me around" }));
    expect(onShowTour).toHaveBeenCalledTimes(1);
  });

  it("can be dismissed", async () => {
    const user = userEvent.setup();
    const { onDismiss } = renderNudge();
    await user.click(
      screen.getByRole("button", { name: "Dismiss setup reminder" }),
    );
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
