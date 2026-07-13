// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("./MediaCard", () => ({
  MediaCard: ({
    item,
    onSelect,
    progress,
  }: {
    item: { id: string; title: string };
    onSelect?: (i: { id: string; title: string }) => void;
    progress?: number;
  }) => (
    <button data-progress={progress ?? ""} onClick={() => onSelect?.(item)}>
      {item.title}
    </button>
  ),
}));

import { MediaGrid, VirtualMediaGrid, mediaKey } from "./MediaGrid";
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

  it("forwards per-item progress to the matching card only", () => {
    render(<MediaGrid items={items} progress={{ a: 0.5 }} />);
    expect(screen.getByText("Alpha")).toHaveAttribute("data-progress", "0.5");
    expect(screen.getByText("Beta")).toHaveAttribute("data-progress", "");
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

  it("uses distinct UI keys for mixed movie and series TMDB ids", () => {
    const movie = { id: "tmdb-42", type: "movie" as const, title: "Movie" };
    const series = { id: "tmdb-42", type: "series" as const, title: "Series" };
    expect(mediaKey(movie)).not.toBe(mediaKey(series));
  });

  it("renders a contiguous moving window and preserves total spacer height", () => {
    const virtualItems: MediaPreview[] = Array.from({ length: 20 }, (_, index) => ({
      id: `item-${index}`,
      type: "movie",
      title: String(index),
    }));
    let shellTop = 0;
    let nextFrame = 1;
    const frames = new Map<number, FrameRequestCallback>();
    const innerHeight = window.innerHeight;

    Object.defineProperty(window, "innerHeight", { configurable: true, value: 200 });
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      const id = nextFrame++;
      frames.set(id, callback);
      return id;
    });
    vi.stubGlobal("cancelAnimationFrame", (id: number) => {
      frames.delete(id);
    });
    const style = vi.spyOn(window, "getComputedStyle").mockImplementation(
      () =>
        ({
          gridTemplateColumns: "100px 100px",
          rowGap: "10px",
        }) as CSSStyleDeclaration,
    );
    const geometry = vi
      .spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockImplementation(function (this: HTMLElement) {
        const element = this;
        if (element.classList.contains("media-grid")) {
          const rows = Math.ceil(element.children.length / 2);
          return makeRect(0, rows === 0 ? 0 : rows * 100 + (rows - 1) * 10);
        }
        if (element.classList.contains("media-grid-virtual")) {
          return makeRect(shellTop, 1_090);
        }
        return makeRect(0, 0);
      });

    try {
      const { container } = render(
        <VirtualMediaGrid
          items={virtualItems}
          estimatedRowHeight={100}
          renderItem={(item) => <span data-testid="virtual-item">{item.title}</span>}
        />,
      );
      const shell = container.querySelector(".media-grid-virtual") as HTMLElement;
      const spacers = shell.querySelectorAll(":scope > div");
      const rendered = () =>
        screen.getAllByTestId("virtual-item").map((node) => Number(node.textContent));
      const totalHeight = () =>
        Number.parseFloat((spacers[0] as HTMLElement).style.height) +
        shell.querySelector(".media-grid")!.getBoundingClientRect().height +
        Number.parseFloat((spacers[2] as HTMLElement).style.height);

      expect(rendered()).toEqual(Array.from({ length: 10 }, (_, index) => index));
      expect(totalHeight()).toBe(1_090);

      shellTop = -550;
      act(() => {
        fireEvent.scroll(document);
        fireEvent.scroll(document);
        fireEvent.scroll(document);
      });
      expect(frames.size).toBe(1);
      act(() => {
        const callback = [...frames.values()][0];
        frames.clear();
        callback(0);
      });

      expect(rendered()).toEqual(Array.from({ length: 16 }, (_, index) => index + 4));
      expect(new Set(rendered()).size).toBe(rendered().length);
      expect((spacers[0] as HTMLElement).style.height).toBe("220px");
      expect((spacers[2] as HTMLElement).style.height).toBe("0px");
      expect(totalHeight()).toBe(1_090);
    } finally {
      style.mockRestore();
      geometry.mockRestore();
      vi.unstubAllGlobals();
      Object.defineProperty(window, "innerHeight", {
        configurable: true,
        value: innerHeight,
      });
    }
  });
});

function makeRect(top: number, height: number): DOMRect {
  return {
    x: 0,
    y: top,
    top,
    right: 0,
    bottom: top + height,
    left: 0,
    width: 0,
    height,
    toJSON: () => ({}),
  };
}
