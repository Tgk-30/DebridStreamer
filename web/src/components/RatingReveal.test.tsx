// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { RatingReveal } from "./RatingReveal";

describe("RatingReveal", () => {
  it("shows a plain 'Rate' button and hides the stars until clicked (unrated)", () => {
    render(<RatingReveal scale="ten" value={null} onRate={() => {}} />);
    expect(screen.getByRole("button", { name: "Rate" })).toBeInTheDocument();
    // The rating radiogroup is not in the DOM until revealed.
    expect(screen.queryByRole("radiogroup")).toBeNull();
  });

  it("shows the current rating on the button when already rated", () => {
    render(<RatingReveal scale="ten" value={8} onRate={() => {}} />);
    expect(
      screen.getByRole("button", { name: "Your rating: 8/10" }),
    ).toBeInTheDocument();
  });

  it("uses the 0-100 scale label when the scale is hundred", () => {
    render(<RatingReveal scale="hundred" value={40} onRate={() => {}} />);
    expect(
      screen.getByRole("button", { name: "Your rating: 40/100" }),
    ).toBeInTheDocument();
  });

  it("reveals the RatingControl on click", async () => {
    render(<RatingReveal scale="ten" value={null} onRate={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: "Rate" }));

    expect(
      screen.getByRole("radiogroup", { name: "Rate out of 10" }),
    ).toBeInTheDocument();
    // The collapsed "Rate" button is gone once the control is revealed.
    expect(screen.queryByRole("button", { name: "Rate" })).toBeNull();
  });

  it("keeps click + keyboard quick-rating working once revealed", async () => {
    const onRate = vi.fn();
    render(<RatingReveal scale="ten" value={null} onRate={onRate} />);
    await userEvent.click(screen.getByRole("button", { name: "Rate" }));

    // Click a star.
    await userEvent.click(screen.getByLabelText("8 out of 10"));
    expect(onRate).toHaveBeenLastCalledWith(8);

    // Keyboard quick-rate on the revealed radiogroup.
    const group = screen.getByRole("radiogroup", { name: "Rate out of 10" });
    fireEvent.keyDown(group, { key: "3" });
    expect(onRate).toHaveBeenLastCalledWith(3);
  });

  it("dismisses with Done or Escape without clearing a saved rating", async () => {
    const onClear = vi.fn();
    render(<RatingReveal scale="ten" value={8} onRate={() => {}} onClear={onClear} />);

    await userEvent.click(screen.getByRole("button", { name: "Your rating: 8/10" }));
    expect(screen.getByRole("radiogroup", { name: "Rate out of 10" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(screen.getByRole("button", { name: "Your rating: 8/10" })).toBeInTheDocument();
    expect(onClear).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: "Your rating: 8/10" }));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.getByRole("button", { name: "Your rating: 8/10" })).toBeInTheDocument();
    expect(onClear).not.toHaveBeenCalled();
  });
});
