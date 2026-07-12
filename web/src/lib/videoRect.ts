// Geometry for aligning the player's HTML control overlay with the actual video
// frame. The native mpv layer letterboxes/pillarboxes the video inside the
// window to preserve its aspect ratio, so the frame occupies a centered sub-rect
// of the surface. This helper reproduces that fit so the controls can be pinned
// to the video instead of floating over the black bars.

export interface Size {
  width: number;
  height: number;
}

export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * The rect the video frame occupies inside `container` once it has been scaled
 * to fit while preserving aspect (the same letterbox/pillarbox the native layer
 * applies). Returns null when any dimension is unknown or non-positive - before
 * the first frame, or for audio-only streams - so callers fall back to the full
 * container.
 */
export function fitVideoRect(video: Size, container: Size): Rect | null {
  const { width: vw, height: vh } = video;
  const { width: cw, height: ch } = container;
  if (![vw, vh, cw, ch].every((dimension) => Number.isFinite(dimension) && dimension > 0)) {
    return null;
  }

  const videoAspect = vw / vh;
  const containerAspect = cw / ch;

  if (videoAspect > containerAspect) {
    // Video is wider than the container: fill the width, letterbox top/bottom.
    const height = cw / videoAspect;
    return { left: 0, top: (ch - height) / 2, width: cw, height };
  }
  // Video is taller (or equal): fill the height, pillarbox left/right.
  const width = ch * videoAspect;
  return { left: (cw - width) / 2, top: 0, width, height: ch };
}
