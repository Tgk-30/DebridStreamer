// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

vi.mock("./Icon", () => ({
  Icon: ({ name }: { name: string }) => <i data-icon={name} />,
}));
// useModalA11y touches focus/refs; a no-op ref keeps the test environment-free.
vi.mock("./useModalA11y", () => ({ useModalA11y: () => ({ current: null }) }));

import { KeyboardShortcuts } from "./KeyboardShortcuts";

afterEach(cleanup);

describe("KeyboardShortcuts", () => {
  it("renders the grouped shortcut reference", () => {
    render(<KeyboardShortcuts onClose={() => {}} />);
    expect(
      screen.getByRole("dialog", { name: "Keyboard shortcuts" }),
    ).toBeInTheDocument();
    // A representative row from the global + player groups.
    expect(screen.getByText("Open or close the command palette")).toBeInTheDocument();
    expect(screen.getByText("Play or pause")).toBeInTheDocument();
    expect(screen.getByText("Fullscreen")).toBeInTheDocument();
  });

  it("closes via the close button and the backdrop", () => {
    const onClose = vi.fn();
    const { container } = render(<KeyboardShortcuts onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.click(container.querySelector(".ksh-backdrop")!);
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("does not close when the dialog body is clicked", () => {
    const onClose = vi.fn();
    const { container } = render(<KeyboardShortcuts onClose={onClose} />);
    fireEvent.click(container.querySelector(".ksh-dialog")!);
    expect(onClose).not.toHaveBeenCalled();
  });
});
