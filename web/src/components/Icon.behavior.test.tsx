// @vitest-environment jsdom

import React from "react";
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";

import { Icon } from "./Icon";

describe("Icon behavior matrix", () => {
  it("fills play and star icons by default", () => {
    ["play", "star"].forEach((name) => {
      const { container } = render(<Icon name={name as "play" | "star"} />);
      const svg = container.querySelector("svg");

      expect(svg?.getAttribute("fill")).toBe("currentColor");
      expect(svg?.getAttribute("stroke-width")).toBe("0");
    });
  });

  it("fills watchlist icon only when requested", () => {
    const { container: filledContainer } = render(<Icon name="watchlist" filled />);
    const filled = filledContainer.querySelector("svg");
    const { container: unfilledContainer } = render(<Icon name="watchlist" filled={false} />);
    const unfilled = unfilledContainer.querySelector("svg");

    expect(filled?.getAttribute("fill")).toBe("currentColor");
    expect(filled?.getAttribute("stroke-width")).toBe("0");

    expect(unfilled?.getAttribute("fill")).toBe("none");
    expect(unfilled?.getAttribute("stroke-width")).toBe("1.8");
  });

  it("keeps non-special icons unfilled while switching stroke width when requested", () => {
    const { container: thinContainer } = render(<Icon name="search" />);
    const thin = thinContainer.querySelector("svg");
    const { container: thickContainer } = render(<Icon name="search" filled />);
    const thick = thickContainer.querySelector("svg");

    expect(thin?.getAttribute("fill")).toBe("none");
    expect(thin?.getAttribute("stroke-width")).toBe("1.8");

    expect(thick?.getAttribute("fill")).toBe("none");
    expect(thick?.getAttribute("stroke-width")).toBe("2.25");
  });

  it("forwards size and className attributes to the icon", () => {
    const { container } = render(<Icon name="search" size={42} className="search-glyph" />);
    const svg = container.querySelector("svg");

    expect(svg?.getAttribute("width")).toBe("42");
    expect(svg?.getAttribute("height")).toBe("42");
    expect(svg?.getAttribute("class") || "").toContain("search-glyph");
  });
});
