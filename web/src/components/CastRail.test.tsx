// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
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

  it("caps the rail at 20 members", () => {
    const many: CastMember[] = Array.from({ length: 25 }, (_, i) => ({
      id: i,
      name: `Actor ${i}`,
      character: "",
      profileURL: null,
    }));
    render(<CastRail cast={many} />);
    expect(screen.getAllByRole("button")).toHaveLength(20);
  });

  it("fires onSelect with the member when a card is clicked", async () => {
    const onSelect = vi.fn();
    render(<CastRail cast={cast} onSelect={onSelect} />);
    await userEvent.click(screen.getByText("Jane Doe"));
    expect(onSelect).toHaveBeenCalledWith(cast[0]);
  });
});
