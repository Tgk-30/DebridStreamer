// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { InfoTip } from "./InfoTip";

describe("InfoTip", () => {
  it("opens on hover with an aria-describedby relationship", async () => {
    const user = userEvent.setup();
    render(<InfoTip label="About Data Saver">Keeps playback bandwidth lower.</InfoTip>);

    const trigger = screen.getByRole("button", { name: "About Data Saver" });
    await user.hover(trigger);

    const tooltip = await screen.findByRole("tooltip");
    expect(trigger).toHaveAttribute("aria-describedby", tooltip.id);
    expect(tooltip).toHaveTextContent("Keeps playback bandwidth lower.");
  });

  it("opens on focus and dismisses with Escape or blur", async () => {
    const user = userEvent.setup();
    render(
      <>
        <InfoTip>Keyboard help.</InfoTip>
        <button type="button">Next control</button>
      </>,
    );

    await user.tab();
    expect(await screen.findByRole("tooltip")).toHaveTextContent("Keyboard help.");

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("tooltip")).toBeNull();

    await user.tab();
    expect(screen.queryByRole("tooltip")).toBeNull();
  });
});
