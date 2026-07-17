// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("./Icon", () => ({
  Icon: ({ name }: { name: string }) => <span data-testid={`icon-${name}`} />,
}));
const search = vi.fn();
vi.mock("../store/AppStore", () => ({
  useAppActions: () => ({ search }),
}));

import { GlobalSearch } from "./GlobalSearch";

beforeEach(() => search.mockClear());

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
    render(<GlobalSearch />);
    const input = screen.getByRole("textbox");
    await userEvent.type(input, "  dune  {Enter}");
    expect(search).toHaveBeenCalledWith("dune");
  });

  it("does not submit a blank/whitespace-only query", async () => {
    render(<GlobalSearch />);
    const input = screen.getByRole("textbox");
    await userEvent.type(input, "   {Enter}");
    expect(search).not.toHaveBeenCalled();
  });
});
