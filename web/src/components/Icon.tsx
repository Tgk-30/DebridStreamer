import {
  BotMessageSquare,
  Bookmark,
  CalendarDays,
  Captions,
  Check,
  CircleHelp,
  Compass,
  Copy,
  Clock3,
  Ellipsis,
  Eye,
  EyeOff,
  Film,
  Gauge,
  HardDriveDownload,
  Info,
  Maximize,
  Minimize,
  Play,
  RefreshCw,
  RotateCcw,
  RotateCw,
  Save,
  Search,
  Share2,
  SkipForward,
  SlidersHorizontal,
  Sparkles,
  Star,
  ThumbsDown,
  ThumbsUp,
  Trash2,
  Upload,
  Volume2,
  VolumeX,
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
  | "upload"
  | "refresh"
  | "share"
  | "captions"
  | "check"
  | "copy"
  | "eye"
  | "eye-off"
  | "save"
  | "more"
  | "thumbs-up"
  | "thumbs-down"
  | "volume"
  | "volume-muted"
  | "rewind"
  | "forward"
  | "speed"
  | "fullscreen"
  | "fullscreen-exit"
  | "skip-next"
  | "help";

interface IconProps {
  name: IconName;
  size?: number;
  className?: string;
  /** Pass a fill for glyphs that have meaningful active variants. */
  filled?: boolean;
}

const ICONS: Record<IconName, LucideIcon> = {
  discover: Compass,
  library: Film,
  watchlist: Bookmark,
  history: Clock3,
  assistant: BotMessageSquare,
  settings: SlidersHorizontal,
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
  upload: Upload,
  refresh: RefreshCw,
  share: Share2,
  captions: Captions,
  check: Check,
  help: CircleHelp,
  copy: Copy,
  eye: Eye,
  "eye-off": EyeOff,
  save: Save,
  more: Ellipsis,
  volume: Volume2,
  "volume-muted": VolumeX,
  rewind: RotateCcw,
  forward: RotateCw,
  speed: Gauge,
  fullscreen: Maximize,
  "fullscreen-exit": Minimize,
  "skip-next": SkipForward,
  "thumbs-up": ThumbsUp,
  "thumbs-down": ThumbsDown,
};

export function Icon({ name, size = 20, className, filled = false }: IconProps) {
  const Glyph = ICONS[name];
  const shouldFill =
    name === "play" ||
    name === "star" ||
    ((name === "watchlist" || name === "thumbs-up" || name === "thumbs-down") &&
      filled);

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
