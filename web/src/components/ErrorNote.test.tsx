// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ErrorNote } from "./ErrorNote";

describe("ErrorNote", () => {
  it("announces its existing error content as an alert", () => {
    render(<ErrorNote className="existing-error">Something went wrong.</ErrorNote>);

    expect(screen.getByRole("alert")).toHaveClass("existing-error");
    expect(screen.getByRole("alert")).toHaveTextContent("Something went wrong.");
  });
});
