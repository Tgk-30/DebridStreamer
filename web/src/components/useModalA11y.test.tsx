// @vitest-environment jsdom
//
// Tests the shared dialog a11y hook: focus-on-open, Escape-to-close, and
// focus-restore on close.

import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { useModalA11y } from "./useModalA11y";

function Dialog({ onClose }: { onClose: () => void }) {
  const ref = useModalA11y<HTMLDivElement>(onClose);
  return (
    <div ref={ref} role="dialog" aria-label="Test" tabIndex={-1}>
      <button type="button">Inside</button>
    </div>
  );
}

function key(k: string) {
  window.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true }));
}

describe("useModalA11y", () => {
  it("focuses the dialog container on open", () => {
    render(<Dialog onClose={() => {}} />);
    expect(screen.getByRole("dialog")).toHaveFocus();
  });

  it("calls onClose when Escape is pressed", () => {
    const onClose = vi.fn();
    render(<Dialog onClose={onClose} />);
    key("Escape");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does not call onClose for other keys", () => {
    const onClose = vi.fn();
    render(<Dialog onClose={onClose} />);
    key("Enter");
    key("a");
    expect(onClose).not.toHaveBeenCalled();
  });

  it("restores focus to the trigger on unmount", () => {
    const trigger = document.createElement("button");
    document.body.appendChild(trigger);
    trigger.focus();
    expect(trigger).toHaveFocus();

    const { unmount } = render(<Dialog onClose={() => {}} />);
    expect(screen.getByRole("dialog")).toHaveFocus(); // moved into dialog
    unmount();
    expect(trigger).toHaveFocus(); // restored
    trigger.remove();
  });
});
