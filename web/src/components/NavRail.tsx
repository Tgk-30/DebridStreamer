// Port of Sources/DebridStreamer/Views/Shell/NavRail.swift.
//
// Breakpoint-aware primary navigation: compact rail on tablets, labeled rail on
// wide desktop, and a five-item bottom bar on phones with a More drawer.

import { useLayoutEffect, useState } from "react";
import { Icon, type IconName } from "./Icon";
import { isServerMode } from "../lib/serverMode";
import { useSimpleMode } from "../store/AppStore";
import {
  useServerProfiles,
  useServerSession,
} from "../lib/ServerSessionContext";
import "./NavRail.css";

// Screens with no working backend in Server Mode (Debrid Library is Tauri-only).
// The AI Assistant DOES work in Server Mode — it routes to /api/ai/recommend,
// which uses the server's stored provider key — so it is no longer hidden here.
const SERVER_MODE_HIDDEN: ReadonlySet<string> = new Set(["debrid"]);
// Power-user destinations hidden in Simple mode (progressive disclosure). The
// essentials — discover/search/library/watchlist/history/settings — always show;
// Settings must never hide (it hosts the Simple/Advanced toggle).
const SIMPLE_MODE_HIDDEN: ReadonlySet<string> = new Set([
  "assistant",
  "debrid",
  "calendar",
]);

/** True when a screen is hidden from the nav under the current modes. */
export function isScreenHidden(
  id: ScreenId,
  opts: { serverMode: boolean; simpleMode: boolean },
): boolean {
  if (opts.serverMode && SERVER_MODE_HIDDEN.has(id)) return true;
  if (opts.simpleMode && SIMPLE_MODE_HIDDEN.has(id)) return true;
  return false;
}

/** Whether to show the "who's watching" switcher entry. Pure + testable: only
 *  in Server Mode, only with a handler wired, and only when the account has more
 *  than one profile (a single-profile account has nothing to switch to, so there
 *  is no forced picker). */
export function shouldShowProfileSwitch(opts: {
  serverMode: boolean;
  hasHandler: boolean;
  profileCount: number;
}): boolean {
  return opts.serverMode && opts.hasHandler && opts.profileCount > 1;
}

/** Pure, testable nav filter for the current modes. */
export function visibleNavItems(
  items: readonly RailItem[],
  opts: { serverMode: boolean; simpleMode: boolean },
): RailItem[] {
  return items.filter((item) => !isScreenHidden(item.id, opts));
}

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
  {
    id: "discover",
    icon: "discover",
    label: "Discover",
    mobileLabel: "Discover",
    group: "Primary",
    mobile: true,
  },
  { id: "search", icon: "search", label: "Search", group: "Primary", mobile: true },
  { id: "library", icon: "library", label: "Library", group: "Library", mobile: true },
  {
    id: "watchlist",
    icon: "watchlist",
    label: "Watchlist",
    mobileLabel: "Watchlist",
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
  /** Opens the "who's watching" picker (Server Mode only). When absent or when
   *  the account has a single profile, the switch entry is not shown. */
  onSwitchProfile?: () => void;
}

function initialOf(name: string): string {
  const trimmed = name.trim();
  return trimmed.length > 0 ? trimmed[0]!.toUpperCase() : "?";
}

const NAV_COLLAPSED_KEY = "ds_nav_collapsed";

