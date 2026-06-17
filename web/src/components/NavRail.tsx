// Port of Sources/DebridStreamer/Views/Shell/NavRail.swift.
//
// A slim (78px) glass icon+label rail. Primary destinations sit at the top,
// a hairline divider then the pinned Settings gear at the bottom. Selection is
// a soft accent-ring glass capsule (accent fill 0.16 + accent stroke 0.55 +
// accent glow) — never a loud system highlight. Search lives in the top-right
// global field, not here.

import { Icon, type IconName } from "./Icon";
import "./NavRail.css";

export type ScreenId =
  | "discover"
  | "library"
  | "watchlist"
  | "history"
  | "assistant"
  | "settings";

interface RailItem {
  id: ScreenId;
  icon: IconName;
  label: string;
}

// SidebarItem.railPrimary order, with the shortLabel ("Assistant").
const PRIMARY: RailItem[] = [
  { id: "discover", icon: "discover", label: "Discover" },
  { id: "library", icon: "library", label: "Library" },
  { id: "watchlist", icon: "watchlist", label: "Watchlist" },
  { id: "history", icon: "history", label: "History" },
  { id: "assistant", icon: "assistant", label: "Assistant" },
];

interface NavRailProps {
  selected: ScreenId;
  onSelect: (id: ScreenId) => void;
}

export function NavRail({ selected, onSelect }: NavRailProps) {
  return (
    <nav className="nav-rail" aria-label="Primary">
      {PRIMARY.map((item) => (
        <NavRailButton
          key={item.id}
          item={item}
          selected={selected === item.id}
          onSelect={onSelect}
        />
      ))}

      <div className="nav-rail-spacer" />
      <div className="nav-rail-divider" />

      <NavRailButton
        item={{ id: "settings", icon: "settings", label: "Settings" }}
        selected={selected === "settings"}
        onSelect={onSelect}
      />
    </nav>
  );
}

function NavRailButton({
  item,
  selected,
  onSelect,
}: {
  item: RailItem;
  selected: boolean;
  onSelect: (id: ScreenId) => void;
}) {
  return (
    <button
      type="button"
      className={`nav-rail-btn${selected ? " is-selected" : ""}`}
      onClick={() => onSelect(item.id)}
      title={item.label}
      aria-current={selected ? "page" : undefined}
    >
      <Icon name={item.icon} size={18} filled={selected && item.id === "watchlist"} />
      <span className="nav-rail-label">{item.label}</span>
    </button>
  );
}
