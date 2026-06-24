// @vitest-environment jsdom
//
// A11y regression: the card itself is the single keyboard-accessible button
// (opens Detail); the hover Play/More-info affordances are decorative and must
// be aria-hidden (not exposed as unreachable interactive controls).

import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MediaCard } from "./MediaCard";
import type { MediaPreview } from "../models/media";

const item: MediaPreview = { id: "tt1", type: "movie", title: "Inception" };

describe("MediaCard a11y", () => {
  it("exposes a single button with the title as its accessible name", () => {
    render(<MediaCard item={item} onSelect={() => {}} />);
    const buttons = screen.getAllByRole("button");
    expect(buttons).toHaveLength(1);
    expect(
      screen.getByRole("button", { name: "Inception" }),
    ).toBeInTheDocument();
  });

  it("marks the decorative hover actions aria-hidden", () => {
    const { container } = render(<MediaCard item={item} onSelect={() => {}} />);
    const actions = container.querySelector(".media-card-reveal-actions");
    expect(actions).not.toBeNull();
    expect(actions).toHaveAttribute("aria-hidden", "true");
  });

  it("invokes onSelect when the card is activated by keyboard", async () => {
    const onSelect = vi.fn();
    render(<MediaCard item={item} onSelect={onSelect} />);
    const card = screen.getByRole("button", { name: "Inception" });
    card.focus();
    await userEvent.keyboard("{Enter}");
    expect(onSelect).toHaveBeenCalledWith(item);
  });
});
