// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("./MediaCard", () => ({
  MediaCard: ({
    item,
    onSelect,
  }: {
    item: { id: string; title: string };
    onSelect?: (i: { id: string; title: string }) => void;
  }) => (
    <button onClick={() => onSelect?.(item)}>{item.title}</button>
  ),
}));

import { MediaGrid } from "./MediaGrid";
import type { MediaPreview } from "../models/media";

const items: MediaPreview[] = [
  { id: "a", type: "movie", title: "Alpha" },
  { id: "b", type: "series", title: "Beta" },
];

describe("MediaGrid", () => {
  it("renders a card per item inside the grid", () => {
    const { container } = render(<MediaGrid items={items} />);
    expect(container.querySelector(".media-grid")).not.toBeNull();
    expect(screen.getByText("Alpha")).toBeInTheDocument();
    expect(screen.getByText("Beta")).toBeInTheDocument();
  });

  it("forwards onSelect from the card", async () => {
    const onSelect = vi.fn();
    render(<MediaGrid items={items} onSelect={onSelect} />);
    await userEvent.click(screen.getByText("Beta"));
    expect(onSelect).toHaveBeenCalledWith(items[1]);
  });

  it("renders the empty node when there are no items", () => {
    render(<MediaGrid items={[]} empty={<div>Nothing here</div>} />);
    expect(screen.getByText("Nothing here")).toBeInTheDocument();
  });

  it("renders nothing when empty and no empty node is provided", () => {
    const { container } = render(<MediaGrid items={[]} />);
    expect(container.querySelector(".media-grid")).toBeNull();
    expect(container.textContent).toBe("");
  });
});
