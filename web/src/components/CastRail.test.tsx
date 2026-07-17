// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("./Icon", () => ({
  Icon: () => <span data-testid="icon" />,
}));

import { CastRail } from "./CastRail";
import type { CastMember } from "../models/media";

const cast: CastMember[] = [
  { id: 1, name: "Jane Doe", character: "Hero", profileURL: "/jane.jpg" },
  { id: 2, name: "John Roe", character: "", profileURL: null },
];

describe("CastRail", () => {
  it("renders nothing when the cast is empty", () => {
    const { container } = render(<CastRail cast={[]} />);
    expect(container.querySelector(".cast")).toBeNull();
  });

  it("renders a card per member with name and character", () => {
    render(<CastRail cast={cast} />);
    expect(screen.getByRole("heading", { name: "Cast" })).toBeInTheDocument();
    expect(screen.getByText("Jane Doe")).toBeInTheDocument();
    expect(screen.getByText("Hero")).toBeInTheDocument();
    expect(screen.getByText("John Roe")).toBeInTheDocument();
  });

  it("renders a photo when profileURL exists and a placeholder icon when it does not", () => {
    render(<CastRail cast={cast} />);
    const img = screen.getByRole("img", { name: "Jane Doe" });
    expect(img).toHaveAttribute("src", "/jane.jpg");
    // The member without a photo shows a placeholder icon.
    expect(screen.getByTestId("icon")).toBeInTheDocument();
  });

  it("replaces a failed profile photo with the existing placeholder", () => {
    const { container } = render(<CastRail cast={cast} />);
    fireEvent.error(screen.getByRole("img", { name: "Jane Doe" }));
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector(".cast-photo-placeholder")).not.toBeNull();
  });

  it("caps the rail at 20 members", () => {
    const many: CastMember[] = Array.from({ length: 25 }, (_, i) => ({
      id: i,
      name: `Actor ${i}`,
      character: "",
      profileURL: null,
    }));
    const { container } = render(<CastRail cast={many} />);
    expect(container.querySelectorAll(".cast-card")).toHaveLength(20);
  });

  it("fires onSelect with the member when a card is clicked", async () => {
    const onSelect = vi.fn();
    render(<CastRail cast={cast} onSelect={onSelect} />);
    await userEvent.click(screen.getByText("Jane Doe"));
    expect(onSelect).toHaveBeenCalledWith(cast[0]);
  });

  it("renders interactive cards only when there is somewhere to go", () => {
    // Detail renders the rail with no onSelect (no credits destination exists).
    // Cards must not then be buttons: that gave every card a tab stop and a
    // pointer cursor for a click that could never do anything.
    const { container: inert } = render(<CastRail cast={cast} />);
    expect(inert.querySelectorAll("button.cast-card")).toHaveLength(0);
    expect(inert.querySelectorAll(".cast-card")).toHaveLength(2);
    expect(screen.queryAllByRole("button")).toHaveLength(0);

    const { container: live } = render(<CastRail cast={cast} onSelect={vi.fn()} />);
    expect(live.querySelectorAll("button.cast-card")).toHaveLength(2);
  });

  it("keeps the name/character tooltip on non-interactive cards", () => {
    const { container } = render(<CastRail cast={cast} />);
    expect(container.querySelector(".cast-card")).toHaveAttribute(
      "title",
      "Jane Doe - Hero",
    );
  });
});
