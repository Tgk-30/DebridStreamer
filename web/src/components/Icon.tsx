// Lightweight inline-SVG icon set standing in for the native app's SF Symbols.
// Each name maps to the closest equivalent of the SidebarItem.icon / view glyphs
// used in the Swift sources (sparkles.tv, books.vertical, bookmark, clock,
// wand.and.stars, gear, magnifyingglass, play.fill, star.fill, sparkles,
// info.circle, xmark, sparkle.magnifyingglass).

export type IconName =
  | "discover"
  | "library"
  | "watchlist"
  | "history"
  | "assistant"
  | "settings"
  | "search"
  | "play"
  | "star"
  | "sparkles"
  | "info"
  | "xmark"
  | "wand-search"
  | "calendar"
  | "debrid"
  | "trash"
  | "refresh"
  | "share"
  | "captions"
  | "check";

interface IconProps {
  name: IconName;
  size?: number;
  className?: string;
  /** Pass a fill (e.g. for star.fill / play.fill). Defaults to stroke-only. */
  filled?: boolean;
}

const PATHS: Record<IconName, (filled: boolean) => JSX.Element> = {
  // sparkles.tv — a screen with a spark
  discover: () => (
    <>
      <rect x="3" y="5" width="18" height="12" rx="2" />
      <path d="M8 21h8" />
      <path d="M17.2 3.2l.6 1.5 1.5.6-1.5.6-.6 1.5-.6-1.5L15 5.3l1.5-.6z" />
    </>
  ),
  // books.vertical
  library: () => (
    <>
      <path d="M5 4h3v16H5z" />
      <path d="M10 4h3v16h-3z" />
      <path d="M15.5 4.6l3 .8-3.2 14.4-3-.8z" />
    </>
  ),
  // bookmark
  watchlist: (filled) =>
    filled ? (
      <path d="M6 3h12a1 1 0 0 1 1 1v17l-7-4-7 4V4a1 1 0 0 1 1-1z" fill="currentColor" stroke="none" />
    ) : (
      <path d="M6 3h12a1 1 0 0 1 1 1v17l-7-4-7 4V4a1 1 0 0 1 1-1z" />
    ),
  // clock
  history: () => (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  // wand.and.stars
  assistant: () => (
    <>
      <path d="M4 20L16 8" />
      <path d="M14 6l2 2" />
      <path d="M19 3.2l.5 1.3 1.3.5-1.3.5L19 6.8l-.5-1.3L17.2 5l1.3-.5z" />
      <path d="M7 4l.4 1 1 .4-1 .4L7 6.8 6.6 5.8l-1-.4 1-.4z" />
    </>
  ),
  // gear
  settings: () => (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2.5l1.2 2 2.3-.3.8 2.2 2 1.2-.9 2.2.9 2.2-2 1.2-.8 2.2-2.3-.3L12 21.5l-1.2-2-2.3.3-.8-2.2-2-1.2.9-2.2-.9-2.2 2-1.2.8-2.2 2.3.3z" />
    </>
  ),
  // magnifyingglass
  search: () => (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="M16 16l5 5" />
    </>
  ),
  // play.fill
  play: () => <path d="M7 5v14l12-7z" fill="currentColor" stroke="none" />,
  // star.fill
  star: () => (
    <path
      d="M12 3l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9 6.8 19.1l1-5.8L3.5 9.2l5.9-.9z"
      fill="currentColor"
      stroke="none"
    />
  ),
  // sparkles
  sparkles: () => (
    <>
      <path d="M12 3l1.4 3.6L17 8l-3.6 1.4L12 13l-1.4-3.6L7 8l3.6-1.4z" />
      <path d="M18 14l.7 1.8L20.5 16.5l-1.8.7L18 19l-.7-1.8L15.5 16.5l1.8-.7z" />
    </>
  ),
  // info.circle
  info: () => (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5" />
      <path d="M12 8h.01" />
    </>
  ),
  // xmark.circle.fill (used as clear button)
  xmark: () => (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M9 9l6 6M15 9l-6 6" />
    </>
  ),
  // sparkle.magnifyingglass (mood strip)
  "wand-search": () => (
    <>
      <circle cx="10.5" cy="10.5" r="6" />
      <path d="M15 15l5 5" />
      <path d="M10.5 7.5l.6 1.5 1.5.6-1.5.6-.6 1.5-.6-1.5-1.5-.6 1.5-.6z" />
    </>
  ),
  // calendar
  calendar: () => (
    <>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M3 9h18" />
      <path d="M8 3v4M16 3v4" />
    </>
  ),
  // externaldrive / debrid (a drive with a download arrow)
  debrid: () => (
    <>
      <rect x="3" y="13" width="18" height="6" rx="2" />
      <path d="M7 16h.01" />
      <path d="M12 3v7M9 7l3 3 3-3" />
    </>
  ),
  // trash
  trash: () => (
    <>
      <path d="M4 7h16" />
      <path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
      <path d="M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13" />
    </>
  ),
  // arrow.clockwise
  refresh: () => (
    <>
      <path d="M20 11a8 8 0 1 0-2.3 5.7" />
      <path d="M20 5v6h-6" />
    </>
  ),
  // square.and.arrow.up
  share: () => (
    <>
      <path d="M12 3v12" />
      <path d="M8 7l4-4 4 4" />
      <path d="M5 12v7a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-7" />
    </>
  ),
  // checkmark
  // captions — a rounded screen with two caption underlines
  captions: () => (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2.5" />
      <path d="M7 11h3.5M7 14.5h3.5" />
      <path d="M13.5 11H17M13.5 14.5H17" />
    </>
  ),
  check: () => <path d="M5 12l5 5L20 7" />,
};

export function Icon({ name, size = 20, className, filled = false }: IconProps) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {PATHS[name](filled)}
    </svg>
  );
}
