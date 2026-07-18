// The avatar choices offered wherever a profile is created or edited (the
// launch/lock chooser, the switch picker, and Settings -> Profiles).
//
// Single source of truth: the list used to be duplicated - a six-item array in
// LocalProfilePicker and a different eight-item one in Settings - so the choices
// you got depended on which screen you happened to be on.
//
// Deliberately emoji rather than character artwork. They are legally
// unencumbered, cost zero bytes (no image assets, no extra requests), scale to
// any avatar size without blurring, and render natively on every platform the
// app ships to. "Famous" characters - even ones described as copyright free -
// are a trap: public-domain STATUS does not clear the separate trademark that
// usually still covers the character, and look-alike artwork carries the same
// exposure as a copy. The archetypes below (wizard, robot, alien, superhero,
// dragon...) give the same playful pick-a-character feel with none of that.
//
// A profile's avatar may also be a user-supplied image (a data:/http(s):/blob:
// URL set from the ProfileMenu); these are the built-in choices only.

export interface AvatarGroup {
  label: string;
  emoji: readonly string[];
}

export const AVATAR_GROUPS: readonly AvatarGroup[] = [
  {
    label: "People",
    emoji: [
      "😀", "😎", "🤓", "🥳", "😴", "🙃", "🫠", "🤠",
      "🕵️", "🧑‍🚀", "👩‍🚀", "🧑‍🎤", "👩‍🎨", "🧑‍🍳", "👑", "🥷",
    ],
  },
  {
    label: "Characters",
    emoji: [
      "🧙", "🦸", "🦹", "🧛", "🧟", "🧜", "🧚", "🧝",
      "🤖", "👽", "👻", "🤡", "🎃", "🐲", "🦄", "😈",
    ],
  },
  {
    label: "Animals",
    emoji: [
      "🦊", "🐱", "🐶", "🐼", "🐨", "🦁", "🐯", "🐸",
      "🐵", "🦉", "🐺", "🦖", "🐙", "🦈", "🐧", "🦝",
    ],
  },
  {
    label: "Cinema",
    emoji: [
      "🎬", "🍿", "📺", "🎞️", "🎥", "📽️", "🎭", "🎟️",
      "⭐", "🌟", "🏆", "🚀", "🛸", "🏰", "🗺️", "🔮",
    ],
  },
  {
    label: "Symbols",
    emoji: [
      "🌙", "☀️", "⚡", "🔥", "🌈", "💎", "🎯", "🎮",
      "🎧", "🎸", "🍕", "☕", "🌊", "🍀", "🪐", "🧿",
    ],
  },
];

export interface ProfileColor {
  label: string;
  value: string;
}

export const PROFILE_COLORS: readonly ProfileColor[] = [
  { label: "Sky", value: "#0ea5e9" },
  { label: "Blue", value: "#3b82f6" },
  { label: "Indigo", value: "#6366f1" },
  { label: "Violet", value: "#8b5cf6" },
  { label: "Purple", value: "#a855f7" },
  { label: "Rose", value: "#f43f5e" },
  { label: "Coral", value: "#fb7185" },
  { label: "Orange", value: "#f97316" },
  { label: "Amber", value: "#f59e0b" },
  { label: "Lime", value: "#84cc16" },
  { label: "Green", value: "#22c55e" },
  { label: "Emerald", value: "#10b981" },
  { label: "Teal", value: "#14b8a6" },
  { label: "Slate", value: "#64748b" },
  { label: "Graphite", value: "#475569" },
  { label: "Stone", value: "#78716c" },
];

/** Every built-in choice, flattened - for validation and simple pickers. */
export const PROFILE_AVATARS: readonly string[] = AVATAR_GROUPS.flatMap(
  (group) => group.emoji,
);

/** The default for a newly created profile. */
export const DEFAULT_PROFILE_AVATAR = "😀";
export const DEFAULT_PROFILE_COLOR = "#0ea5e9";

/** A stored avatar can be an emoji OR a user-supplied image URL; only the latter
 * renders as an <img>. Shared so every surface agrees on what counts as a photo
 * (this predicate was copy-pasted into four components). */
export function isImageAvatar(avatar: string | undefined | null): avatar is string {
  return (
    typeof avatar === "string" &&
    (avatar.startsWith("data:") ||
      avatar.startsWith("http") ||
      avatar.startsWith("blob:"))
  );
}
