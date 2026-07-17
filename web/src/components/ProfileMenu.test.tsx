// @vitest-environment jsdom
//
// ProfileMenu preset-avatar gallery: the presets render inside the popover, a
// click stores that preset's data URL as the avatar, and the active one is
// marked selected. (Upload/name are exercised implicitly by the popover open.)

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PRESET_AVATARS } from "./AvatarPresets";

const updateSettings = vi.fn();
let mockSettings: { userName: string; userAvatar: string } = {
  userName: "",
  userAvatar: "",
};

vi.mock("../store/AppStore", () => ({
  useAppStore: () => ({ settings: mockSettings, updateSettings }),
}));
vi.mock("./Icon", () => ({
  Icon: ({ name }: { name: string }) => <span data-icon={name} />,
}));

import { ProfileMenu } from "./ProfileMenu";

beforeEach(() => {
  updateSettings.mockReset();
  mockSettings = { userName: "", userAvatar: "" };
});
afterEach(() => cleanup());

async function openPopover() {
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Your profile" }));
  return user;
}

describe("ProfileMenu preset avatars", () => {
  it("renders all 8 presets in the popover", async () => {
    render(<ProfileMenu />);
    await openPopover();
    for (const preset of PRESET_AVATARS) {
      expect(
        screen.getByRole("button", { name: preset.label }),
      ).toBeInTheDocument();
    }
    expect(PRESET_AVATARS).toHaveLength(8);
  });

  it("stores the chosen preset's data URL as the avatar", async () => {
    render(<ProfileMenu />);
    const user = await openPopover();
    await user.click(screen.getByRole("button", { name: "Film" }));
    expect(updateSettings).toHaveBeenCalledWith(
      expect.objectContaining({ userAvatar: PRESET_AVATARS[0].dataUrl }),
    );
  });

  it("marks the active preset as selected", async () => {
    mockSettings = { userName: "", userAvatar: PRESET_AVATARS[1].dataUrl };
    render(<ProfileMenu />);
    await openPopover();
    expect(
      screen.getByRole("button", { name: "Popcorn" }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(
      screen.getByRole("button", { name: "Film" }),
    ).toHaveAttribute("aria-pressed", "false");
  });

  it("presets are self-contained SVG data URLs (no external assets)", () => {
    for (const p of PRESET_AVATARS) {
      expect(p.dataUrl.startsWith("data:image/svg+xml")).toBe(true);
    }
  });
});
