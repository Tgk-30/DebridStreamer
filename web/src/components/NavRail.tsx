// Port of Sources/DebridStreamer/Views/Shell/NavRail.swift.
//
// Breakpoint-aware primary navigation: labeled side rail on tablet/desktop and
// a compact five-item bottom bar on phones with a More drawer for secondary
// destinations.

import { useState } from "react";
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
  mobileLabel?: string;
  group: "Primary" | "Library" | "Tools" | "Account";
  mobile?: boolean;
}

const NAV_ITEMS: RailItem[] = [
  { id: "discover", icon: "discover", label: "Discover", group: "Primary", mobile: true },
  { id: "search", icon: "search", label: "Search", group: "Primary", mobile: true },
  { id: "library", icon: "library", label: "Library", group: "Library", mobile: true },
  {
    id: "watchlist",
    icon: "watchlist",
    label: "Watchlist",
    mobileLabel: "Saved",
    group: "Library",
    mobile: true,
  },
  { id: "calendar", icon: "calendar", label: "Calendar", group: "Library" },
  { id: "history", icon: "history", label: "History", group: "Library" },
  { id: "assistant", icon: "assistant", label: "Assistant", group: "Tools" },
  { id: "debrid", icon: "debrid", label: "Debrid", group: "Tools" },
  { id: "settings", icon: "settings", label: "Settings", group: "Account" },
];

const MOBILE_MORE_ITEMS = NAV_ITEMS.filter((item) => !item.mobile || item.id === "settings");
const GROUPS = ["Primary", "Library", "Tools", "Account"] as const;

interface NavRailProps {
  selected: ScreenId;
  onSelect: (id: ScreenId) => void;
}

export function NavRail({ selected, onSelect }: NavRailProps) {
  const [moreOpen, setMoreOpen] = useState(false);
  const moreSelected = MOBILE_MORE_ITEMS.some((item) => item.id === selected);

  function selectScreen(id: ScreenId) {
    setMoreOpen(false);
    onSelect(id);
  }

  return (
    <nav className="nav-rail" aria-label="Primary">
      {moreOpen && (
        <button
          type="button"
          className="nav-rail-more-scrim"
          aria-label="Close more menu"
          onClick={() => setMoreOpen(false)}
        />
      )}

      {GROUPS.map((group) => (
        <div key={group} className="nav-rail-section" data-group={group}>
          <div className="nav-rail-group-label">{group}</div>
          {NAV_ITEMS.filter((item) => item.group === group).map((item) => (
            <NavRailButton
              key={item.id}
              item={item}
              selected={selected === item.id}
              onSelect={selectScreen}
            />
          ))}
        </div>
      ))}

      <button
        type="button"
        className={`nav-rail-btn nav-rail-more${moreSelected ? " is-selected" : ""}`}
        data-mobile="true"
        data-mobile-overflow="true"
        onClick={() => setMoreOpen((open) => !open)}
        aria-expanded={moreOpen}
        aria-controls="mobile-nav-more"
        title="More"
      >
        <span className="nav-rail-icon">
          <Icon name="more" size={20} filled={moreSelected} />
        </span>
        <span className="nav-rail-label">More</span>
      </button>

      <div
        id="mobile-nav-more"
        className={`nav-rail-more-sheet${moreOpen ? " is-open" : ""}`}
        aria-hidden={!moreOpen}
      >
        <div className="nav-rail-more-head">
          <span>More</span>
          <button
            type="button"
            className="nav-rail-more-close"
            onClick={() => setMoreOpen(false)}
            tabIndex={moreOpen ? 0 : -1}
            aria-label="Close more menu"
          >
            <Icon name="xmark" size={19} />
          </button>
        </div>
        {MOBILE_MORE_ITEMS.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`nav-rail-more-action${item.id === "settings" ? " is-wide" : ""}${selected === item.id ? " is-selected" : ""}`}
            data-screen={item.id}
            onClick={() => selectScreen(item.id)}
            tabIndex={moreOpen ? 0 : -1}
          >
            <span className="nav-rail-more-icon">
              <Icon
                name={item.icon}
                size={18}
                filled={selected === item.id}
              />
            </span>
            <span>{item.label}</span>
          </button>
        ))}
      </div>
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
      className={`nav-rail-btn${selected ? " is-selected" : ""}${item.mobileLabel != null ? " has-mobile-label" : ""}`}
      data-screen={item.id}
      data-mobile={item.mobile ? "true" : "false"}
      onClick={() => onSelect(item.id)}
      title={item.label}
      aria-label={item.label}
      aria-current={selected ? "page" : undefined}
    >
      <span className="nav-rail-icon">
        <Icon name={item.icon} size={20} filled={selected} />
      </span>
      <span className="nav-rail-label nav-rail-label-default">{item.label}</span>
      {item.mobileLabel != null && (
        <span className="nav-rail-label nav-rail-label-mobile">
          {item.mobileLabel}
        </span>
      )}
    </button>
  );
}
