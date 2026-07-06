// @vitest-environment jsdom
//
// Tests rendering and dismissal paths for the keyboard shortcuts modal.

import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { KeyboardShortcuts } from "./KeyboardShortcuts";

describe("KeyboardShortcuts", () => {
  it("renders all shortcut groups and rows", () => {
    render(<KeyboardShortcuts onClose={() => {}} />);

    expect(screen.getByRole("dialog", { name: "Keyboard shortcuts" })).toBeInTheDocument();
    expect(screen.getByText("Anywhere")).toBeInTheDocument();
    expect(screen.getByText("Command palette")).toBeInTheDocument();
    expect(screen.getByText("Player")).toBeInTheDocument();
    expect(screen.getByText("Dialogs & tours")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Close" })).toBeInTheDocument();
    expect(screen.getByText("Jump to 0–90% of the runtime")).toBeInTheDocument();
  });

  it("closes when backdrop is clicked", async () => {
    const onClose = vi.fn();
    render(<KeyboardShortcuts onClose={onClose} />);
    const close = screen.getByText("Keyboard shortcuts").closest(".ksh-dialog");
    expect(close).not.toBeNull();
    if (close != null) {
      await userEvent.click(close);
      expect(onClose).not.toHaveBeenCalled();
    }

    const backdrop = close?.parentElement;
    expect(backdrop).not.toBeNull();
    await userEvent.click(backdrop as Element);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("calls onClose from the close button and top-level button", async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<KeyboardShortcuts onClose={onClose} />);

    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    const backdrop = screen.getByRole("dialog", { name: "Keyboard shortcuts" }).parentElement;
    expect(backdrop).not.toBeNull();
    await user.click(backdrop as Element);
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
