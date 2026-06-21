export type ServerSetupInvitePresetId =
  | "family_simple"
  | "household_simple"
  | "power_user";

export interface ServerSetupInvitePreset {
  id: ServerSetupInvitePresetId;
  label: string;
  inviteLabel: string;
  simpleMode: boolean;
  description: string;
}

export const SERVER_SETUP_INVITE_PRESETS: ServerSetupInvitePreset[] = [
  {
    id: "family_simple",
    label: "Family - Simple mode",
    inviteLabel: "Family",
    simpleMode: true,
    description: "Best default for shared TVs, phones, and people who just want playback.",
  },
  {
    id: "household_simple",
    label: "Household - Simple mode",
    inviteLabel: "Household",
    simpleMode: true,
    description: "A neutral invite for roommates or mixed household profiles.",
  },
  {
    id: "power_user",
    label: "Power user",
    inviteLabel: "Power user",
    simpleMode: false,
    description: "Starts with the fuller interface for someone managing sources and settings.",
  },
];

export const DEFAULT_SERVER_SETUP_INVITE_PRESET_ID =
  SERVER_SETUP_INVITE_PRESETS[0].id;

export function serverSetupInvitePreset(
  id: ServerSetupInvitePresetId,
): ServerSetupInvitePreset {
  return (
    SERVER_SETUP_INVITE_PRESETS.find((preset) => preset.id === id) ??
    SERVER_SETUP_INVITE_PRESETS[0]
  );
}
