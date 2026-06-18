import {
  Bot,
  Bookmark,
  CalendarDays,
  Captions,
  Check,
  Clock3,
  Copy,
  Eye,
  EyeOff,
  Film,
  HardDriveDownload,
  House,
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
  discover: House,
  library: Film,
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
      strokeWidth={shouldFill ? 0 : filled ? 2.25 : 1.8}
    />
  );
}
