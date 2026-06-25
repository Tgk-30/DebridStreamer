// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Spinner } from "./Spinner";

describe("Spinner", () => {
  it("renders an inline status by default with a fallback Loading sr-only label", () => {
    const { container } = render(<Spinner />);
    const status = screen.getByRole("status");
    expect(status).toHaveClass("spinner-wrap", "spinner-inline");
    expect(status).toHaveAttribute("aria-live", "polite");
    // No visible label, but the sr-only fallback reads "Loading".
    expect(container.querySelector(".spinner-label")).toBeNull();
    expect(screen.getByText("Loading")).toHaveClass("sr-only");
  });

  it("shows the provided label both visibly and as the sr-only text", () => {
    render(<Spinner label="Fetching streams" />);
    // Appears twice: visible label + sr-only.
    const matches = screen.getAllByText("Fetching streams");
    expect(matches).toHaveLength(2);
  });

  it("applies the overlay variant class", () => {
    render(<Spinner variant="overlay" />);
    expect(screen.getByRole("status")).toHaveClass("spinner-overlay");
  });
});
