// The built-in avatar chooser, shared by profile creation (the launch/lock/switch
// picker) and Settings -> Profiles. Previously each surface rolled its own: a
// six-item <select> in one, an eight-item chip row in the other.
//
// A grid rather than a <select>: with this many choices a dropdown hides all of
// them behind a click and renders emoji at text size on most platforms.

import { useEffect, useRef, useState } from "react";
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
  const valueGroup = Math.max(
    0,
    AVATAR_GROUPS.findIndex((group) => group.emoji.includes(value)),
  );
  const [activeGroup, setActiveGroup] = useState(valueGroup);
  const gridRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (valueGroup >= 0) setActiveGroup(valueGroup);
  }, [valueGroup]);

  const group = AVATAR_GROUPS[activeGroup] ?? AVATAR_GROUPS[0];

  return (
    <div className="avatar-picker">
      <div className="avatar-picker-tabs" role="tablist" aria-label="Avatar categories">
        {AVATAR_GROUPS.map((item, index) => (
          <button
            key={item.label}
            type="button"
            role="tab"
            aria-selected={index === activeGroup}
            aria-controls={`${idPrefix}-avatar-panel`}
            className={index === activeGroup ? "is-active" : ""}
            onClick={() => setActiveGroup(index)}
          >
            {item.label}
          </button>
        ))}
      </div>
      <div
        ref={gridRef}
        id={`${idPrefix}-avatar-panel`}
        className="avatar-picker-grid"
        role="radiogroup"
        aria-label={`${group.label} avatars`}
      >
        {group.emoji.map((emoji, index) => {
          const active = emoji === value;
          const selectedIndex = group.emoji.indexOf(value);
          return (
            <button
              key={`${idPrefix}-${emoji}`}
              type="button"
              className={`avatar-picker-cell${active ? " is-active" : ""}`}
              onClick={() => onChange(emoji)}
              onKeyDown={(event) => {
                const columns = Math.max(
                  1,
                  getComputedStyle(gridRef.current ?? event.currentTarget).gridTemplateColumns
                    .split(" ")
                    .filter(Boolean).length,
                );
                const delta =
                  event.key === "ArrowLeft" ? -1
                    : event.key === "ArrowRight" ? 1
                      : event.key === "ArrowUp" ? -columns
                        : event.key === "ArrowDown" ? columns
                          : 0;
                if (delta === 0) return;
                event.preventDefault();
                const next = (index + delta + group.emoji.length) % group.emoji.length;
                const choice = group.emoji[next]!;
                onChange(choice);
                gridRef.current?.querySelectorAll<HTMLButtonElement>("[role=radio]")[next]?.focus();
              }}
              role="radio"
              aria-checked={active}
              aria-label={emoji}
              tabIndex={active || (selectedIndex === -1 && index === 0) ? 0 : -1}
            >
              <span aria-hidden>{emoji}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
