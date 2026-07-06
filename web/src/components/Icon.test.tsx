// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { Icon } from "./Icon";

describe("Icon", () => {
  it("renders play icons as filled by default", () => {
    const { container } = render(<Icon name="play" />);
    const svg = container.querySelector("svg");

    expect(svg).not.toBeNull();
    expect(svg).toHaveAttribute("fill", "currentColor");
    expect(svg).toHaveAttribute("stroke-width", "0");
  });

  it("renders star icons as filled by default", () => {
    const { container } = render(<Icon name="star" />);
    const svg = container.querySelector("svg");

    expect(svg).toHaveAttribute("fill", "currentColor");
    expect(svg).toHaveAttribute("stroke-width", "0");
  });

  it("can force watchlist icons into filled state", () => {
    const { container } = render(<Icon name="watchlist" filled />);
    const svg = container.querySelector("svg");

    expect(svg).toHaveAttribute("fill", "currentColor");
    expect(svg).toHaveAttribute("stroke-width", "0");
  });

  it("does not fill non-special icons unless requested", () => {
    const { container } = render(<Icon name="search" size={30} className="search-glyph" />);
    const svg = container.querySelector("svg");

    expect(svg).toHaveAttribute("fill", "none");
    expect(svg).toHaveAttribute("stroke-width", "1.8");
    expect(svg?.getAttribute("class")).toContain("search-glyph");
    expect(svg).toHaveAttribute("width", "30");
    expect(svg).toHaveAttribute("height", "30");
  });
});
