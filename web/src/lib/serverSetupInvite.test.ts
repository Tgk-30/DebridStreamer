import { describe, expect, it } from "vitest";
import {
  DEFAULT_SERVER_SETUP_INVITE_PRESET_ID,
  SERVER_SETUP_INVITE_PRESETS,
  serverSetupInvitePreset,
} from "./serverSetupInvite";

describe("serverSetupInvite", () => {
  it("defaults to the first concrete invite preset", () => {
    expect(DEFAULT_SERVER_SETUP_INVITE_PRESET_ID).toBe(SERVER_SETUP_INVITE_PRESETS[0].id);
    expect(serverSetupInvitePreset(DEFAULT_SERVER_SETUP_INVITE_PRESET_ID)).toMatchObject({
      inviteLabel: "Family",
      simpleMode: true,
    });
  });

  it("keeps simple household options before the advanced option", () => {
    expect(SERVER_SETUP_INVITE_PRESETS.map((preset) => preset.id)).toEqual([
      "family_simple",
      "household_simple",
      "power_user",
    ]);
  });

  it("maps the power user preset to a non-simple invite", () => {
    expect(serverSetupInvitePreset("power_user")).toMatchObject({
      inviteLabel: "Power user",
      simpleMode: false,
    });
  });
});
