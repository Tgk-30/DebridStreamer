// @vitest-environment jsdom
//
// A11y regression: the card itself is the single keyboard-accessible button
// (opens Detail); the hover Play/More-info affordances are decorative and must
// be aria-hidden (not exposed as unreachable interactive controls).

import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MediaCard } from "./MediaCard";
import type { MediaPreview } from "../models/media";

const appSettings = vi.hoisted(() => ({ showPosterRatings: true }));
vi.mock("../store/AppStore", () => ({
  useAppStore: () => ({ settings: appSettings }),
}));

const item: MediaPreview = { id: "tt1", type: "movie", title: "Inception" };

function renderCard(overrides: Partial<MediaPreview> = {}) {
  return render(<MediaCard item={{ ...item, ...overrides }} onSelect={() => {}} />);
}

describe("MediaCard poster rating badge", () => {
  it("shows a rated card's persistent badge only while the preference is on", () => {
    appSettings.showPosterRatings = true;
    const { rerender } = renderCard({ imdbRating: 8.2 });
    expect(screen.getByLabelText("Rating 8.2 out of 10")).toBeInTheDocument();

    appSettings.showPosterRatings = false;
    rerender(<MediaCard item={{ ...item, imdbRating: 8.2 }} onSelect={() => {}} />);
    expect(screen.queryByLabelText("Rating 8.2 out of 10")).toBeNull();
  });

  it("never shows a persistent badge for a ratingless card", () => {
    appSettings.showPosterRatings = true;
    renderCard();
    expect(screen.queryByLabelText(/Rating .* out of 10/)).toBeNull();
  });
});

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

describe("MediaCard watched badge", () => {
  it("renders a Watched badge only when watched is set", () => {
    const { rerender } = render(<MediaCard item={item} onSelect={() => {}} />);
    expect(screen.queryByLabelText("Watched")).toBeNull();

    rerender(<MediaCard item={item} onSelect={() => {}} watched />);
    expect(screen.getByLabelText("Watched")).toBeInTheDocument();
  });

  it("keeps the card a single button when the badge is shown (badge is not interactive)", () => {
    render(<MediaCard item={item} onSelect={() => {}} watched />);
    expect(screen.getAllByRole("button")).toHaveLength(1);
  });
});

describe("MediaCard poster fallback", () => {
  it("uses the designed fallback for both a missing and failed search-result poster", () => {
    const noPoster: MediaPreview = { ...item, id: "missing", posterPath: null };
    const { container, rerender } = render(<MediaCard item={noPoster} onSelect={() => {}} />);
    expect(container.querySelector(".media-card-fallback")).toBeInTheDocument();
    expect(container.querySelector(".media-card-fallback-initial")).toHaveTextContent("I");

    rerender(
      <MediaCard
        item={{ ...item, id: "failed", posterPath: "/missing-poster.jpg" }}
        onSelect={() => {}}
      />,
    );
    fireEvent.error(screen.getByRole("img", { name: "Inception" }));
    expect(container.querySelector(".media-card-fallback")).toBeInTheDocument();
    expect(container.querySelector("img")).toBeNull();
  });
});
