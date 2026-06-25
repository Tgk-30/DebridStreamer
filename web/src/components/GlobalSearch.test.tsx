// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("./Icon", () => ({
  Icon: ({ name }: { name: string }) => <span data-testid={`icon-${name}`} />,
}));

import { GlobalSearch } from "./GlobalSearch";

describe("GlobalSearch", () => {
  it("renders the search field with a magnifier and no clear button initially", () => {
    render(<GlobalSearch />);
    expect(
      screen.getByRole("textbox", { name: "Search movies and shows" }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("icon-search")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Clear search" }),
    ).not.toBeInTheDocument();
  });

  it("reveals the clear button once there is text and clears on click", async () => {
    render(<GlobalSearch />);
    const input = screen.getByRole("textbox") as HTMLInputElement;
    await userEvent.type(input, "dune");
    const clear = screen.getByRole("button", { name: "Clear search" });
    expect(clear).toBeInTheDocument();
    await userEvent.click(clear);
    expect(input.value).toBe("");
    expect(
      screen.queryByRole("button", { name: "Clear search" }),
    ).not.toBeInTheDocument();
  });

  it("submits the trimmed query on Enter", async () => {
    const onSubmit = vi.fn();
    render(<GlobalSearch onSubmit={onSubmit} />);
    const input = screen.getByRole("textbox");
    await userEvent.type(input, "  dune  {Enter}");
    expect(onSubmit).toHaveBeenCalledWith("dune");
  });

  it("does not submit a blank/whitespace-only query", async () => {
    const onSubmit = vi.fn();
    render(<GlobalSearch onSubmit={onSubmit} />);
    const input = screen.getByRole("textbox");
    await userEvent.type(input, "   {Enter}");
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
