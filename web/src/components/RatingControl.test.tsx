// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { RatingControl } from "./RatingControl";

describe("RatingControl - 1–10 stars", () => {
  it("exposes radio semantics with one checked star and one tab stop", () => {
    render(<RatingControl scale="ten" value={7} onRate={() => {}} />);
    const group = screen.getByRole("radiogroup", { name: "Rate out of 10" });
    expect(group).toBeTruthy();
    const seven = screen.getByLabelText("7 out of 10");
    expect(seven.getAttribute("aria-checked")).toBe("true");
    expect(seven.getAttribute("tabindex")).toBe("0");
    // Non-selected pips are not tab stops.
    expect(screen.getByLabelText("3 out of 10").getAttribute("tabindex")).toBe(
      "-1",
    );
    expect(screen.getByText("7/10")).toBeTruthy();
  });

  it("makes pip 1 the tab stop when nothing is rated yet", () => {
    render(<RatingControl scale="ten" value={null} onRate={() => {}} />);
    expect(screen.getByLabelText("1 out of 10").getAttribute("tabindex")).toBe(
      "0",
    );
    expect(screen.getByLabelText("5 out of 10").getAttribute("tabindex")).toBe(
      "-1",
    );
  });

  it("rates on click", async () => {
    const onRate = vi.fn();
    render(<RatingControl scale="ten" value={null} onRate={onRate} />);
    await userEvent.click(screen.getByLabelText("8 out of 10"));
    expect(onRate).toHaveBeenCalledWith(8);
  });

  it("moves the choice with arrow / Home / End keys", () => {
    const onRate = vi.fn();
    render(<RatingControl scale="ten" value={5} onRate={onRate} />);
    const group = screen.getByRole("radiogroup", { name: "Rate out of 10" });
    fireEvent.keyDown(group, { key: "ArrowRight" });
    expect(onRate).toHaveBeenLastCalledWith(6);
    fireEvent.keyDown(group, { key: "ArrowLeft" });
    expect(onRate).toHaveBeenLastCalledWith(4);
    fireEvent.keyDown(group, { key: "Home" });
    expect(onRate).toHaveBeenLastCalledWith(1);
    fireEvent.keyDown(group, { key: "End" });
    expect(onRate).toHaveBeenLastCalledWith(10);
  });

  it("quick-rates with number keys (1–9, and 0 → 10)", () => {
    const onRate = vi.fn();
    render(<RatingControl scale="ten" value={5} onRate={onRate} />);
    const group = screen.getByRole("radiogroup", { name: "Rate out of 10" });
    fireEvent.keyDown(group, { key: "7" });
    expect(onRate).toHaveBeenLastCalledWith(7);
    fireEvent.keyDown(group, { key: "0" });
    expect(onRate).toHaveBeenLastCalledWith(10);
    fireEvent.keyDown(group, { key: "1" });
    expect(onRate).toHaveBeenLastCalledWith(1);
  });

  it("clamps arrow movement at the ends", () => {
    const onRate = vi.fn();
    const { rerender } = render(
      <RatingControl scale="ten" value={10} onRate={onRate} />,
    );
    const group = screen.getByRole("radiogroup", { name: "Rate out of 10" });
    fireEvent.keyDown(group, { key: "ArrowRight" });
    expect(onRate).not.toHaveBeenCalled(); // already at 10, no-op
    rerender(<RatingControl scale="ten" value={1} onRate={onRate} />);
    fireEvent.keyDown(group, { key: "ArrowLeft" });
    expect(onRate).not.toHaveBeenCalled(); // already at 1, no-op
  });
});

describe("RatingControl - 0–100 slider", () => {
  it("commits only on release, and only when the value changed", () => {
    const onRate = vi.fn();
    render(<RatingControl scale="hundred" value={40} onRate={onRate} />);
    const slider = screen.getByLabelText("Rate out of 100");
    // Release without moving → no write.
    fireEvent.pointerUp(slider);
    expect(onRate).not.toHaveBeenCalled();
    // Drag then release → one write with the new value.
    fireEvent.change(slider, { target: { value: "85" } });
    expect(onRate).not.toHaveBeenCalled();
    fireEvent.pointerUp(slider);
    expect(onRate).toHaveBeenCalledExactlyOnceWith(85);
  });

  it("shows a 'release to save' affordance while dragging, cleared on commit", () => {
    render(<RatingControl scale="hundred" value={40} onRate={() => {}} />);
    const slider = screen.getByLabelText("Rate out of 100");
    const wrap = slider.closest(".rating-hundred") as HTMLElement;
    expect(wrap.className).not.toContain("is-dragging");
    fireEvent.change(slider, { target: { value: "70" } });
    expect(wrap.className).toContain("is-dragging");
    expect(screen.getByText("Release to save")).toBeTruthy();
    fireEvent.pointerUp(slider);
    expect(wrap.className).not.toContain("is-dragging");
  });

  it("commits on blur (covers pointer-cancel / focus-out)", () => {
    const onRate = vi.fn();
    render(<RatingControl scale="hundred" value={40} onRate={onRate} />);
    const slider = screen.getByLabelText("Rate out of 100");
    fireEvent.change(slider, { target: { value: "12" } });
    fireEvent.blur(slider);
    expect(onRate).toHaveBeenCalledExactlyOnceWith(12);
  });

  it("resets the draft to 50 when the saved value clears (new unrated title)", () => {
    const onRate = vi.fn();
    const { rerender } = render(
      <RatingControl scale="hundred" value={90} onRate={onRate} />,
    );
    expect(screen.getByText("90/100")).toBeTruthy();
    // Navigate to an unrated title: value → null must not keep 90 around.
    rerender(<RatingControl scale="hundred" value={null} onRate={onRate} />);
    expect(screen.getByText("50/100")).toBeTruthy();
    // And releasing without moving must not commit the stale 90.
    fireEvent.pointerUp(screen.getByLabelText("Rate out of 100"));
    expect(onRate).not.toHaveBeenCalled();
  });
});

describe("RatingControl - clear", () => {
  it("shows Clear only when rated AND onClear is provided, and fires it", async () => {
    const onClear = vi.fn();
    const { rerender } = render(
      <RatingControl scale="ten" value={7} onRate={() => {}} onClear={onClear} />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(onClear).toHaveBeenCalledTimes(1);

    // Not rated yet → no Clear.
    rerender(
      <RatingControl scale="ten" value={null} onRate={() => {}} onClear={onClear} />,
    );
    expect(screen.queryByRole("button", { name: "Clear" })).toBeNull();

    // Rated but no onClear handler → no Clear.
    rerender(<RatingControl scale="ten" value={7} onRate={() => {}} />);
    expect(screen.queryByRole("button", { name: "Clear" })).toBeNull();
  });
});
