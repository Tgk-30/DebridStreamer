// Scrub-bar thumbnail previews for the IN-WEBVIEW player.
//
// On hover over the scrub bar, generate a preview frame by seeking a HIDDEN,
// offscreen `<video>` (a second element pointed at the same source) to the
// hovered time and drawing it to a small `<canvas>`. The canvas is exported to a
// data URL shown in a tooltip above the bar. Frames are cached by quantized time
// bucket (so re-hovering nearby is instant) and generation is throttled so a
// fast scrub doesn't queue dozens of seeks.
//
// This is gated to the in-webview `<video>` path by the caller — there is no
// frame source for the external mpv/VLC hand-off, so the tooltip is hidden
// there. Cross-origin debrid streams may taint the canvas (a SecurityError on
// export); we catch that and simply show the time label without an image.

import { useCallback, useEffect, useRef, useState } from "react";

/** A generated preview: a data-URL image (or null if unavailable) + the time. */
export interface ScrubPreview {
  /** Data-URL of the frame, or null when none could be drawn (taint / no seek). */
  image: string | null;
  /** The preview time in seconds. */
  time: number;
}

const THUMB_WIDTH = 168; // capped canvas width for performance
const BUCKET_SECONDS = 5; // quantize hovered time into 5s buckets for caching
const THROTTLE_MS = 120; // min gap between seek-driven captures

export interface UseScrubThumbnails {
  /** The currently-previewed frame, or null when not hovering. */
  preview: ScrubPreview | null;
  /** Call on pointer move over the scrub bar with the hovered time (seconds). */
  onHover: (timeSeconds: number) => void;
  /** Call on pointer leave to clear the tooltip. */
  onLeave: () => void;
  /** Whether previews are available (a source + the hidden video exist). */
  available: boolean;
}

/**
 * @param sourceUrl The video src to capture from (same as the main player).
 * @param enabled   Gate — pass false for the external player path so no hidden
 *                  video is created and `available` is false.
 */
export function useScrubThumbnails(
  sourceUrl: string,
  enabled: boolean,
): UseScrubThumbnails {
  const [preview, setPreview] = useState<ScrubPreview | null>(null);
  const [ready, setReady] = useState(false);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const cacheRef = useRef<Map<number, string | null>>(new Map());
  const lastCaptureRef = useRef(0);
  const pendingTimeRef = useRef<number | null>(null);
  const seekingRef = useRef(false);

  // Build the hidden capture video + canvas once (browser only, when enabled).
  useEffect(() => {
    if (!enabled || typeof document === "undefined") return;
    const video = document.createElement("video");
    video.src = sourceUrl;
    video.muted = true;
    video.preload = "auto";
    video.crossOrigin = "anonymous"; // best-effort untainted capture
    video.playsInline = true;
    const canvas = document.createElement("canvas");
    videoRef.current = video;
    canvasRef.current = canvas;
    cacheRef.current.clear();

    const onMeta = () => setReady(Number.isFinite(video.duration));
    const onSeeked = () => {
      seekingRef.current = false;
      captureCurrentFrame();
      // If the user moved on while we were seeking, chase the latest time.
      if (pendingTimeRef.current != null) {
        const next = pendingTimeRef.current;
        pendingTimeRef.current = null;
        void requestCapture(next);
      }
    };
    video.addEventListener("loadedmetadata", onMeta);
    video.addEventListener("seeked", onSeeked);

    return () => {
      video.removeEventListener("loadedmetadata", onMeta);
      video.removeEventListener("seeked", onSeeked);
      video.removeAttribute("src");
      video.load();
      videoRef.current = null;
      canvasRef.current = null;
      cacheRef.current.clear();
      setReady(false);
      setPreview(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceUrl, enabled]);

  /** Draw the hidden video's current frame to the canvas → data URL (cached). */
  const captureCurrentFrame = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (video == null || canvas == null) return;
    const ratio = video.videoHeight > 0 ? video.videoHeight / video.videoWidth : 9 / 16;
    canvas.width = THUMB_WIDTH;
    canvas.height = Math.round(THUMB_WIDTH * ratio);
    const ctx = canvas.getContext("2d");
    if (ctx == null) return;
    let image: string | null = null;
    try {
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      image = canvas.toDataURL("image/jpeg", 0.6);
    } catch {
      // Cross-origin taint — show the time label without an image.
      image = null;
    }
    const bucket = Math.round(video.currentTime / BUCKET_SECONDS);
    cacheRef.current.set(bucket, image);
    setPreview({ image, time: video.currentTime });
  }, []);

  /** Seek the hidden video toward `timeSeconds` to drive a capture. */
  const requestCapture = useCallback(
    (timeSeconds: number) => {
      const video = videoRef.current;
      if (video == null || !Number.isFinite(video.duration)) return;
      const t = Math.max(0, Math.min(timeSeconds, video.duration - 0.1));
      if (seekingRef.current) {
        pendingTimeRef.current = t; // coalesce while a seek is in flight
        return;
      }
      seekingRef.current = true;
      video.currentTime = t;
    },
    [],
  );

  const onHover = useCallback(
    (timeSeconds: number) => {
      if (!enabled) return;
      // Serve from cache instantly when we have a nearby bucket.
      const bucket = Math.round(timeSeconds / BUCKET_SECONDS);
      const cached = cacheRef.current.get(bucket);
      if (cached !== undefined) {
        setPreview({ image: cached, time: timeSeconds });
      } else {
        // Still show the time label immediately, image fills in after the seek.
        setPreview((p) => ({ image: p?.image ?? null, time: timeSeconds }));
      }
      const now = Date.now();
      if (now - lastCaptureRef.current < THROTTLE_MS) {
        pendingTimeRef.current = timeSeconds;
        return;
      }
      lastCaptureRef.current = now;
      requestCapture(timeSeconds);
    },
    [enabled, requestCapture],
  );

  const onLeave = useCallback(() => {
    pendingTimeRef.current = null;
    setPreview(null);
  }, []);

  return { preview, onHover, onLeave, available: enabled && ready };
}
