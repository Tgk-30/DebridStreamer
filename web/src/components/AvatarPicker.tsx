// The built-in avatar chooser, shared by profile creation (the launch/lock/switch
// picker) and Settings -> Profiles. Previously each surface rolled its own: a
// six-item <select> in one, an eight-item chip row in the other.
//
// A grid rather than a <select>: with this many choices a dropdown hides all of
// them behind a click and renders emoji at text size on most platforms.

import { AVATAR_GROUPS } from "../data/profileAvatars";
import "./AvatarPicker.css";

export function AvatarPicker({
  value,
  onChange,
  idPrefix = "avatar",
}: {
  value: string;
  onChange: (emoji: string) => void;
  /** Distinguishes the radiogroup when two pickers are on screen at once. */
  idPrefix?: string;
}) {
  return (
    <div className="avatar-picker">
      {AVATAR_GROUPS.map((group) => (
        <div className="avatar-picker-group" key={group.label}>
          <div className="avatar-picker-label">{group.label}</div>
          <div
            className="avatar-picker-grid"
            role="radiogroup"
            aria-label={`${group.label} avatars`}
          >
            {group.emoji.map((emoji) => {
              const active = emoji === value;
              return (
                <button
                  key={`${idPrefix}-${emoji}`}
                  type="button"
                  className={`avatar-picker-cell${active ? " is-active" : ""}`}
                  onClick={() => onChange(emoji)}
                  role="radio"
                  aria-checked={active}
                  aria-label={emoji}
                >
                  <span aria-hidden>{emoji}</span>
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