export function NavRail({ selected, onSelect, onSwitchProfile }: NavRailProps) {
  const [moreOpen, setMoreOpen] = useState(false);
  // Collapsed (icons-only) side rail — an ephemeral UI preference persisted to
  // localStorage. Reflected on the root so the layout var + content inset track.
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try {
      return globalThis.localStorage?.getItem(NAV_COLLAPSED_KEY) === "true";
    } catch {
      return false;
    }
  });
  useLayoutEffect(() => {
    document.documentElement.dataset.navCollapsed = collapsed ? "true" : "false";
  }, [collapsed]);
  const toggleCollapsed = () => {
    setCollapsed((c) => {
      const next = !c;
      try {
        globalThis.localStorage?.setItem(NAV_COLLAPSED_KEY, next ? "true" : "false");
      } catch {
        /* non-persistent is fine */
      }
      return next;
    });
  };
  const serverMode = isServerMode();
  const simpleMode = useSimpleMode();
  const session = useServerSession();
  const profiles = useServerProfiles();
  const navItems = visibleNavItems(NAV_ITEMS, { serverMode, simpleMode });
  const moreItems = visibleNavItems(MOBILE_MORE_ITEMS, { serverMode, simpleMode });
  const moreSelected = moreItems.some((item) => item.id === selected);
  // Show the switcher only in Server Mode with a handler AND more than one
  // profile — a single-profile account has no one to switch to (no forced
  // picker, per the spec).
  const showProfileSwitch = shouldShowProfileSwitch({
    serverMode,
    hasHandler: onSwitchProfile != null,
    profileCount: profiles.length,
  });
  const activeProfile =
    session != null
      ? profiles.find((p) => p.id === session.profileId) ?? null
      : null;

  function selectScreen(id: ScreenId) {
    setMoreOpen(false);
    onSelect(id);
  }

  return (
    <nav className="nav-rail" aria-label="Primary">
      <button
        type="button"
        className="nav-rail-collapse"
        data-mobile="false"
        onClick={toggleCollapsed}
        aria-label={collapsed ? "Expand navigation" : "Collapse navigation"}
        aria-pressed={collapsed}
        title={collapsed ? "Expand" : "Collapse"}
      >
        <span className="nav-rail-collapse-glyph" aria-hidden>
          {collapsed ? "»" : "«"}
        </span>
      </button>

      {moreOpen && (
        <button
          type="button"
          className="nav-rail-more-scrim"
          aria-label="Dismiss more menu"
          onClick={() => setMoreOpen(false)}
        />
      )}

      {/* Skip groups with nothing to show (e.g. Tools when every tool is
          gated off) — an orphaned section label reads as a broken menu. The
          Account group also hosts the profile switcher, which isn't a navItem. */}
      {GROUPS.filter(
        (group) =>
          navItems.some((item) => item.group === group) ||
          (group === "Account" && showProfileSwitch),
      ).map((group) => (
        <div key={group} className="nav-rail-section" data-group={group}>
          <div className="nav-rail-group-label">{group}</div>
          {group === "Account" && showProfileSwitch && (
            <button
              type="button"
              className="nav-rail-btn nav-rail-profile"
              data-mobile="false"
              onClick={() => {
                setMoreOpen(false);
                onSwitchProfile?.();
              }}
              title="Switch profile"
              aria-label={`Switch profile (current: ${session?.displayName ?? "profile"})`}
            >
              <span className="nav-rail-icon">
                <span
                  className="nav-rail-profile-avatar"
                  style={{ background: activeProfile?.avatarColor ?? "#475569" }}
                  aria-hidden
                >
                  {initialOf(session?.displayName ?? "?")}
                </span>
              </span>
              <span className="nav-rail-label">Switch</span>
            </button>
          )}
          {navItems.filter((item) => item.group === group).map((item) => (
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
        aria-label="More navigation"
        aria-expanded={moreOpen}
        aria-controls="mobile-nav-more"
        title="More"
      >
        <span className="nav-rail-icon">
          <Icon name="more" size={20} filled={moreSelected} />
        </span>
        <span className="nav-rail-label">More</span>
      </button>

      {moreOpen && (
        <div id="mobile-nav-more" className="nav-rail-more-sheet is-open">
          <div className="nav-rail-more-head">
            <span>More</span>
            <button
              type="button"
              className="nav-rail-more-close"
              onClick={() => setMoreOpen(false)}
              aria-label="Close more menu"
            >
              <Icon name="xmark" size={19} />
            </button>
          </div>
          {moreItems.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`nav-rail-more-action${selected === item.id ? " is-selected" : ""}`}
              data-screen={item.id}
              onClick={() => selectScreen(item.id)}
              aria-label={item.label}
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
      )}
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
      <span
        className="nav-rail-label"
        data-mobile-label={item.mobileLabel}
      >
        {item.label}
      </span>
    </button>
  );
}
