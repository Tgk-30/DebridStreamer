// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("./MediaCard", () => ({
  MediaCard: ({
    item,
    progress,
  }: {
    item: { id: string; title: string };
    progress?: number;
  }) => (
    <div data-testid="card" data-progress={progress ?? ""}>
      {item.title}
    </div>
  ),
}));

import { Rail } from "./Rail";
import type { MediaPreview } from "../models/media";

const items: MediaPreview[] = [
  { id: "a", type: "movie", title: "Alpha" },
  { id: "b", type: "series", title: "Beta" },
];

describe("Rail", () => {
  it("renders the title and a card per item", () => {
    render(<Rail title="Trending" items={items} />);
    expect(
      screen.getByRole("heading", { name: "Trending" }),
    ).toBeInTheDocument();
    expect(screen.getAllByTestId("card")).toHaveLength(2);
  });

  it("renders nothing when there are no items", () => {
    const { container } = render(<Rail title="Trending" items={[]} />);
    expect(container.querySelector(".rail")).toBeNull();
  });

  it("omits the See all affordance unless onSeeAll is provided", () => {
    render(<Rail title="Trending" items={items} />);
    expect(
      screen.queryByRole("button", { name: /See all/ }),
    ).not.toBeInTheDocument();
  });

  it("fires onSeeAll when the See all button is clicked", async () => {
    const onSeeAll = vi.fn();
    render(<Rail title="Trending" items={items} onSeeAll={onSeeAll} />);
    await userEvent.click(screen.getByRole("button", { name: /See all/ }));
    expect(onSeeAll).toHaveBeenCalledTimes(1);
  });

  it("passes per-item resume progress to the matching card", () => {
    render(<Rail title="Trending" items={items} progressById={{ a: 0.4 }} />);
    const cards = screen.getAllByTestId("card");
    expect(cards[0]).toHaveAttribute("data-progress", "0.4");
    expect(cards[1]).toHaveAttribute("data-progress", "");
  });
});
