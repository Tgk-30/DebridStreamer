import {
  Bot,
  Bookmark,
  CalendarDays,
  Captions,
  Check,
  Clapperboard,
  Clock3,
  Compass,
  Copy,
  Eye,
  EyeOff,
  HardDriveDownload,
  Info,
  MoreHorizontal,
  Play,
  RefreshCw,
  Save,
  Search,
  Settings,
  Share2,
  SlidersHorizontal,
  Sparkles,
  Star,
  Trash2,
  WandSparkles,
  X,
  type LucideIcon,
} from "lucide-react";

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
  | "sliders"
  | "info"
  | "xmark"
  | "wand-search"
  | "calendar"
  | "debrid"
  | "trash"
  | "refresh"
  | "share"
  | "captions"
  | "check"
  | "copy"
  | "eye"
  | "eye-off"
  | "save"
  | "more";

interface IconProps {
  name: IconName;
  size?: number;
  className?: string;
  /** Pass a fill for glyphs that have meaningful active variants. */
  filled?: boolean;
}

const ICONS: Record<IconName, LucideIcon> = {
  discover: Compass,
  library: Clapperboard,
  watchlist: Bookmark,
  history: Clock3,
  assistant: Bot,
  settings: Settings,
  search: Search,
  play: Play,
  star: Star,
  sparkles: Sparkles,
  sliders: SlidersHorizontal,
  info: Info,
  xmark: X,
  "wand-search": WandSparkles,
  calendar: CalendarDays,
  debrid: HardDriveDownload,
  trash: Trash2,
  refresh: RefreshCw,
  share: Share2,
  captions: Captions,
  check: Check,
  copy: Copy,
  eye: Eye,
  "eye-off": EyeOff,
  save: Save,
  more: MoreHorizontal,
};

export function Icon({ name, size = 20, className, filled = false }: IconProps) {
  const Glyph = ICONS[name];
  const shouldFill = name === "play" || name === "star" || (name === "watchlist" && filled);

  return (
    <Glyph
      aria-hidden="true"
      className={className}
      fill={shouldFill ? "currentColor" : "none"}
      focusable="false"
      size={size}
      strokeWidth={shouldFill ? 0 : 1.8}
    />
  );
}
