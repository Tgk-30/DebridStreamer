// EmbeddedPlayer — the built-in libmpv player. Video renders on a native
// Metal/GL surface BEHIND the transparent webview; this component draws the
// controls on top and drives libmpv over IPC (tauri-plugin-libmpv). Handles any
// container (MKV/HEVC/AV1) losslessly, unlike the <video> webview path.

import { useCallback, useEffect, useRef, useState } from "react";
import {
  init,
  destroy,
  command,
  setProperty,
  observeProperties,
  setVideoMarginRatio,
  type MpvConfig,
  type MpvObservableProperty,
} from "tauri-plugin-libmpv-api";
import { Icon } from "./Icon";
import "./EmbeddedPlayer.css";

interface Props {
  url: string;
  title: string;
  startPositionSeconds?: number;
  /** Throttled progress (current, duration) in seconds — feeds Continue Watching. */
  onProgress?: (current: number, duration: number) => void;
  onClose: () => void;
}

// mpv observes these; the union type is loose, so the callback reads name/data.
const OBSERVED: readonly MpvObservableProperty[] = [
  ["pause", "flag"],
  ["time-pos", "double", "none"],
  ["duration", "double", "none"],
  ["core-idle", "flag"],
  ["volume", "double", "none"],
];

const MPV_CONFIG: MpvConfig = {
  initialOptions: {
    vo: "gpu-next", // Metal/Vulkan via libplacebo
    hwdec: "auto-safe", // hardware decode (HEVC/AV1) when safe
    "keep-open": "yes", // don't tear down the render surface at EOF
    "cache": "yes",
    terminal: "no",
  },
  observedProperties: OBSERVED,
};

/** Leave the bottom ~12% of the video clear so the control bar never covers it. */
const VIDEO_MARGIN_BOTTOM = 0.12;

function fmt(s: number): string {
  if (!Number.isFinite(s) || s < 0) return "0:00";
  const t = Math.floor(s);
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const sec = t % 60;
  const mm = h > 0 ? String(m).padStart(2, "0") : String(m);
  return `${h > 0 ? h + ":" : ""}${mm}:${String(sec).padStart(2, "0")}`;
}

