// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ImgWithFallback } from "./ImgWithFallback";

describe("ImgWithFallback", () => {
  it("replaces a failed image with its supplied placeholder", () => {
    render(
      <ImgWithFallback
        src="/missing.jpg"
        alt="Poster"
        fallback={<span data-testid="fallback">No image</span>}
      />,
    );

    fireEvent.error(screen.getByRole("img", { name: "Poster" }));
    expect(screen.queryByRole("img", { name: "Poster" })).toBeNull();
    expect(screen.getByTestId("fallback")).toHaveTextContent("No image");
  });
});
