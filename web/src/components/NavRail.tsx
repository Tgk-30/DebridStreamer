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
  | "search"
  | "library"
  | "watchlist"
  | "calendar"
  | "history"
  | "assistant"
  | "debrid"
  | "settings";

interface RailItem {
  id: ScreenId;
  icon: IconName;
  label: string;
  group: "Primary" | "Library" | "Tools" | "Account";
  mobile?: boolean;
}

const NAV_ITEMS: RailItem[] = [
  { id: "discover", icon: "discover", label: "Discover", group: "Primary", mobile: true },
  { id: "search", icon: "search", label: "Search", group: "Primary", mobile: true },
  { id: "library", icon: "library", label: "Library", group: "Library", mobile: true },
  { id: "watchlist", icon: "watchlist", label: "Watchlist", group: "Library", mobile: true },
  { id: "calendar", icon: "calendar", label: "Calendar", group: "Library" },
  { id: "history", icon: "history", label: "History", group: "Library" },
  { id: "assistant", icon: "assistant", label: "Assistant", group: "Tools" },
  { id: "debrid", icon: "debrid", label: "Debrid", group: "Tools" },
  { id: "settings", icon: "settings", label: "Settings", group: "Account", mobile: true },
];

interface NavRailProps {
  selected: ScreenId;
  onSelect: (id: ScreenId) => void;
}

export function NavRail({ selected, onSelect }: NavRailProps) {
  return (
    <nav className="nav-rail" aria-label="Primary">
      {(["Primary", "Library", "Tools", "Account"] as const).map((group) => (
        <div key={group} className="nav-rail-section" data-group={group}>
          <div className="nav-rail-group-label">{group}</div>
          {NAV_ITEMS.filter((item) => item.group === group).map((item) => (
            <NavRailButton
              key={item.id}
              item={item}
              selected={selected === item.id}
              onSelect={onSelect}
            />
          ))}
        </div>
      ))}
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
      data-screen={item.id}
      data-mobile={item.mobile ? "true" : "false"}
      onClick={() => onSelect(item.id)}
      title={item.label}
      aria-current={selected ? "page" : undefined}
    >
      <Icon
        name={item.icon}
        size={20}
        filled={selected && item.id === "watchlist"}
      />
      <span className="nav-rail-label">{item.label}</span>
    </button>
  );
}
