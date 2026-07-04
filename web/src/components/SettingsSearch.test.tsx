// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("./Icon", () => ({ Icon: () => <span data-testid="icon" /> }));

import { SettingsSearch } from "./SettingsSearch";

const ALL = new Set([
  "appearance",
  "playback",
  "keys",
  "debrid",
  "sources",
  "updates",
  "install",
  "server",
]);

describe("SettingsSearch", () => {
  it("surfaces matches and jumps to the setting's tab on click", async () => {
    const onJump = vi.fn();
    const user = userEvent.setup();
    render(<SettingsSearch onJump={onJump} visibleTabs={ALL} />);
    await user.type(screen.getByLabelText("Search settings"), "player");
    const result = await screen.findByRole("button", { name: /Built-in player/ });
    await user.click(result);
    expect(onJump).toHaveBeenCalledWith("playback");
  });

  it("matches on keywords not present in the visible label", async () => {
    const onJump = vi.fn();
    const user = userEvent.setup();
    render(<SettingsSearch onJump={onJump} visibleTabs={ALL} />);
    // "landing" is a keyword of the "Start on (default tab)" entry.
    await user.type(screen.getByLabelText("Search settings"), "landing");
    await user.click(await screen.findByRole("button", { name: /Start on/ }));
    expect(onJump).toHaveBeenCalledWith("appearance");
  });

  it("hides results whose tab is not currently visible", async () => {
    const user = userEvent.setup();
    render(
      <SettingsSearch onJump={vi.fn()} visibleTabs={new Set(["appearance"])} />,
    );
    // "debrid" lives on the Providers tab, which isn't visible here.
    await user.type(screen.getByLabelText("Search settings"), "debrid");
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("shows nothing for a query shorter than 2 characters", async () => {
    const user = userEvent.setup();
    render(<SettingsSearch onJump={vi.fn()} visibleTabs={ALL} />);
    await user.type(screen.getByLabelText("Search settings"), "a");
    expect(screen.queryByRole("button")).toBeNull();
  });
});