export function EmbeddedPlayer({
  url,
  title,
  startPositionSeconds = 0,
  onProgress,
  onClose,
}: Props) {
  const [error, setError] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);
  const [pos, setPos] = useState(0);
  const [dur, setDur] = useState(0);
  const [buffering, setBuffering] = useState(true);
  const [volume, setVolume] = useState(100);
  const [muted, setMuted] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);

  const startedRef = useRef(false);
  const lastReportRef = useRef(0);
  const posRef = useRef(0);
  const durRef = useRef(0);
  const hideTimer = useRef<number | undefined>(undefined);

  // While the embedded player is mounted, punch the page transparent so the
  // native mpv surface (which renders BEHIND the webview) is visible, and hide
  // the rest of the app UI. Restored on unmount. See EmbeddedPlayer.css.
  useEffect(() => {
    document.documentElement.classList.add("mpv-active");
    return () => document.documentElement.classList.remove("mpv-active");
  }, []);

  posRef.current = pos;
  durRef.current = dur;

  // ── libmpv lifecycle: init → load → observe; destroy on unmount ────────────
  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | undefined;
    void (async () => {
      try {
        await init(MPV_CONFIG);
        if (cancelled) {
          void destroy().catch(() => {});
          return;
        }
        await setVideoMarginRatio({ bottom: VIDEO_MARGIN_BOTTOM });
        unlisten = await observeProperties(OBSERVED, (ev: { name: string; data: unknown }) => {
          switch (ev.name) {
            case "pause":
              setPaused(Boolean(ev.data));
              break;
            case "time-pos":
              if (typeof ev.data === "number") setPos(ev.data);
              break;
            case "duration":
              if (typeof ev.data === "number") setDur(ev.data);
              break;
            case "core-idle":
              setBuffering(Boolean(ev.data));
              break;
            case "volume":
              if (typeof ev.data === "number") setVolume(Math.round(ev.data));
              break;
          }
        });
        // loadfile with a start= option so we resume without a visible seek.
        const opts =
          startPositionSeconds > 5
            ? `start=+${Math.floor(startPositionSeconds)}`
            : undefined;
        await command("loadfile", opts ? [url, "replace", opts] : [url]);
        await setProperty("pause", false);
        startedRef.current = true;
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
      unlisten?.();
      void destroy().catch(() => {});
    };
    // Re-init on a new URL (episode change).
  }, [url, startPositionSeconds]);

  // ── Throttled progress write-back (every ~5s) ─────────────────────────────
  useEffect(() => {
    if (!startedRef.current || dur <= 0) return;
    const now = Date.now();
    if (now - lastReportRef.current >= 5000) {
      lastReportRef.current = now;
      onProgress?.(pos, dur);
    }
  }, [pos, dur, onProgress]);

  // ── Auto-hide controls while playing ──────────────────────────────────────
  const nudgeControls = useCallback(() => {
    setControlsVisible(true);
    window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => {
      if (!posRef.current || durRef.current === 0) return;
      setControlsVisible(false);
    }, 3200);
  }, []);
  useEffect(() => {
    nudgeControls();
    return () => window.clearTimeout(hideTimer.current);
  }, [nudgeControls]);

  const togglePause = useCallback(() => {
    void setProperty("pause", !paused);
    nudgeControls();
  }, [paused, nudgeControls]);

  const seekTo = useCallback((to: number) => {
    setPos(to);
    void command("seek", [to, "absolute"]);
  }, []);

  const relSeek = useCallback((delta: number) => {
    void command("seek", [delta, "relative"]);
    nudgeControls();
  }, [nudgeControls]);

  const changeVolume = useCallback((v: number) => {
    setVolume(v);
    setMuted(v === 0);
    void setProperty("volume", v);
  }, []);

  const toggleMute = useCallback(() => {
    const next = !muted;
    setMuted(next);
    void setProperty("mute", next);
  }, [muted]);

  const doClose = useCallback(() => {
    // Final progress flush so Continue Watching has the exact stop point.
    if (startedRef.current && durRef.current > 0) {
      onProgress?.(posRef.current, durRef.current);
    }
    onClose();
  }, [onClose, onProgress]);

  // ── Keyboard shortcuts ────────────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === " " || e.key === "k") {
        e.preventDefault();
        togglePause();
      } else if (e.key === "ArrowRight") {
        relSeek(10);
      } else if (e.key === "ArrowLeft") {
        relSeek(-10);
      } else if (e.key === "Escape") {
        doClose();
      } else if (e.key === "m") {
        toggleMute();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [togglePause, relSeek, doClose, toggleMute]);

  return (
    <div
      className={`embed-player${controlsVisible ? " show-controls" : ""}`}
      onMouseMove={nudgeControls}
      onClick={nudgeControls}
    >
      {/* The transparent stage where the native mpv surface shows through. */}
      <div className="embed-stage" />

      {buffering && !error && (
        <div className="embed-spinner" aria-label="Buffering">
          <span />
        </div>
      )}

      {error && (
        <div className="embed-error" role="alert">
          <p>Couldn’t play this stream.</p>
          <p className="embed-error-detail">{error}</p>
          <button type="button" className="btn" onClick={onClose}>
            Close
          </button>
        </div>
      )}

      <div className="embed-controls">
        <div className="embed-top">
          <button
            type="button"
            className="embed-icon-btn"
            onClick={doClose}
            aria-label="Close player"
          >
            <Icon name="xmark" size={22} />
          </button>
          <span className="embed-title" title={title}>
            {title}
          </span>
        </div>

        <div className="embed-bottom">
          <div className="embed-scrub">
            <span className="embed-time">{fmt(pos)}</span>
            <input
              className="embed-range"
              type="range"
              min={0}
              max={dur || 0}
              step={1}
              value={Math.min(pos, dur || 0)}
              onChange={(e) => seekTo(Number(e.target.value))}
              aria-label="Seek"
              style={{
                // fill the played portion with the accent
                background: `linear-gradient(to right, rgb(var(--accent-rgb)) ${
                  dur > 0 ? (pos / dur) * 100 : 0
                }%, rgba(255,255,255,0.25) ${dur > 0 ? (pos / dur) * 100 : 0}%)`,
              }}
            />
            <span className="embed-time">-{fmt(Math.max(0, dur - pos))}</span>
          </div>

          <div className="embed-buttons">
            <button
              type="button"
              className="embed-icon-btn"
              onClick={() => relSeek(-10)}
              aria-label="Back 10 seconds"
            >
              <Icon name="refresh" size={20} />
              <span className="embed-skip-num">10</span>
            </button>
            <button
              type="button"
              className="embed-play-btn"
              onClick={togglePause}
              aria-label={paused ? "Play" : "Pause"}
            >
              {paused ? (
                <Icon name="play" size={24} filled />
              ) : (
                <span className="embed-pause-glyph" aria-hidden>
                  <i />
                  <i />
                </span>
              )}
            </button>
            <button
              type="button"
              className="embed-icon-btn"
              onClick={() => relSeek(30)}
              aria-label="Forward 30 seconds"
            >
              <Icon name="refresh" size={20} className="embed-flip" />
              <span className="embed-skip-num">30</span>
            </button>

            <div className="embed-volume">
              <button
                type="button"
                className="embed-icon-btn"
                onClick={toggleMute}
                aria-label={muted ? "Unmute" : "Mute"}
              >
                <Icon name={muted ? "eye" : "captions"} size={20} />
              </button>
              <input
                className="embed-range embed-vol-range"
                type="range"
                min={0}
                max={130}
                value={muted ? 0 : volume}
                onChange={(e) => changeVolume(Number(e.target.value))}
                aria-label="Volume"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
