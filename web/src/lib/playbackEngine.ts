/** The renderer that owns the pixels currently visible in the player. */
export type PlaybackEngine =
  | "webview-hls-transcode"
  | "webview-direct"
  | "native-mpv";

export interface PixelSize {
  width: number;
  height: number;
}

export const PLAYBACK_ENGINE_LABEL: Record<PlaybackEngine, string> = {
  "webview-hls-transcode": "Webview HLS transcode",
  "webview-direct": "Webview direct",
  "native-mpv": "Native mpv",
};

/** Convert the CSS viewport to the backing-pixel surface used for playback. */
export function viewportPixelSize(
  width: number,
  height: number,
  scale: number,
): PixelSize | null {
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    !Number.isFinite(scale) ||
    width <= 0 ||
    height <= 0 ||
    scale <= 0
  ) {
    return null;
  }
  return {
    width: Math.round(width * scale),
    height: Math.round(height * scale),
  };
}

export function currentViewportPixelSize(): PixelSize | null {
  if (typeof window === "undefined") return null;
  return viewportPixelSize(
    window.innerWidth,
    window.innerHeight,
    window.devicePixelRatio || 1,
  );
}

