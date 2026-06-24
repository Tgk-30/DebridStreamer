// @vitest-environment jsdom
//
// Smoke test that validates the React Testing Library + jsdom harness, and pins
// EmptyState's conditional rendering (note + actions only when provided).

import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { EmptyState } from "./EmptyState";

describe("EmptyState", () => {
  it("renders the title and subtitle", () => {
    render(
      <EmptyState icon="search" title="Nothing here" subtitle="Try a search." />,
    );
    expect(screen.getByText("Nothing here")).toBeInTheDocument();
    expect(screen.getByText("Try a search.")).toBeInTheDocument();
  });

  it("omits the note and actions when not provided", () => {
    const { container } = render(
      <EmptyState icon="search" title="T" subtitle="S" />,
    );
    expect(container.querySelector(".empty-state-note")).toBeNull();
    expect(container.querySelector(".empty-state-actions")).toBeNull();
  });

  it("renders the note and action nodes when provided", () => {
    render(
      <EmptyState
        icon="debrid"
        title="T"
        subtitle="S"
        note="Pending"
        actions={<button type="button">Do it</button>}
      />,
    );
    expect(screen.getByText("Pending")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Do it" }),
    ).toBeInTheDocument();
  });
});
