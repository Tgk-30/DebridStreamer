// @vitest-environment jsdom
//
// Tests the onboarding setup nudge action wiring.

import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { SetupNudge } from "./SetupNudge";

describe("SetupNudge", () => {
  it("shows setup messaging and binds all actions", () => {
    const onStartWizard = vi.fn();
    const onShowTour = vi.fn();
    const onDismiss = vi.fn();

    render(
      <SetupNudge
        onStartWizard={onStartWizard}
        onShowTour={onShowTour}
        onDismiss={onDismiss}
      />,
    );

    expect(screen.getByText("Let's get you streaming")).toBeInTheDocument();
    expect(
      screen.getByRole("region", { name: "Streaming setup reminder" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.getByRole("button", { name: "Start guided setup" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Start guided setup" }));
    fireEvent.click(screen.getByRole("button", { name: "Show me around" }));
    fireEvent.click(screen.getByRole("button", { name: "Dismiss setup reminder" }));

    expect(onStartWizard).toHaveBeenCalledTimes(1);
    expect(onShowTour).toHaveBeenCalledTimes(1);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
