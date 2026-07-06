// @vitest-environment jsdom
//
// A11y regression: the card itself is the single keyboard-accessible button
// (opens Detail); the hover Play/More-info affordances are decorative and must
// be aria-hidden (not exposed as unreachable interactive controls).

import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MediaCard } from "./MediaCard";
import type { MediaPreview } from "../models/media";

const item: MediaPreview = { id: "tt1", type: "movie", title: "Inception" };
const ratedItem: MediaPreview = {
  id: "tt2",
  type: "movie",
  title: "Arrival",
  year: 2016,
  posterPath: "/arr.png",
  imdbRating: 7.4,
};

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

  it("renders a placeholder when no poster is available", () => {
    render(<MediaCard item={item} />);
    const placeholder = document.querySelector(".media-card-placeholder");
    expect(placeholder).not.toBeNull();
    expect(placeholder?.querySelector("svg")).not.toBeNull();
  });

  it("shows rating text and optional meta when year and rating are present", () => {
    const { container } = render(<MediaCard item={ratedItem} />);
    const title = container.querySelector(".media-card-title");
    const revealMeta = container.querySelector(".media-card-reveal-meta");
    expect(title).not.toBeNull();
    expect(title).toHaveTextContent("Arrival");
    expect(within(revealMeta as HTMLElement).getByText("2016")).toBeInTheDocument();
    expect(within(revealMeta as HTMLElement).getByText("7.4")).toBeInTheDocument();
  });

  it("calls onPlay and does not call onSelect when pressing the reveal play affordance", async () => {
    const onSelect = vi.fn();
    const onPlay = vi.fn();
    render(<MediaCard item={ratedItem} onSelect={onSelect} onPlay={onPlay} />);

    const playAction = document.querySelector(".media-card-play");
    expect(playAction).toBeTruthy();
    await userEvent.click(playAction!);

    expect(onPlay).toHaveBeenCalledWith(ratedItem);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("falls back to onSelect when onPlay is missing", async () => {
    const onSelect = vi.fn();
    render(<MediaCard item={ratedItem} onSelect={onSelect} />);

    const playAction = document.querySelector(".media-card-play");
    expect(playAction).toBeTruthy();
    await userEvent.click(playAction!);

    expect(onSelect).toHaveBeenCalledWith(ratedItem);
  });

  it("supports ready and corner labels as explicit badge and chip", () => {
    const itemWithCorner: MediaPreview = {
      ...ratedItem,
      id: "tt3",
      title: "Corner",
    };
    render(
      <MediaCard
        item={itemWithCorner}
        ready
        cornerLabel="S2 E5"
        progress={0.5}
      />,
    );

    expect(screen.getByText("Ready")).toBeInTheDocument();
    expect(screen.getByText("S2 E5")).toBeInTheDocument();
    const fill = document.querySelector(".media-card-progress-fill");
    expect(fill).toHaveStyle({ width: "50%" });
  });

  it("clamps progress outside 0..1 and still renders the progress bar", () => {
    const high = render(<MediaCard item={ratedItem} progress={1.8} />);
    expect(high.container.querySelector(".media-card-progress-fill")).toHaveStyle({
      width: "100%",
    });

    const low = render(
      <MediaCard item={{ ...ratedItem, id: "tt4", title: "Low" }} progress={-0.1} />,
    );
    expect(low.container.querySelector(".media-card-progress-fill")).toBeNull();
    expect(low.container.querySelector(".media-card-progress")).toBeNull();
  });

  it("hides shimmer after image load and keeps it on load-error fallback", async () => {
    const withPoster = {
      ...ratedItem,
      id: "tt5",
      title: "Loaded",
    };
    render(<MediaCard item={withPoster} />);

    const img = screen.getByRole("img") as HTMLImageElement;
    expect(document.querySelector(".media-card-shimmer")).toBeTruthy();

    fireEvent.load(img);
    expect(document.querySelector(".media-card-shimmer")).toBeNull();

    render(
      <MediaCard
        item={{ ...ratedItem, id: "tt6", title: "Errored", posterPath: "/err.png" }}
      />,
    );
    const secondImg = screen.getAllByRole("img").at(-1) as HTMLImageElement;
    expect(document.querySelector(".media-card-shimmer")).toBeTruthy();
    fireEvent.error(secondImg);
    expect(document.querySelector(".media-card-shimmer")).toBeNull();
  });

  it("skips loading shimmer when the image is already complete on mount", () => {
    const originalComplete = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, "complete");
    const originalNaturalWidth = Object.getOwnPropertyDescriptor(
      HTMLImageElement.prototype,
      "naturalWidth",
    );

    Object.defineProperty(HTMLImageElement.prototype, "complete", {
      configurable: true,
      get: () => true,
    });
    Object.defineProperty(HTMLImageElement.prototype, "naturalWidth", {
      configurable: true,
      get: () => 640,
    });

    try {
      render(<MediaCard item={ratedItem} />);
      expect(document.querySelector(".media-card-shimmer")).toBeNull();
    } finally {
      if (originalComplete != null) {
        Object.defineProperty(HTMLImageElement.prototype, "complete", originalComplete);
      }
      if (originalNaturalWidth != null) {
        Object.defineProperty(
          HTMLImageElement.prototype,
          "naturalWidth",
          originalNaturalWidth,
        );
      }
      expect(document.querySelector(".media-card-shimmer")).toBeNull();
    }
  });
});
