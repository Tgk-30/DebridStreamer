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
    description:
      "Best for shared TVs, phones, and anyone who just wants to browse and play. Advanced screens (sources, the assistant, the debrid library) stay hidden.",
  },
  {
    id: "household_simple",
    label: "Household - Simple mode",
    inviteLabel: "Household",
    simpleMode: true,
    description:
      "Playback-first for roommates or mixed households; advanced screens stay hidden. You can promote anyone to the full interface later in Settings → Server.",
  },
  {
    id: "power_user",
    label: "Power user",
    inviteLabel: "Power user",
    simpleMode: false,
    description:
      "The full interface - can manage sources, indexers, and settings. For whoever helps you run the server.",
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
